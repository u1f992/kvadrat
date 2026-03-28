#include "core.h"
#include <limits.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/threading.h>
#endif
#include <pthread.h>

#ifdef CORE_DEBUG
#include <stdio.h>
#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define NOW() emscripten_get_now()
#else
#include <time.h>
#define NOW() ((double)clock() / CLOCKS_PER_SEC * 1000.0)
#endif
#define DBG(...) fprintf(stderr, __VA_ARGS__)
#else
#define DBG(...)
#define NOW() 0.0
#endif

/* ── Dynamic int32 array ─────────────────────────────────────── */

typedef struct {
  int32_t *data;
  int32_t len, cap;
} IVec;

static void iv_init(IVec *v) {
  v->data = NULL;
  v->len = v->cap = 0;
}
static void iv_free(IVec *v) {
  free(v->data);
  iv_init(v);
}

static int iv_push(IVec *v, int32_t val) {
  // clang-format off
  if (v->len >= v->cap) { // NOLINT(clang-analyzer-core.NullDereference,clang-analyzer-core.UndefinedBinaryOperatorResult)
    // clang-format on
    int32_t nc = v->cap ? v->cap * 2 : 64;
    int32_t *p = (int32_t *)realloc(v->data, (size_t)nc * sizeof(int32_t));
    if (!p)
      return -1;
    v->data = p;
    v->cap = nc;
  }
  v->data[v->len++] = val;
  return 0;
}

/* ── Region: compact index array ─────────────────────────────── */

typedef struct {
  int32_t *idx;
  int32_t len;
} Region;

/* ── Region stack (worklist) ─────────────────────────────────── */

typedef struct {
  Region *items;
  int32_t len, cap;
} RStack;

static void rs_init(RStack *s) {
  s->items = NULL;
  s->len = s->cap = 0;
}

static void rs_free(RStack *s) {
  for (int32_t i = 0; i < s->len; i++)
    free(s->items[i].idx);
  free(s->items);
  rs_init(s);
}

static int rs_push(RStack *s, int32_t *idx, int32_t len) {
  if (s->len >= s->cap) {
    int32_t nc = s->cap ? s->cap * 2 : 16;
    Region *p = (Region *)realloc(s->items, (size_t)nc * sizeof(Region));
    if (!p)
      return -1;
    s->items = p;
    s->cap = nc;
  }
  s->items[s->len].idx = idx;
  s->items[s->len].len = len;
  s->len++;
  return 0;
}

static Region rs_pop(RStack *s) { return s->items[--s->len]; }

/* ── Layer result vector ─────────────────────────────────────── */

typedef struct {
  LayerResult *items;
  int32_t len, cap;
} LVec;

static void lv_init(LVec *v) {
  v->items = NULL;
  v->len = v->cap = 0;
}

static int lv_push(LVec *v, uint32_t color, int32_t *rects, int32_t rlen) {
  if (v->len >= v->cap) {
    int32_t nc = v->cap ? v->cap * 2 : 64;
    LayerResult *p =
        (LayerResult *)realloc(v->items, (size_t)nc * sizeof(LayerResult));
    if (!p)
      return -1;
    v->items = p;
    v->cap = nc;
  }
  v->items[v->len].color = color;
  v->items[v->len].rects = rects;
  v->items[v->len].rects_len = rlen;
  v->len++;
  return 0;
}

/* ── Hash table (open addressing, linear probing) ────────────── */

typedef struct {
  uint32_t key;
  int32_t value;
  uint8_t occupied;
} HEntry;

static int32_t ht_find(const HEntry *t, int32_t cap, uint32_t key) {
  if (cap <= 0)
    return -1;
  uint32_t h = key;
  h ^= h >> 16;
  h *= 0x45d9f3b;
  h ^= h >> 16;
  int32_t i = (int32_t)(h % (uint32_t)cap);
  while (t[i].occupied) {
    if (t[i].key == key)
      return i;
    i = (i + 1) % cap;
  }
  return -1;
}

static int32_t ht_insert(HEntry *t, int32_t cap, uint32_t key, int32_t val) {
  uint32_t h = key;
  h ^= h >> 16;
  h *= 0x45d9f3b;
  h ^= h >> 16;
  int32_t i = (int32_t)(h % (uint32_t)cap);
  while (t[i].occupied) {
    if (t[i].key == key)
      return i;
    i = (i + 1) % cap;
  }
  t[i].key = key;
  t[i].value = val;
  t[i].occupied = 1;
  return i;
}

/* ── Index image: RGBA -> palette + indexed pixels ───────────── */

static int32_t index_image(const uint8_t *rgba, int32_t n, uint32_t *palette,
                           int32_t palette_cap, int32_t *indexed) {
  int32_t ht_cap = n < 512 ? 1024 : n * 2;
  HEntry *ht = (HEntry *)calloc((size_t)ht_cap, sizeof(HEntry));
  if (!ht)
    return CORE_ERROR_ALLOC;

  int32_t num_colors = 0;
  for (int32_t i = 0; i < n; i++) {
    int32_t off = i * 4;
    uint32_t c = ((uint32_t)rgba[off] << 24) | ((uint32_t)rgba[off + 1] << 16) |
                 ((uint32_t)rgba[off + 2] << 8) | rgba[off + 3];
    int32_t slot = ht_find(ht, ht_cap, c);
    if (slot >= 0) {
      indexed[i] = ht[slot].value;
    } else {
      if (num_colors >= palette_cap) {
        free(ht);
        return CORE_ERROR_ALLOC;
      }
      indexed[i] = num_colors;
      palette[num_colors] = c;
      ht_insert(ht, ht_cap, c, num_colors);
      num_colors++;
    }
  }
  free(ht);
  return num_colors;
}

/* ── getBbox ─────────────────────────────────────────────────── */

