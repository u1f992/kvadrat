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

static void iv_init(IVec *v) { v->data = NULL; v->len = v->cap = 0; }
static void iv_free(IVec *v) { free(v->data); iv_init(v); }

static int iv_push(IVec *v, int32_t val) {
  if (v->len >= v->cap) {
    int32_t nc = v->cap ? v->cap * 2 : 64;
    int32_t *p = (int32_t *)realloc(v->data, (size_t)nc * sizeof(int32_t));
    if (!p) return -1;
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

static void rs_init(RStack *s) { s->items = NULL; s->len = s->cap = 0; }

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
    if (!p) return -1;
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

static void lv_init(LVec *v) { v->items = NULL; v->len = v->cap = 0; }

static int lv_push(LVec *v, uint32_t color, int32_t *rects, int32_t rlen) {
  if (v->len >= v->cap) {
    int32_t nc = v->cap ? v->cap * 2 : 64;
    LayerResult *p =
        (LayerResult *)realloc(v->items, (size_t)nc * sizeof(LayerResult));
    if (!p) return -1;
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
  if (cap <= 0) return -1;
  uint32_t h = key;
  h ^= h >> 16;
  h *= 0x45d9f3b;
  h ^= h >> 16;
  int32_t i = (int32_t)(h % (uint32_t)cap);
  while (t[i].occupied) {
    if (t[i].key == key) return i;
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
    if (t[i].key == key) return i;
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
  if (!ht) return CORE_ERROR_ALLOC;

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
    if (px < *x0) *x0 = px;
    if (px > *x1) *x1 = px;
    if (py < *y0) *y0 = py;
    if (py > *y1) *y1 = py;
  }
}

/* ── findComponents (4-connectivity BFS) ─────────────────────── */

typedef struct {
  IVec *comps;
  int32_t count;
} CompList;

static CompList find_components(const uint8_t *remain_bm, const int32_t *remain_idx,
                                int32_t remain_len, int32_t width, int32_t height,
                                int32_t cap) {
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
    if (visited[seed]) continue;

    /* New component */
    if (comp_count >= comp_cap) {
      int32_t nc = comp_cap ? comp_cap * 2 : 16;
      IVec *p = (IVec *)realloc(comps, (size_t)nc * sizeof(IVec));
      if (!p) goto fail;
      comps = p;
      comp_cap = nc;
    }
    iv_init(&comps[comp_count]);

    int32_t sp = 0;
    stack[sp++] = seed;
    while (sp > 0) {
      int32_t cur = stack[--sp];
      if (visited[cur] || !remain_bm[cur]) continue;
      visited[cur] = 1;
      iv_push(&comps[comp_count], cur);
      int32_t x = cur % width, y = cur / width;
      if (x > 0) stack[sp++] = cur - 1;
      if (x < width - 1) stack[sp++] = cur + 1;
      if (y > 0) stack[sp++] = cur - width;
      if (y < height - 1) stack[sp++] = cur + width;
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
    if (!r) return NULL;
    if (comp_len == 1) r[0] = comp_idx[0];
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
    free(wall); free(ext); free(stack);
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
    if (ext[cur] || wall[cur]) continue;
    ext[cur] = 1;
    int32_t x = cur % pw, y = cur / pw;
    if (x > 0) stack[sp++] = cur - 1;
    if (x < pw - 1) stack[sp++] = cur + 1;
    if (y > 0) stack[sp++] = cur - pw;
    if (y < ph - 1) stack[sp++] = cur + pw;
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
                              int32_t bg, const int32_t *pixels,
                              int32_t width, int32_t height,
                              int32_t *out_len) {
  int32_t bx0, by0, bx1, by1;
  get_bbox(comp_idx, comp_len, width, &bx0, &by0, &bx1, &by1);
  int32_t bbox_area = (bx1 - bx0 + 1) * (by1 - by0 + 1);

  /* Build comp bitmap for fast lookup */
  int32_t cap = width * height;
  uint8_t *comp_bm = (uint8_t *)calloc((size_t)cap, 1);
  if (!comp_bm) return NULL;
  for (int32_t i = 0; i < comp_len; i++)
    comp_bm[comp_idx[i]] = 1;

  /* Try bbox expansion */
  if (bbox_area < parent_size) {
    int ok = 1;
    for (int32_t y = by0; y <= by1 && ok; y++)
      for (int32_t x = bx0; x <= bx1 && ok; x++) {
        int32_t idx = y * width + x;
        if (!comp_bm[idx]) {
          if (!parent_bm[idx] || pixels[idx] != bg) ok = 0;
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
                             int32_t region_len, int32_t width,
                             IVec *out) {
  int32_t bx0, by0, bx1, by1;
  get_bbox(region_idx, region_len, width, &bx0, &by0, &bx1, &by1);

  for (int32_t y = by0; y <= by1; y++) {
    for (int32_t x = bx0; x <= bx1; x++) {
      if (!region_bm[y * width + x]) continue;

      int32_t w = 1;
      while (x + w <= bx1 && region_bm[y * width + x + w]) w++;

      int32_t h = 1;
      while (y + h <= by1) {
        int ok = 1;
        for (int32_t dx = 0; dx < w; dx++) {
          if (!region_bm[(y + h) * width + x + dx]) { ok = 0; break; }
        }
        if (!ok) break;
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
    if (!bm) { w->error = CORE_ERROR_ALLOC; return NULL; }
    for (int32_t i = 0; i < px->len; i++) bm[px->data[i]] = 1;
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
  if (!init) return CORE_ERROR_ALLOC;
  for (int32_t i = 0; i < cap; i++) init[i] = i;

  RStack wl;
  rs_init(&wl);
  rs_push(&wl, init, cap);

  /* Reusable bitmaps */
  uint8_t *region_bm = (uint8_t *)malloc((size_t)cap);
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
    free(region_bm); free(remain_bm);
    free(freq_color); free(freq_count); free(freq_seen);
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
    if (reg.len == 0) { free(reg.idx); continue; }

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
    t1 = NOW(); t_freq += t1 - t0;
#endif

    /* Single color -> leaf */
    if (num_colors == 1) {
      /* Build bitmap, decompose */
      memset(region_bm, 0, (size_t)cap);
      for (int32_t i = 0; i < reg.len; i++) region_bm[reg.idx[i]] = 1;
      IVec rects; iv_init(&rects);
      decompose_region(region_bm, reg.idx, reg.len, width, &rects);
      lv_push(layers, palette[freq_color[0]], rects.data, rects.len);
      free(reg.idx);
      continue;
    }

    /* Background = most frequent */
    int32_t bg = freq_color[0], bgN = freq_count[0];
    for (int32_t i = 1; i < num_colors; i++) {
      if (freq_count[i] > bgN) { bg = freq_color[i]; bgN = freq_count[i]; }
    }

    DBG("solve: region len=%d, colors=%d, bg=%d(%d)\n",
        reg.len, num_colors, bg, bgN);

    /* Build region bitmap, decompose bg layer */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    memset(region_bm, 0, (size_t)cap);
    for (int32_t i = 0; i < reg.len; i++) region_bm[reg.idx[i]] = 1;
    IVec bg_rects; iv_init(&bg_rects);
    decompose_region(region_bm, reg.idx, reg.len, width, &bg_rects);
    lv_push(layers, palette[bg], bg_rects.data, bg_rects.len);

    /* Rebuild region bitmap (decompose cleared it) */
    memset(region_bm, 0, (size_t)cap);
    for (int32_t i = 0; i < reg.len; i++) region_bm[reg.idx[i]] = 1;
#ifdef CORE_DEBUG
    t1 = NOW(); t_decompose += t1 - t0;
#endif

    /* Build remaining */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    memset(remain_bm, 0, (size_t)cap);
    IVec remain_arr; iv_init(&remain_arr);
    for (int32_t i = 0; i < reg.len; i++) {
      if (pixels[reg.idx[i]] != bg) {
        remain_bm[reg.idx[i]] = 1;
        iv_push(&remain_arr, reg.idx[i]);
      }
    }
#ifdef CORE_DEBUG
    t1 = NOW(); t_remain += t1 - t0;
#endif

    /* Find components */
#ifdef CORE_DEBUG
    t0 = NOW();
#endif
    CompList cl = find_components(remain_bm, remain_arr.data, remain_arr.len,
                                 width, height, cap);
    iv_free(&remain_arr);
#ifdef CORE_DEBUG
    t1 = NOW(); t_components += t1 - t0;
#endif

    /* Process components in reverse */
    for (int32_t ci = cl.count - 1; ci >= 0; ci--) {
      IVec *comp = &cl.comps[ci];
      int32_t sub_len;
#ifdef CORE_DEBUG
      t0 = NOW();
#endif
      int32_t *sub = choose_region(comp->data, comp->len, region_bm,
                                   reg.len, bg, pixels, width, height,
                                   &sub_len);
#ifdef CORE_DEBUG
      t1 = NOW(); t_choose += t1 - t0;
#endif
      DBG("  comp[%d] len=%d -> choose_region: sub=%p sub_len=%d\n",
          ci, comp->len, (void *)sub, sub_len);
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
        IVec *cpx = (IVec *)malloc((size_t)nc2 * sizeof(IVec));
        IVec *crects = (IVec *)malloc((size_t)nc2 * sizeof(IVec));
        for (int32_t i = 0; i < nc2; i++) { iv_init(&cpx[i]); iv_init(&crects[i]); }
        for (int32_t i = 0; i < comp->len; i++) {
          int32_t slot = freq_seen[pixels[comp->data[i]]];
          iv_push(&cpx[slot], comp->data[i]);
        }
        for (int32_t i = 0; i < nc2; i++)
          freq_seen[freq_color[i]] = 0;

        /* 4. Parallel decompose per color */
        {
          int32_t nt = num_threads;
          if (nt > nc2) nt = nc2;
          if (nt < 1) nt = 1;

          FlatWorker *workers = (FlatWorker *)malloc(
              (size_t)nt * sizeof(FlatWorker));
          pthread_t *threads = (pthread_t *)malloc(
              (size_t)nt * sizeof(pthread_t));

          int32_t per = nc2 / nt;
          int32_t rem = nc2 % nt;
          int32_t start = 0;
          for (int32_t t = 0; t < nt; t++) {
            int32_t count = per + (t < rem ? 1 : 0);
            workers[t].color_pixels = cpx;
            workers[t].results = crects;
            workers[t].start = start;
            workers[t].end = start + count;
            workers[t].width = width;
            workers[t].cap = cap;
            workers[t].error = 0;
            pthread_create(&threads[t], NULL, flat_worker, &workers[t]);
            start += count;
          }
          for (int32_t t = 0; t < nt; t++)
            pthread_join(threads[t], NULL);

          free(workers);
          free(threads);
        }

        /* 5. Collect results into layers */
        for (int32_t ci2 = 0; ci2 < nc2; ci2++) {
          lv_push(layers, palette[freq_color[ci2]],
                  crects[ci2].data, crects[ci2].len);
          iv_free(&cpx[ci2]);
        }
        free(cpx);
        free(crects);
#ifdef CORE_DEBUG
        t1 = NOW(); t_flat += t1 - t0;
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
  DBG("iterations: %d, flat_fallbacks: %d, layers: %d\n",
      iterations, flat_count, layers->len);
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

  int32_t err = solve(indexed, palette, width, height, cap, num_threads, &layers);
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