static void get_bbox(const int32_t *idx, int32_t len, int32_t width,
                     int32_t *x0, int32_t *y0, int32_t *x1, int32_t *y1) {
  *x0 = INT32_MAX;
  *x1 = -1;
  *y0 = INT32_MAX;
  *y1 = -1;
  for (int32_t i = 0; i < len; i++) {
    int32_t px = idx[i] % width;
    int32_t py = idx[i] / width;
    if (px < *x0)
      *x0 = px;
    if (px > *x1)
      *x1 = px;
    if (py < *y0)
      *y0 = py;
    if (py > *y1)
      *y1 = py;
  }
}

/* ── findComponents (4-connectivity BFS) ─────────────────────── */

typedef struct {
  IVec *comps;
  int32_t count;
} CompList;

static CompList find_components(const uint8_t *remain_bm,
                                const int32_t *remain_idx, int32_t remain_len,
                                int32_t width, int32_t height, int32_t cap) {
  CompList cl = {NULL, 0};
  uint8_t *visited = (uint8_t *)calloc((size_t)cap, 1);
  IVec *comps = NULL;
  int32_t comp_count = 0, comp_cap = 0;
  int32_t *stack = (int32_t *)malloc((size_t)cap * 4 * sizeof(int32_t));
  if (!visited || !stack) {
    free(visited);
    free(stack);
    return cl;
  }

  for (int32_t ri = 0; ri < remain_len; ri++) {
    int32_t seed = remain_idx[ri];
    if (visited[seed])
      continue;

    /* New component */
    if (comp_count >= comp_cap) {
      int32_t nc = comp_cap ? comp_cap * 2 : 16;
      IVec *p = (IVec *)realloc(comps, (size_t)nc * sizeof(IVec));
      if (!p)
        goto fail;
      comps = p;
      comp_cap = nc;
    }
    iv_init(&comps[comp_count]);

    int32_t sp = 0;
    stack[sp++] = seed;
    while (sp > 0) {
      int32_t cur = stack[--sp];
      if (visited[cur] || !remain_bm[cur])
        continue;
      visited[cur] = 1;
      iv_push(&comps[comp_count], cur);
      int32_t x = cur % width, y = cur / width;
      if (x > 0)
        stack[sp++] = cur - 1;
      if (x < width - 1)
        stack[sp++] = cur + 1;
      if (y > 0)
        stack[sp++] = cur - width;
      if (y < height - 1)
        stack[sp++] = cur + width;
    }
    comp_count++;
  }

  free(visited);
  free(stack);
  cl.comps = comps;
  cl.count = comp_count;
  return cl;

fail:
  free(visited);
  free(stack);
  for (int32_t i = 0; i < comp_count; i++)
    iv_free(&comps[i]);
  free(comps);
  return cl;
}

/* ── outerFill ───────────────────────────────────────────────── */

/* Returns a newly allocated index array (caller frees).
 *out_len is set to the length. Returns NULL on alloc failure. */
static int32_t *outer_fill(const int32_t *comp_idx, int32_t comp_len,
                           int32_t width, int32_t *out_len) {
  if (comp_len <= 1) {
    int32_t *r = (int32_t *)malloc((size_t)comp_len * sizeof(int32_t));
    if (!r)
      return NULL;
    if (comp_len == 1)
      r[0] = comp_idx[0];
    *out_len = comp_len;
    return r;
  }

  int32_t bx0, by0, bx1, by1;
  get_bbox(comp_idx, comp_len, width, &bx0, &by0, &bx1, &by1);
  int32_t pw = bx1 - bx0 + 3, ph = by1 - by0 + 3;

  uint8_t *wall = (uint8_t *)calloc((size_t)pw * ph, 1);
  uint8_t *ext = (uint8_t *)calloc((size_t)pw * ph, 1);
  int32_t *stack = (int32_t *)malloc((size_t)pw * ph * 4 * sizeof(int32_t));
  if (!wall || !ext || !stack) {
    free(wall);
    free(ext);
    free(stack);
    return NULL;
  }

  for (int32_t i = 0; i < comp_len; i++) {
    int32_t px = (comp_idx[i] % width) - bx0 + 1;
    int32_t py = (comp_idx[i] / width) - by0 + 1;
    wall[py * pw + px] = 1;
  }

  /* Flood fill exterior from (0,0) */
  int32_t sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    int32_t cur = stack[--sp];
    if (ext[cur] || wall[cur])
      continue;
    ext[cur] = 1;
    int32_t x = cur % pw, y = cur / pw;
    if (x > 0)
      stack[sp++] = cur - 1;
    if (x < pw - 1)
      stack[sp++] = cur + 1;
    if (y > 0)
      stack[sp++] = cur - pw;
    if (y < ph - 1)
      stack[sp++] = cur + pw;
  }

  /* Collect: comp + interior holes */
  IVec result;
  iv_init(&result);
  for (int32_t i = 0; i < comp_len; i++)
    iv_push(&result, comp_idx[i]);
  for (int32_t py = 1; py < ph - 1; py++)
    for (int32_t px = 1; px < pw - 1; px++)
      if (!ext[py * pw + px] && !wall[py * pw + px])
        iv_push(&result, (py - 1 + by0) * width + (px - 1 + bx0));

  free(wall);
  free(ext);
  free(stack);
  *out_len = result.len;
  return result.data;
}

/* ── chooseRegion ────────────────────────────────────────────── */

/* Returns a newly allocated index array, or NULL for flat fallback.
 *out_len is set to length. */
static int32_t *choose_region(const int32_t *comp_idx, int32_t comp_len,
                              const uint8_t *parent_bm, int32_t parent_size,
                              int32_t bg, const int32_t *pixels, int32_t width,
                              int32_t height, int32_t *out_len) {
  int32_t bx0, by0, bx1, by1;
  get_bbox(comp_idx, comp_len, width, &bx0, &by0, &bx1, &by1);
  int32_t bbox_area = (bx1 - bx0 + 1) * (by1 - by0 + 1);

  /* Build comp bitmap for fast lookup */
  int32_t cap = width * height;
  uint8_t *comp_bm = (uint8_t *)calloc((size_t)cap, 1);
  if (!comp_bm)
    return NULL;
  for (int32_t i = 0; i < comp_len; i++)
    comp_bm[comp_idx[i]] = 1;

  /* Try bbox expansion */
  if (bbox_area < parent_size) {
    int ok = 1;
    for (int32_t y = by0; y <= by1 && ok; y++)
      for (int32_t x = bx0; x <= bx1 && ok; x++) {
        int32_t idx = y * width + x;
        if (!comp_bm[idx]) {
          if (!parent_bm[idx] || pixels[idx] != bg)
            ok = 0;
        }
      }
    if (ok) {
      int32_t *r = (int32_t *)malloc((size_t)bbox_area * sizeof(int32_t));
      if (r) {
        int32_t n = 0;
        for (int32_t y = by0; y <= by1; y++)
          for (int32_t x = bx0; x <= bx1; x++)
            r[n++] = y * width + x;
        *out_len = n;
      } else {
        *out_len = 0;
      }
      free(comp_bm);
      return r;
    }
  }

  /* Try outerFill */
  int32_t fill_len;
  int32_t *filled = outer_fill(comp_idx, comp_len, width, &fill_len);
  free(comp_bm);
  if (filled && fill_len < parent_size) {
    *out_len = fill_len;
    return filled;
  }
  free(filled);
  /* Null = flat per-color fallback */
  *out_len = 0;
  return NULL;
}

/* ── decomposeRegion ─────────────────────────────────────────── */

/* Greedy row-run + vertical extension.
   region_bm: bitmap with set pixels. Modified in place (cleared).
   Appends [x, y, w, h, ...] to out. */
static void decompose_region(uint8_t *region_bm, const int32_t *region_idx,
                             int32_t region_len, int32_t width, IVec *out) {
  int32_t bx0, by0, bx1, by1;
  get_bbox(region_idx, region_len, width, &bx0, &by0, &bx1, &by1);

  for (int32_t y = by0; y <= by1; y++) {
    for (int32_t x = bx0; x <= bx1; x++) {
      if (!region_bm[y * width + x])
        continue;

      int32_t w = 1;
      while (x + w <= bx1 && region_bm[y * width + x + w])
        w++;

      int32_t h = 1;
      while (y + h <= by1) {
        int ok = 1;
        for (int32_t dx = 0; dx < w; dx++) {
          if (!region_bm[(y + h) * width + x + dx]) {
            ok = 0;
            break;
          }
        }
        if (!ok)
          break;
        h++;
      }

      for (int32_t dy = 0; dy < h; dy++)
        for (int32_t dx = 0; dx < w; dx++)
          region_bm[(y + dy) * width + x + dx] = 0;

      iv_push(out, x);
      iv_push(out, y);
      iv_push(out, w);
      iv_push(out, h);
    }
  }
}

/* ── Parallel flat decomposition ─────────────────────────────── */

typedef struct {
  const IVec *color_pixels; /* per-color pixel index arrays */
  IVec *results;            /* per-color rect output */
  int32_t start, end;       /* color range [start, end) */
  int32_t width, cap;
  int32_t error;
} FlatWorker;

static void *flat_worker(void *arg) {
  FlatWorker *w = (FlatWorker *)arg;
  w->error = 0;
  for (int32_t ci = w->start; ci < w->end; ci++) {
    const IVec *px = &w->color_pixels[ci];
    uint8_t *bm = (uint8_t *)calloc((size_t)w->cap, 1);
    if (!bm) {
      w->error = CORE_ERROR_ALLOC;
      return NULL;
    }
    for (int32_t i = 0; i < px->len; i++)
      bm[px->data[i]] = 1;
    iv_init(&w->results[ci]);
    decompose_region(bm, px->data, px->len, w->width, &w->results[ci]);
    free(bm);
  }
  return NULL;
}

/* ── solve (iterative worklist) ──────────────────────────────── */

static int32_t solve(const int32_t *pixels, const uint32_t *palette,
                     int32_t width, int32_t height, int32_t cap,
                     int32_t num_threads, LVec *layers) {
  /* Initial region = all pixels */
  int32_t *init = (int32_t *)malloc((size_t)cap * sizeof(int32_t));
  if (!init)
    return CORE_ERROR_ALLOC;
  for (int32_t i = 0; i < cap; i++)
    init[i] = i;

  RStack wl;
  rs_init(&wl);
  rs_push(&wl, init, cap);

  /* Reusable bitmaps */
  // clang-format off
  uint8_t *region_bm = (uint8_t *)malloc((size_t)cap); // NOLINT(clang-analyzer-unix.Malloc)
  // clang-format on
  uint8_t *remain_bm = (uint8_t *)calloc((size_t)cap, 1);
  if (!region_bm || !remain_bm) {
    free(region_bm);
    free(remain_bm);
    rs_free(&wl);
    return CORE_ERROR_ALLOC;
  }

  /* Frequency counting: reuse arrays sized to palette_cap */
  int32_t freq_cap = cap; /* max possible colors */
  int32_t *freq_color = (int32_t *)malloc((size_t)freq_cap * sizeof(int32_t));
  int32_t *freq_count = (int32_t *)malloc((size_t)freq_cap * sizeof(int32_t));
  int32_t *freq_seen = (int32_t *)calloc((size_t)freq_cap, sizeof(int32_t));
  if (!freq_color || !freq_count || !freq_seen) {
    free(region_bm);
    free(remain_bm);
    free(freq_color);
    free(freq_count);
    free(freq_seen);
    rs_free(&wl);
    return CORE_ERROR_ALLOC;
  }

#ifdef CORE_DEBUG
  double t_freq = 0, t_decompose = 0, t_remain = 0;
  double t_components = 0, t_choose = 0, t_flat = 0;
  int32_t iterations = 0, flat_count = 0;
  double t0, t1;
#endif

  while (wl.len > 0) {
#ifdef CORE_DEBUG
    iterations++;
#endif
    Region reg = rs_pop(&wl);
    if (reg.len == 0) {
      free(reg.idx);
      continue;
    }

    /* Count colors */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    int32_t num_colors = 0;
    for (int32_t i = 0; i < reg.len; i++) {
      int32_t c = pixels[reg.idx[i]];
      if (!freq_seen[c]) {
        freq_seen[c] = 1;
        freq_color[num_colors] = c;
        freq_count[num_colors] = 0;
        num_colors++;
      }
    }
    /* Count occurrences (second pass using freq_seen as index map) */
    /* Remap freq_seen to point to freq_count index */
    for (int32_t i = 0; i < num_colors; i++)
      freq_seen[freq_color[i]] = i + 1; /* 1-based */
    for (int32_t i = 0; i < reg.len; i++) {
      int32_t slot = freq_seen[pixels[reg.idx[i]]] - 1;
      freq_count[slot]++;
    }
    /* Clean up freq_seen */
    for (int32_t i = 0; i < num_colors; i++)
      freq_seen[freq_color[i]] = 0;

#ifdef CORE_DEBUG
    t1 = NOW();
    t_freq += t1 - t0;
#endif

    /* Single color -> leaf */
    if (num_colors == 1) {
      /* Build bitmap, decompose */
      // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
      memset(region_bm, 0, (size_t)cap);
      for (int32_t i = 0; i < reg.len; i++)
        region_bm[reg.idx[i]] = 1;
      IVec rects;
      iv_init(&rects);
      decompose_region(region_bm, reg.idx, reg.len, width, &rects);
      lv_push(layers, palette[freq_color[0]], rects.data, rects.len);
      free(reg.idx); // NOLINT(clang-analyzer-unix.Malloc)
      continue;
    }

    /* Background = most frequent */
    // clang-format off
    int32_t bg = freq_color[0], bgN = freq_count[0]; // NOLINT(clang-analyzer-core.uninitialized.Assign)
    // clang-format on
    for (int32_t i = 1; i < num_colors; i++) {
      if (freq_count[i] > bgN) {
        bg = freq_color[i];
        bgN = freq_count[i];
      }
    }

    DBG("solve: region len=%d, colors=%d, bg=%d(%d)\n", reg.len, num_colors, bg,
        bgN);

    /* Build region bitmap, decompose bg layer */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
    memset(region_bm, 0, (size_t)cap);
    for (int32_t i = 0; i < reg.len; i++)
      region_bm[reg.idx[i]] = 1;
    IVec bg_rects;
    iv_init(&bg_rects);
    decompose_region(region_bm, reg.idx, reg.len, width, &bg_rects);
    lv_push(layers, palette[bg], bg_rects.data, bg_rects.len);

    /* Rebuild region bitmap (decompose cleared it) */
    // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
    memset(region_bm, 0, (size_t)cap);
    for (int32_t i = 0; i < reg.len; i++)
      region_bm[reg.idx[i]] = 1;
#ifdef CORE_DEBUG
    t1 = NOW();
    t_decompose += t1 - t0;
#endif

    /* Build remaining */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
    memset(remain_bm, 0, (size_t)cap);
    IVec remain_arr;
    iv_init(&remain_arr);
    for (int32_t i = 0; i < reg.len; i++) {
      if (pixels[reg.idx[i]] != bg) {
        remain_bm[reg.idx[i]] = 1;
        iv_push(&remain_arr, reg.idx[i]);
      }
    }
#ifdef CORE_DEBUG
    t1 = NOW();
    t_remain += t1 - t0;
#endif

    /* Find components */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    CompList cl = find_components(remain_bm, remain_arr.data, remain_arr.len,
                                  width, height, cap);
    iv_free(&remain_arr);
#ifdef CORE_DEBUG
    t1 = NOW();
    t_components += t1 - t0;
#endif

    /* Process components in reverse */
    for (int32_t ci = cl.count - 1; ci >= 0; ci--) {
      IVec *comp = &cl.comps[ci];
      int32_t sub_len;
#ifdef CORE_DEBUG
      t0 = NOW();
#endif
      int32_t *sub = choose_region(comp->data, comp->len, region_bm, reg.len,
                                   bg, pixels, width, height, &sub_len);
#ifdef CORE_DEBUG
      t1 = NOW();
      t_choose += t1 - t0;
#endif
      DBG("  comp[%d] len=%d -> choose_region: sub=%p sub_len=%d\n", ci,
          comp->len, (void *)sub, sub_len);
      if (sub) {
        rs_push(&wl, sub, sub_len);
      } else {
        DBG("  FLAT FALLBACK for comp len=%d\n", comp->len);
#ifdef CORE_DEBUG
        t0 = NOW();
        flat_count++;
#endif

        /* 1. Discover colors */
        int32_t nc2 = 0;
        for (int32_t i = 0; i < comp->len; i++) {
          int32_t c = pixels[comp->data[i]];
          if (!freq_seen[c]) {
            freq_seen[c] = 1;
            freq_color[nc2++] = c;
          }
        }
        /* 2. Map color -> slot for grouping */
        for (int32_t i = 0; i < nc2; i++)
          freq_seen[freq_color[i]] = i;
        /* 3. Group pixels by color */
        IVec *cpx =
            (nc2 > 0) ? (IVec *)malloc((size_t)nc2 * sizeof(IVec)) : NULL;
        IVec *crects =
            (nc2 > 0) ? (IVec *)malloc((size_t)nc2 * sizeof(IVec)) : NULL;
        if (nc2 > 0 && (!cpx || !crects)) {
          free(cpx);
          free(crects);
          for (int32_t i = 0; i < nc2; i++)
            freq_seen[freq_color[i]] = 0;
          continue;
        }
        for (int32_t i = 0; i < nc2; i++) {
          iv_init(&cpx[i]);
          iv_init(&crects[i]);
        }
        for (int32_t i = 0; i < comp->len; i++) {
          int32_t slot = freq_seen[pixels[comp->data[i]]];
          iv_push(&cpx[slot], comp->data[i]);
        }
        for (int32_t i = 0; i < nc2; i++)
          freq_seen[freq_color[i]] = 0;

        /* 4. Parallel decompose per color */
        {
          int32_t nt = num_threads;
          if (nt > nc2)
            nt = nc2;
          if (nt < 1)
            nt = 1;

          FlatWorker *workers =
              (FlatWorker *)malloc((size_t)nt * sizeof(FlatWorker));
          pthread_t *threads =
              (pthread_t *)calloc((size_t)nt, sizeof(pthread_t));
          if (!workers || !threads) {
            free(workers);
            free(threads);
            workers = NULL;
            threads = NULL;
          }

          int32_t per = workers ? nc2 / nt : 0;
          int32_t rem = workers ? nc2 % nt : 0;
          int32_t start = 0;
          for (int32_t t = 0; workers && t < nt; t++) {
            int32_t count = per + (t < rem ? 1 : 0);
            workers[t].color_pixels = cpx;
            workers[t].results = crects;
            workers[t].start = start;
            workers[t].end = start + count;
            workers[t].width = width;
            workers[t].cap = cap;
            workers[t].error = 0;
            if (pthread_create(&threads[t], NULL, flat_worker, &workers[t]) !=
                0)
              flat_worker(&workers[t]);
            start += count;
          }
          for (int32_t t = 0; workers && t < nt; t++) {
            if (threads[t])
              pthread_join(threads[t], NULL);
          }

          int32_t worker_err = 0;
          for (int32_t t = 0; workers && t < nt; t++) {
            if (workers[t].error)
              worker_err = workers[t].error;
          }
          free(workers);
          free(threads);

          if (worker_err) {
            for (int32_t ci2 = 0; ci2 < nc2; ci2++) {
              free(crects[ci2].data);
              iv_free(&cpx[ci2]);
            }
            free(cpx);
            free(crects);
            for (int32_t i = 0; i < nc2; i++)
              freq_seen[freq_color[i]] = 0;
            continue;
          }
        }

        /* 5. Collect results into layers */
        for (int32_t ci2 = 0; ci2 < nc2; ci2++) {
          lv_push(layers, palette[freq_color[ci2]], crects[ci2].data,
                  crects[ci2].len);
          iv_free(&cpx[ci2]);
        }
        free(cpx);
        free(crects);
#ifdef CORE_DEBUG
        t1 = NOW();
        t_flat += t1 - t0;
#endif
      }
    }

    /* Free components */
    for (int32_t ci = 0; ci < cl.count; ci++)
      iv_free(&cl.comps[ci]);
    free(cl.comps);
    free(reg.idx);
  }

  DBG("\n=== solve profile ===\n");
  DBG("iterations: %d, flat_fallbacks: %d, layers: %d\n", iterations,
      flat_count, layers->len);
  DBG("freq:       %7.1fms\n", t_freq);
  DBG("decompose:  %7.1fms\n", t_decompose);
  DBG("remain:     %7.1fms\n", t_remain);
  DBG("components: %7.1fms\n", t_components);
  DBG("choose:     %7.1fms\n", t_choose);
  DBG("flat:       %7.1fms\n", t_flat);
  DBG("total:      %7.1fms\n",
      t_freq + t_decompose + t_remain + t_components + t_choose + t_flat);
  DBG("====================\n");

  free(region_bm);
  free(remain_bm);
  free(freq_color);
  free(freq_count);
  free(freq_seen);
  rs_free(&wl);
  return 0;
}

/* ── Main entry ──────────────────────────────────────────────── */

int32_t layered_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                          int32_t num_threads, LayerResult **out_layers) {
  int32_t cap = width * height;

  uint32_t *palette = (uint32_t *)malloc((size_t)cap * sizeof(uint32_t));
  int32_t *indexed = (int32_t *)malloc((size_t)cap * sizeof(int32_t));
  if (!palette || !indexed) {
    free(palette);
    free(indexed);
    return CORE_ERROR_ALLOC;
  }

  int32_t num_colors = index_image(pixels, cap, palette, cap, indexed);
  if (num_colors < 0) {
    free(palette);
    free(indexed);
    return num_colors;
  }

  LVec layers;
  lv_init(&layers);

  int32_t err =
      solve(indexed, palette, width, height, cap, num_threads, &layers);
  free(palette);
  free(indexed);

  if (err < 0) {
    for (int32_t i = 0; i < layers.len; i++)
      free(layers.items[i].rects);
    free(layers.items);
    return err;
  }

  *out_layers = layers.items;
  return layers.len;
}

/* ── Flat decomposition (non-overlapping rects) ─────────────── */

int32_t flat_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                       LayerResult **out_layers) {
  int32_t cap = width * height;

  uint32_t *palette = (uint32_t *)malloc((size_t)cap * sizeof(uint32_t));
  int32_t *indexed = (int32_t *)malloc((size_t)cap * sizeof(int32_t));
  if (!palette || !indexed) {
    free(palette);
    free(indexed);
    return CORE_ERROR_ALLOC;
  }

  int32_t num_colors = index_image(pixels, cap, palette, cap, indexed);
  if (num_colors < 0) {
    free(palette);
    free(indexed);
    return num_colors;
  }

  /* Group pixels by color */
  IVec *groups = (IVec *)malloc((size_t)num_colors * sizeof(IVec));
  if (!groups) {
    free(palette);
    free(indexed);
    return CORE_ERROR_ALLOC;
  }
  for (int32_t i = 0; i < num_colors; i++)
    iv_init(&groups[i]);
  for (int32_t i = 0; i < cap; i++)
    iv_push(&groups[indexed[i]], i);
  free(indexed);

  /* Decompose each color into rects */
  LayerResult *results =
      (LayerResult *)malloc((size_t)num_colors * sizeof(LayerResult));
  if (!results) {
    for (int32_t i = 0; i < num_colors; i++)
      iv_free(&groups[i]);
    free(groups);
    free(palette);
    return CORE_ERROR_ALLOC;
  }

  uint8_t *bm = (uint8_t *)calloc((size_t)cap, 1);
  if (!bm) {
    for (int32_t i = 0; i < num_colors; i++)
      iv_free(&groups[i]);
    free(groups);
    free(palette);
    free(results);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t c = 0; c < num_colors; c++) {
    for (int32_t i = 0; i < groups[c].len; i++)
      bm[groups[c].data[i]] = 1;

    IVec rects;
    iv_init(&rects);
    decompose_region(bm, groups[c].data, groups[c].len, width, &rects);

    results[c].color = palette[c];
    results[c].rects = rects.data;
    results[c].rects_len = rects.len;
    iv_free(&groups[c]);
  }

  free(bm);
  free(groups);
  free(palette);
  *out_layers = results;
  return num_colors;
}

/* ── 64-bit hash table (for outline decomposition) ──────────── */

typedef struct {
  uint64_t key;
  int32_t value;
  uint8_t occupied;
} HEntry64;

static int32_t ht64_find(const HEntry64 *t, int32_t cap, uint64_t key) {
  if (cap <= 0)
    return -1;
  uint64_t h = key;
  h ^= h >> 33;
  h *= 0xff51afd7ed558ccdULL;
  h ^= h >> 33;
  h *= 0xc4ceb9fe1a85ec53ULL;
  h ^= h >> 33;
  int32_t i = (int32_t)(h % (uint64_t)cap);
  while (t[i].occupied) {
    if (t[i].key == key)
      return i;
    i = (i + 1) % cap;
  }
  return -1;
}

static int32_t ht64_insert(HEntry64 *t, int32_t cap, uint64_t key,
                           int32_t val) {
  uint64_t h = key;
  h ^= h >> 33;
  h *= 0xff51afd7ed558ccdULL;
  h ^= h >> 33;
  h *= 0xc4ceb9fe1a85ec53ULL;
  h ^= h >> 33;
  int32_t i = (int32_t)(h % (uint64_t)cap);
  while (t[i].occupied) {
    if (t[i].key == key)
      return i;
    i = (i + 1) % cap;
  }
  t[i].key = key;
  t[i].value = val;
  t[i].occupied = 1;
  return i;
}

static void ht64_remove(HEntry64 *t, int32_t cap, int32_t idx) {
  if (cap <= 0)
    return;
  t[idx].occupied = 0;
  int32_t next = (idx + 1) % cap;
  while (t[next].occupied) {
    uint64_t k = t[next].key;
    int32_t v = t[next].value;
    t[next].occupied = 0;
    ht64_insert(t, cap, k, v);
    next = (next + 1) % cap;
  }
}

/* ── Outline helpers ────────────────────────────────────────── */

static inline uint64_t encode_edge_key(int32_t x1, int32_t y1, int32_t x2,
                                       int32_t y2) {
  return ((uint64_t)(uint16_t)x1 << 48) | ((uint64_t)(uint16_t)y1 << 32) |
         ((uint64_t)(uint16_t)x2 << 16) | (uint16_t)y2;
}

static inline uint64_t point_key(int32_t x, int32_t y) {
  return ((uint64_t)(uint16_t)x << 16) | (uint16_t)y;
}

static int32_t remove_bidirectional_edges(int32_t *edges, int32_t edge_count) {
  if (edge_count <= 0)
    return 0;

  int32_t capacity = edge_count * 2;
  HEntry64 *table = (HEntry64 *)calloc((size_t)capacity, sizeof(HEntry64));
  uint8_t *to_remove = (uint8_t *)calloc((size_t)edge_count, 1);
  if (!table || !to_remove) {
    free(table);
    free(to_remove);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t i = 0; i < edge_count; i++) {
    int32_t off = i * 4;
    uint64_t reverse_key = encode_edge_key(edges[off + 2], edges[off + 3],
                                           edges[off], edges[off + 1]);
    int32_t found = ht64_find(table, capacity, reverse_key);
    if (found >= 0) {
      to_remove[i] = 1;
      to_remove[table[found].value] = 1;
      ht64_remove(table, capacity, found);
    } else {
      uint64_t key = encode_edge_key(edges[off], edges[off + 1], edges[off + 2],
                                     edges[off + 3]);
      ht64_insert(table, capacity, key, i);
    }
  }

  int32_t write_index = 0;
  for (int32_t i = 0; i < edge_count; i++) {
    if (!to_remove[i]) {
      if (write_index != i) {
        int32_t r = i * 4, w = write_index * 4;
        edges[w] = edges[r];
        edges[w + 1] = edges[r + 1];
        edges[w + 2] = edges[r + 2];
        edges[w + 3] = edges[r + 3];
      }
      write_index++;
    }
  }

  free(table);
  free(to_remove);
  return write_index;
}

static inline int32_t emit_point(int32_t *out, int32_t *out_pos,
                                 int32_t out_capacity, int32_t x, int32_t y) {
  if (*out_pos + 2 > out_capacity)
    return -1;
  out[(*out_pos)++] = x;
  out[(*out_pos)++] = y;
  return 0;
}

static int32_t build_polygons(const int32_t *edges, int32_t edge_count,
                              int32_t *out, int32_t out_capacity) {
  if (edge_count <= 0)
    return 0;

  int32_t adj_capacity = edge_count * 2;
  HEntry64 *adj = (HEntry64 *)calloc((size_t)adj_capacity, sizeof(HEntry64));
  int32_t *next_same_start =
      (int32_t *)malloc((size_t)edge_count * sizeof(int32_t));
  uint8_t *used = (uint8_t *)calloc((size_t)edge_count, 1);
  if (!adj || !next_same_start || !used) {
    free(adj);
    free(next_same_start);
    free(used);
    return CORE_ERROR_ALLOC;
  }
  // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
  memset(next_same_start, -1, (size_t)edge_count * sizeof(int32_t));

  for (int32_t i = 0; i < edge_count; i++) {
    int32_t off = i * 4;
    uint64_t key = point_key(edges[off], edges[off + 1]);
    int32_t found = ht64_find(adj, adj_capacity, key);
    if (found >= 0) {
      next_same_start[i] = adj[found].value;
      adj[found].value = i;
    } else {
      ht64_insert(adj, adj_capacity, key, i);
    }
  }

  int32_t remaining = edge_count;
  int32_t start_scan = 0;
  int32_t out_pos = 0;

  while (remaining > 0) {
    while (used[start_scan])
      start_scan++;

    int32_t count_pos = out_pos++;
    if (out_pos >= out_capacity) {
      free(adj);
      free(next_same_start);
      free(used);
      return CORE_ERROR_CAPACITY;
    }

    int32_t point_count = 0;
    used[start_scan] = 1;
    remaining--;

    int32_t off = start_scan * 4;
    int32_t first_x = edges[off], first_y = edges[off + 1];
    int32_t cur_x = edges[off + 2], cur_y = edges[off + 3];

    if (emit_point(out, &out_pos, out_capacity, first_x, first_y) < 0 ||
        emit_point(out, &out_pos, out_capacity, cur_x, cur_y) < 0) {
      free(adj);
      free(next_same_start);
      free(used);
      return CORE_ERROR_CAPACITY;
    }
    point_count += 2;

    int32_t prev_x = first_x, prev_y = first_y;
    int32_t last_x = cur_x, last_y = cur_y;

    do {
      uint64_t key = point_key(cur_x, cur_y);
      int32_t slot = ht64_find(adj, adj_capacity, key);
      int32_t found_edge = -1;

      if (slot >= 0) {
        int32_t idx = adj[slot].value;
        while (idx >= 0) {
          if (!used[idx]) {
            found_edge = idx;
            break;
          }
          idx = next_same_start[idx];
        }
      }

      if (found_edge < 0) {
        free(adj);
        free(next_same_start);
        free(used);
        return CORE_ERROR_BROKEN_CHAIN;
      }

      used[found_edge] = 1;
      remaining--;
      off = found_edge * 4;
      int32_t new_x = edges[off + 2], new_y = edges[off + 3];

      if (prev_x == last_x && last_x == new_x) {
        out[out_pos - 1] = new_y;
        last_y = new_y;
      } else if (prev_y == last_y && last_y == new_y) {
        out[out_pos - 2] = new_x;
        last_x = new_x;
      } else {
        prev_x = last_x;
        prev_y = last_y;
        last_x = new_x;
        last_y = new_y;
        if (emit_point(out, &out_pos, out_capacity, new_x, new_y) < 0) {
          free(adj);
          free(next_same_start);
          free(used);
          return CORE_ERROR_CAPACITY;
        }
        point_count++;
      }

      cur_x = new_x;
      cur_y = new_y;
    } while (!(cur_x == first_x && cur_y == first_y));

    /* Adjust start/end if collinear */
    int32_t p0_x = out[count_pos + 1], p0_y = out[count_pos + 2];
    int32_t p1_x = out[count_pos + 3], p1_y = out[count_pos + 4];
    int32_t pn_x = out[out_pos - 4], pn_y = out[out_pos - 3];

    if (p0_x == p1_x && pn_x == p0_x) {
      point_count--;
      out_pos -= 2;
      out[count_pos + 2] = pn_y;
    } else if (p0_y == p1_y && pn_y == p0_y) {
      point_count--;
      out_pos -= 2;
      out[count_pos + 1] = pn_x;
    }

    out[count_pos] = point_count;
  }

  free(adj);
  free(next_same_start);
  free(used);
  return out_pos;
}

static int32_t poly_count(const int32_t *buf, int32_t buf_len) {
  int32_t count = 0, pos = 0;
  while (pos < buf_len) {
    pos += 1 + buf[pos] * 2;
    count++;
  }
  return count;
}

static int32_t concat_polygons(int32_t *buf, int32_t buf_len,
                               int32_t buf_capacity) {
  int32_t num_polys = poly_count(buf, buf_len);
  if (num_polys <= 1)
    return buf_len;

  int32_t *offsets = (int32_t *)malloc((size_t)num_polys * sizeof(int32_t));
  if (!offsets)
    return CORE_ERROR_ALLOC;
  {
    int32_t pos = 0;
    for (int32_t n = 0; n < num_polys; n++) {
      offsets[n] = pos;
      pos += 1 + buf[pos] * 2;
    }
  }

  for (int32_t i = 0; i < num_polys; i++) {
    int32_t i_off = offsets[i];
    int32_t i_pc = buf[i_off];
    int32_t i_pts = i_off + 1;

    for (int32_t j = 0; j < i_pc; j++) {
      int32_t jx = buf[i_pts + j * 2];
      int32_t jy = buf[i_pts + j * 2 + 1];

      for (int32_t k = i + 1; k < num_polys; k++) {
        int32_t k_off = offsets[k];
        int32_t k_pc = buf[k_off];
        int32_t k_pts = k_off + 1;
        int32_t k_size = 1 + k_pc * 2;

        for (int32_t l = 0; l < k_pc - 1; l++) {
          if (buf[k_pts + l * 2] != jx || buf[k_pts + l * 2 + 1] != jy)
            continue;

          int32_t *k_copy = (int32_t *)malloc((size_t)k_size * sizeof(int32_t));
          if (!k_copy) {
            free(offsets);
            return CORE_ERROR_ALLOC;
          }
          // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
          memcpy(k_copy, buf + k_off, (size_t)k_size * sizeof(int32_t));

          int32_t after_k = k_off + k_size;
          // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
          memmove(buf + k_off, buf + after_k,
                  (size_t)(buf_len - after_k) * sizeof(int32_t));
          buf_len -= k_size;

          for (int32_t n = k; n < num_polys - 1; n++)
            offsets[n] = offsets[n + 1] - k_size;
          num_polys--;

          int32_t insert_count = k_pc - 1;
          int32_t insert_elems = insert_count * 2;
          int32_t insert_pos = i_pts + (j + 1) * 2;
          int32_t tail_len = buf_len - insert_pos;

          if (buf_len + insert_elems > buf_capacity) {
            free(k_copy);
            free(offsets);
            return CORE_ERROR_CAPACITY;
          }
          // NOLINTNEXTLINE(clang-analyzer-security.insecureAPI.DeprecatedOrUnsafeBufferHandling)
          memmove(buf + insert_pos + insert_elems, buf + insert_pos,
                  (size_t)tail_len * sizeof(int32_t));
          buf_len += insert_elems;

          for (int32_t n = i + 1; n < num_polys; n++)
            offsets[n] += insert_elems;

          int32_t wp = insert_pos;
          for (int32_t m = l + 1; m < k_pc; m++) {
            buf[wp++] = k_copy[1 + m * 2];
            buf[wp++] = k_copy[1 + m * 2 + 1];
          }
          if (l > 0) {
            for (int32_t m = 1; m <= l; m++) {
              buf[wp++] = k_copy[1 + m * 2];
              buf[wp++] = k_copy[1 + m * 2 + 1];
            }
          }

          free(k_copy);

          buf[i_off] = i_pc + insert_count;
          i_pc = buf[i_off];
          i_pts = i_off + 1;
          k--;
          break;
        }
      }
    }
  }

  free(offsets);
  return buf_len;
}

/* ── Outline decomposition (non-overlapping polygons) ───────── */

int32_t outline_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                          OutlineResult **out_results) {
  int32_t cap = width * height;

  uint32_t *palette = (uint32_t *)malloc((size_t)cap * sizeof(uint32_t));
  int32_t *indexed = (int32_t *)malloc((size_t)cap * sizeof(int32_t));
  if (!palette || !indexed) {
    free(palette);
    free(indexed);
    return CORE_ERROR_ALLOC;
  }

  int32_t num_colors = index_image(pixels, cap, palette, cap, indexed);
  if (num_colors < 0) {
    free(palette);
    free(indexed);
    return num_colors;
  }

  /* Count pixels per color */
  // NOLINTNEXTLINE(clang-analyzer-optin.portability.UnixAPI)
  int32_t *counts = (int32_t *)calloc((size_t)num_colors, sizeof(int32_t));
  if (!counts) {
    free(palette);
    free(indexed);
    return CORE_ERROR_ALLOC;
  }
  for (int32_t i = 0; i < cap; i++)
    counts[indexed[i]]++;

  /* Allocate per-color edge buffers (max 4 edges * 4 ints per pixel) */
  int32_t **edge_bufs =
      (int32_t **)calloc((size_t)num_colors, sizeof(int32_t *));
  int32_t *edge_offs = (int32_t *)calloc((size_t)num_colors, sizeof(int32_t));
  if (!edge_bufs || !edge_offs) {
    free(palette);
    free(indexed);
    free(counts);
    free(edge_bufs);
    free(edge_offs);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t c = 0; c < num_colors; c++) {
    // clang-format off
    edge_bufs[c] =
        (int32_t *)malloc((size_t)counts[c] * 16 * sizeof(int32_t)); // NOLINT(clang-analyzer-optin.portability.UnixAPI)
    // clang-format on
    if (!edge_bufs[c]) {
      for (int32_t j = 0; j < c; j++)
        free(edge_bufs[j]);
      free(edge_bufs);
      free(edge_offs);
      free(counts);
      free(palette);
      free(indexed);
      return CORE_ERROR_ALLOC;
    }
  }
  free(counts);

  /* Generate 4 edges per pixel */
  for (int32_t y = 0; y < height; y++) {
    for (int32_t x = 0; x < width; x++) {
      // clang-format off
      int32_t c = indexed[y * width + x]; // NOLINT(clang-analyzer-core.uninitialized.Assign)
      // clang-format on
      int32_t *buf = edge_bufs[c];
      int32_t off = edge_offs[c];
      /* top */
      buf[off++] = x;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y;
      /* right */
      buf[off++] = x + 1;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y + 1;
      /* bottom */
      buf[off++] = x + 1;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y + 1;
      /* left */
      buf[off++] = x;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y;
      edge_offs[c] = off;
    }
  }
  free(indexed);

  /* Process each color: remove bidirectional → build polygons → concat */
  OutlineResult *results =
      (OutlineResult *)malloc((size_t)num_colors * sizeof(OutlineResult));
  if (!results) {
    for (int32_t c = 0; c < num_colors; c++)
      free(edge_bufs[c]);
    free(edge_bufs);
    free(edge_offs);
    free(palette);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t c = 0; c < num_colors; c++) {
    int32_t edge_count = edge_offs[c] / 4;
    int32_t *edges = edge_bufs[c];

    int32_t new_ec = remove_bidirectional_edges(edges, edge_count);
    if (new_ec < 0) {
      for (int32_t j = c; j < num_colors; j++)
        free(edge_bufs[j]);
      for (int32_t j = 0; j < c; j++)
        free(results[j].polygons);
      free(results);
      free(edge_bufs);
      free(edge_offs);
      free(palette);
      return new_ec;
    }

    int32_t out_cap = new_ec * 11;
    // NOLINTNEXTLINE(clang-analyzer-optin.portability.UnixAPI)
    int32_t *poly_buf = (int32_t *)malloc((size_t)out_cap * sizeof(int32_t));
    if (!poly_buf) {
      for (int32_t j = c; j < num_colors; j++)
        free(edge_bufs[j]);
      for (int32_t j = 0; j < c; j++)
        free(results[j].polygons);
      free(results);
      free(edge_bufs);
      free(edge_offs);
      free(palette);
      return CORE_ERROR_ALLOC;
    }

    int32_t buf_len = build_polygons(edges, new_ec, poly_buf, out_cap);
    free(edges);
    edge_bufs[c] = NULL;

    if (buf_len < 0) {
      free(poly_buf);
      for (int32_t j = c + 1; j < num_colors; j++)
        free(edge_bufs[j]);
      for (int32_t j = 0; j < c; j++)
        free(results[j].polygons);
      free(results);
      free(edge_bufs);
      free(edge_offs);
      free(palette);
      return buf_len;
    }

    int32_t final_len = concat_polygons(poly_buf, buf_len, out_cap);
    if (final_len < 0) {
      free(poly_buf);
      for (int32_t j = c + 1; j < num_colors; j++)
        free(edge_bufs[j]);
      for (int32_t j = 0; j < c; j++)
        free(results[j].polygons);
      free(results);
      free(edge_bufs);
      free(edge_offs);
      free(palette);
      return final_len;
    }

    results[c].color = palette[c];
    results[c].polygons = poly_buf;
    results[c].polygons_len = final_len;
  }

  free(edge_bufs);
  free(edge_offs);
  free(palette);
  *out_results = results;
  return num_colors;
}
