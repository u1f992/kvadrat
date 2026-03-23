#include "core.h"
#ifdef __EMSCRIPTEN__
#include <emscripten/threading.h>
#endif
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#define POINT_KEY(x, y) (((uint64_t)(uint16_t)(x) << 16) | (uint16_t)(y))

typedef struct {
  uint64_t key;
  int32_t value;
  uint8_t occupied;
} HashEntry;

/* Encode edge coordinates as a 64-bit key. Each coordinate is truncated to
   16 bits, limiting supported image dimensions to 65535 pixels per axis. */
static uint64_t encode_edge_key(int32_t x1, int32_t y1, int32_t x2,
                                int32_t y2) {
  return ((uint64_t)(uint16_t)x1 << 48) | ((uint64_t)(uint16_t)y1 << 32) |
         ((uint64_t)(uint16_t)x2 << 16) | (uint16_t)y2;
}

static uint64_t hash64(uint64_t key) {
  key ^= key >> 33;
  key *= 0xff51afd7ed558ccdULL;
  key ^= key >> 33;
  key *= 0xc4ceb9fe1a85ec53ULL;
  key ^= key >> 33;
  return key;
}

static int32_t hash_find(const HashEntry *table, int32_t capacity,
                         uint64_t key) {
  if (capacity <= 0)
    return -1;
  int32_t idx = (int32_t)(hash64(key) % (uint64_t)capacity);
  while (table[idx].occupied) {
    if (table[idx].key == key) {
      return idx;
    }
    idx = (idx + 1) % capacity;
  }
  return -1;
}

static int32_t hash_insert(HashEntry *table, int32_t capacity, uint64_t key,
                           int32_t value) {
  if (capacity <= 0)
    return -1;
  int32_t idx = (int32_t)(hash64(key) % (uint64_t)capacity);
  while (table[idx].occupied) {
    if (table[idx].key == key) {
      return idx;
    }
    idx = (idx + 1) % capacity;
  }
  table[idx].key = key;
  table[idx].value = value;
  table[idx].occupied = 1;
  return idx;
}

static void hash_remove(HashEntry *table, int32_t capacity, int32_t idx) {
  if (capacity <= 0)
    return;
  table[idx].occupied = 0;

  /* Rehash subsequent entries to maintain linear probing invariant */
  int32_t next = (idx + 1) % capacity;
  while (table[next].occupied) {
    uint64_t k = table[next].key;
    int32_t v = table[next].value;
    table[next].occupied = 0;
    hash_insert(table, capacity, k, v);
    next = (next + 1) % capacity;
  }
}

int32_t remove_bidirectional_edges(int32_t *edges, int32_t edge_count) {
  if (edge_count <= 0) {
    return 0;
  }

  int32_t capacity = edge_count * 2;
  HashEntry *table = (HashEntry *)calloc((size_t)capacity, sizeof(HashEntry));
  uint8_t *to_remove = (uint8_t *)calloc((size_t)edge_count, 1);
  if (!table || !to_remove) {
    free(table);
    free(to_remove);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t i = 0; i < edge_count; i++) {
    int32_t off = i * 4;
    int32_t x1 = edges[off];
    int32_t y1 = edges[off + 1];
    int32_t x2 = edges[off + 2];
    int32_t y2 = edges[off + 3];

    uint64_t reverse_key = encode_edge_key(x2, y2, x1, y1);
    int32_t found = hash_find(table, capacity, reverse_key);

    if (found >= 0) {
      to_remove[i] = 1;
      to_remove[table[found].value] = 1;
      hash_remove(table, capacity, found);
    } else {
      uint64_t key = encode_edge_key(x1, y1, x2, y2);
      hash_insert(table, capacity, key, i);
    }
  }

  int32_t write_index = 0;
  for (int32_t read_index = 0; read_index < edge_count; read_index++) {
    if (!to_remove[read_index]) {
      if (write_index != read_index) {
        int32_t r_off = read_index * 4;
        int32_t w_off = write_index * 4;
        edges[w_off] = edges[r_off];
        edges[w_off + 1] = edges[r_off + 1];
        edges[w_off + 2] = edges[r_off + 2];
        edges[w_off + 3] = edges[r_off + 3];
      }
      write_index++;
    }
  }

  free(table);
  free(to_remove);
  return write_index;
}

int32_t build_polygons(const int32_t *edges, int32_t edge_count, int32_t *out,
                       int32_t out_capacity) {
  if (edge_count <= 0) {
    return 0;
  }

  /* Adjacency: hash table maps start-point to head of linked list.
     next_same_start[i] links edges sharing the same start point. */
  int32_t adj_capacity = edge_count * 2;
  HashEntry *adj = (HashEntry *)calloc((size_t)adj_capacity, sizeof(HashEntry));
  int32_t *next_same_start =
      (int32_t *)malloc((size_t)edge_count * sizeof(int32_t));
  uint8_t *used = (uint8_t *)calloc((size_t)edge_count, 1);
  if (!adj || !next_same_start || !used) {
    free(adj);
    free(next_same_start);
    free(used);
    return CORE_ERROR_ALLOC;
  }
  memset(next_same_start, -1, (size_t)edge_count * sizeof(int32_t));

  for (int32_t i = 0; i < edge_count; i++) {
    int32_t off = i * 4;
    uint64_t key = POINT_KEY(edges[off], edges[off + 1]);
    int32_t found = hash_find(adj, adj_capacity, key);
    if (found >= 0) {
      /* Prepend to existing linked list */
      next_same_start[i] = adj[found].value;
      adj[found].value = i;
    } else {
      hash_insert(adj, adj_capacity, key, i);
    }
  }

  int32_t remaining = edge_count;
  int32_t start_scan = 0;
  int32_t out_pos = 0;

  while (remaining > 0) {
    while (used[start_scan])
      start_scan++;

    /* Reserve space for point_count (filled later) */
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
    int32_t first_x = edges[off];
    int32_t first_y = edges[off + 1];
    int32_t cur_x = edges[off + 2];
    int32_t cur_y = edges[off + 3];

/* Helper: append point to output, checking capacity */
#define EMIT_POINT(px, py)                                                     \
  do {                                                                         \
    if (out_pos + 2 > out_capacity) {                                          \
      free(adj);                                                               \
      free(next_same_start);                                                   \
      free(used);                                                              \
      return CORE_ERROR_CAPACITY;                                              \
    }                                                                          \
    out[out_pos++] = (px);                                                     \
    out[out_pos++] = (py);                                                     \
    point_count++;                                                             \
  } while (0)

    EMIT_POINT(first_x, first_y);
    EMIT_POINT(cur_x, cur_y);

    /* Track last two points for collinear merging */
    int32_t prev_x = first_x, prev_y = first_y;
    int32_t last_x = cur_x, last_y = cur_y;

    do {
      uint64_t key = POINT_KEY(cur_x, cur_y);
      int32_t slot = hash_find(adj, adj_capacity, key);
      int32_t found_edge = -1;

      if (slot >= 0) {
        /* Walk linked list to find an unused edge */
        int32_t prev_link = -1;
        int32_t idx = adj[slot].value;
        while (idx >= 0) {
          if (!used[idx]) {
            found_edge = idx;
            break;
          }
          prev_link = idx;
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
      int32_t new_x = edges[off + 2];
      int32_t new_y = edges[off + 3];

      /* Collinear merge: extend last point instead of adding new one */
      if (prev_x == last_x && last_x == new_x) {
        /* Vertical continuation */
        out[out_pos - 1] = new_y;
        last_y = new_y;
      } else if (prev_y == last_y && last_y == new_y) {
        /* Horizontal continuation */
        out[out_pos - 2] = new_x;
        last_x = new_x;
      } else {
        prev_x = last_x;
        prev_y = last_y;
        last_x = new_x;
        last_y = new_y;
        EMIT_POINT(new_x, new_y);
      }

      cur_x = new_x;
      cur_y = new_y;
    } while (!(cur_x == first_x && cur_y == first_y));

    /* Adjust start/end if they lie on the same line */
    int32_t p0_x = out[count_pos + 1];
    int32_t p0_y = out[count_pos + 2];
    int32_t p1_x = out[count_pos + 3];
    int32_t p1_y = out[count_pos + 4];
    int32_t pn_x = out[out_pos - 4]; /* second-to-last point */
    int32_t pn_y = out[out_pos - 3];
    int32_t pe_x = out[out_pos - 2]; /* last point (== first) */
    int32_t pe_y = out[out_pos - 1];

    if (p0_x == p1_x && pn_x == pe_x) {
      /* Start/end along vertical line: merge */
      point_count--;
      out_pos -= 2;
      out[count_pos + 2] = pn_y; /* adjust first point's y */
    } else if (p0_y == p1_y && pn_y == pe_y) {
      /* Start/end along horizontal line: merge */
      point_count--;
      out_pos -= 2;
      out[count_pos + 1] = pn_x; /* adjust first point's x */
    }

#undef EMIT_POINT

    out[count_pos] = point_count;
  }

  free(adj);
  free(next_same_start);
  free(used);
  return out_pos;
}

/* Helper: get the start offset of the n-th polygon in a flat buffer. */
static int32_t poly_offset(const int32_t *buf, int32_t buf_len, int32_t index) {
  int32_t pos = 0;
  for (int32_t i = 0; i < index; i++) {
    if (pos >= buf_len)
      return -1;
    int32_t pc = buf[pos];
    pos += 1 + pc * 2;
  }
  return pos < buf_len ? pos : -1;
}

/* Helper: count polygons in a flat buffer. */
static int32_t poly_count(const int32_t *buf, int32_t buf_len) {
  int32_t count = 0;
  int32_t pos = 0;
  while (pos < buf_len) {
    int32_t pc = buf[pos];
    pos += 1 + pc * 2;
    count++;
  }
  return count;
}

int32_t concat_polygons(int32_t *buf, int32_t buf_len, int32_t buf_capacity) {
  int32_t num_polys = poly_count(buf, buf_len);
  if (num_polys <= 1)
    return buf_len;

  /* Build offset index for O(1) polygon access */
  int32_t *offsets =
      (int32_t *)malloc((size_t)num_polys * sizeof(int32_t));
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
          int32_t lx = buf[k_pts + l * 2];
          int32_t ly = buf[k_pts + l * 2 + 1];

          if (jx != lx || jy != ly)
            continue;

          /* Save polygon k's points to a temp buffer */
          int32_t *k_copy =
              (int32_t *)malloc((size_t)k_size * sizeof(int32_t));
          if (!k_copy) {
            free(offsets);
            return CORE_ERROR_ALLOC;
          }
          memcpy(k_copy, buf + k_off, (size_t)k_size * sizeof(int32_t));

          /* Remove polygon k from buf */
          int32_t after_k = k_off + k_size;
          memmove(buf + k_off, buf + after_k,
                  (size_t)(buf_len - after_k) * sizeof(int32_t));
          buf_len -= k_size;

          /* Update offsets: shift entries after k, remove k */
          for (int32_t n = k; n < num_polys - 1; n++)
            offsets[n] = offsets[n + 1] - k_size;
          num_polys--;

          /* Insert points from k_copy into polygon i */
          int32_t insert_count = k_pc - 1;
          int32_t insert_elems = insert_count * 2;
          int32_t insert_pos = i_pts + (j + 1) * 2;
          int32_t tail_len = buf_len - insert_pos;

          if (buf_len + insert_elems > buf_capacity) {
            free(k_copy);
            free(offsets);
            return CORE_ERROR_CAPACITY;
          }
          memmove(buf + insert_pos + insert_elems, buf + insert_pos,
                  (size_t)tail_len * sizeof(int32_t));
          buf_len += insert_elems;

          /* Update offsets: shift entries after i */
          for (int32_t n = i + 1; n < num_polys; n++)
            offsets[n] += insert_elems;

          /* JS splice order: k[l+1..end-1] then k[1..l] */
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

/* Pack RGBA bytes into a uint32 key. */
static uint32_t rgba_key(uint8_t r, uint8_t g, uint8_t b, uint8_t a) {
  return ((uint32_t)r << 24) | ((uint32_t)g << 16) | ((uint32_t)b << 8) | a;
}

/* Per-color pipeline worker for pthread parallelization. */
typedef struct {
  int32_t c_start;
  int32_t c_end;
  int32_t **edge_bufs;
  int32_t *edge_offsets;
  ColorResult *out_results;
  uint32_t *color_list;
  int32_t error;
} PipelineTask;

static void *pipeline_worker(void *arg) {
  PipelineTask *task = (PipelineTask *)arg;
  task->error = 0;

  for (int32_t c = task->c_start; c < task->c_end; c++) {
    int32_t edge_count = task->edge_offsets[c] / 4;
    int32_t *edges = task->edge_bufs[c];

    int32_t new_ec = remove_bidirectional_edges(edges, edge_count);
    if (new_ec < 0) {
      task->error = new_ec;
      return NULL;
    }

    int32_t out_cap = new_ec * 11;
    int32_t *poly_buf = (int32_t *)malloc((size_t)out_cap * sizeof(int32_t));
    if (!poly_buf) {
      task->error = CORE_ERROR_ALLOC;
      return NULL;
    }

    int32_t buf_len = build_polygons(edges, new_ec, poly_buf, out_cap);
    free(edges);
    task->edge_bufs[c] = NULL;

    if (buf_len < 0) {
      free(poly_buf);
      task->error = buf_len;
      return NULL;
    }

    int32_t final_len = concat_polygons(poly_buf, buf_len, out_cap);
    if (final_len < 0) {
      free(poly_buf);
      task->error = final_len;
      return NULL;
    }

    task->out_results[c].rgba = task->color_list[c];
    task->out_results[c].polygons = poly_buf;
    task->out_results[c].polygons_len = final_len;
  }
  return NULL;
}

/* Cleanup helper for process_image error paths. */
static inline void pipeline_error_cleanup(int32_t **edge_bufs,
                                          int32_t first_edge,
                                          int32_t num_colors,
                                          ColorResult *out_results,
                                          int32_t completed_colors,
                                          int32_t *edge_offsets,
                                          uint32_t *color_list) {
  for (int32_t j = first_edge; j < num_colors; j++)
    free(edge_bufs[j]);
  for (int32_t j = 0; j < completed_colors; j++)
    free(out_results[j].polygons);
  free(edge_bufs);
  free(edge_offsets);
  free(color_list);
}

/* Hash table entry for color classification: key=rgba, value=pixel count or
   edge buffer index. We reuse the generic HashEntry with uint64_t key. */
int32_t process_image(const uint8_t *pixels, int32_t width, int32_t height,
                      ColorResult *out_results, int32_t out_capacity) {
  int32_t num_pixels = width * height;

  /* Pass 1: Count pixels per color using hash table.
     key = rgba packed as uint64_t, value = count. */
  /* Load factor ~50% to avoid linear probing degradation and infinite loops.
     Use int64 to avoid overflow on large images. */
  int64_t color_cap_64 =
      num_pixels < 1024 ? 2048 : (int64_t)num_pixels * 2;
  if (color_cap_64 > INT32_MAX)
    return CORE_ERROR_CAPACITY;
  int32_t color_cap = (int32_t)color_cap_64;
  HashEntry *color_table =
      (HashEntry *)calloc((size_t)color_cap, sizeof(HashEntry));
  if (!color_table)
    return CORE_ERROR_ALLOC;

  /* Track unique colors in insertion order */
  int32_t num_colors = 0;
  uint32_t *color_list =
      (uint32_t *)malloc((size_t)out_capacity * sizeof(uint32_t));
  if (!color_list) {
    free(color_table);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t i = 0; i < num_pixels; i++) {
    int32_t off = i * 4;
    uint32_t rgba =
        rgba_key(pixels[off], pixels[off + 1], pixels[off + 2], pixels[off + 3]);
    uint64_t key = (uint64_t)rgba;

    int32_t slot = hash_find(color_table, color_cap, key);
    if (slot >= 0) {
      color_table[slot].value++;
    } else {
      if (num_colors >= out_capacity) {
        free(color_table);
        free(color_list);
        return CORE_ERROR_CAPACITY;
      }
      hash_insert(color_table, color_cap, key, 1);
      color_list[num_colors++] = rgba;
    }
  }

  /* Allocate edge buffers per color: 4 edges * 4 ints = 16 ints per pixel */
  int32_t **edge_bufs = (int32_t **)calloc((size_t)num_colors, sizeof(int32_t *));
  int32_t *edge_offsets = (int32_t *)calloc((size_t)num_colors, sizeof(int32_t));
  if (!edge_bufs || !edge_offsets) {
    free(color_table);
    free(color_list);
    free(edge_bufs);
    free(edge_offsets);
    return CORE_ERROR_ALLOC;
  }

  /* Build a color -> index mapping using another hash table */
  HashEntry *idx_table =
      (HashEntry *)calloc((size_t)color_cap, sizeof(HashEntry));
  if (!idx_table) {
    free(color_table);
    free(color_list);
    free(edge_bufs);
    free(edge_offsets);
    return CORE_ERROR_ALLOC;
  }

  for (int32_t c = 0; c < num_colors; c++) {
    uint64_t key = (uint64_t)color_list[c];
    int32_t slot = hash_find(color_table, color_cap, key);
    int32_t count = color_table[slot].value;
    edge_bufs[c] = (int32_t *)malloc((size_t)count * 16 * sizeof(int32_t));
    if (!edge_bufs[c]) {
      for (int32_t j = 0; j < c; j++)
        free(edge_bufs[j]);
      free(edge_bufs);
      free(edge_offsets);
      free(color_table);
      free(color_list);
      free(idx_table);
      return CORE_ERROR_ALLOC;
    }
    hash_insert(idx_table, color_cap, key, c);
  }

  /* Pass 2: Fill edges */
  for (int32_t y = 0; y < height; y++) {
    for (int32_t x = 0; x < width; x++) {
      int32_t pi = (y * width + x) * 4;
      uint32_t rgba =
          rgba_key(pixels[pi], pixels[pi + 1], pixels[pi + 2], pixels[pi + 3]);
      int32_t slot = hash_find(idx_table, color_cap, (uint64_t)rgba);
      int32_t c = idx_table[slot].value;
      int32_t *buf = edge_bufs[c];
      int32_t off = edge_offsets[c];

      buf[off++] = x;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y + 1;
      buf[off++] = x + 1;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y;

      edge_offsets[c] = off;
    }
  }

  free(color_table);
  free(idx_table);

  /* Process each color through the pipeline (parallel) */
  {
    int32_t num_threads = 4; /* default, will be overridden by actual core count
                                via Emscripten pthread pool */
#ifdef __EMSCRIPTEN__
    num_threads = emscripten_num_logical_cores();
#endif
    if (num_threads > num_colors)
      num_threads = num_colors;
    if (num_threads < 1)
      num_threads = 1;

    PipelineTask *tasks =
        (PipelineTask *)malloc((size_t)num_threads * sizeof(PipelineTask));
    pthread_t *threads =
        (pthread_t *)malloc((size_t)num_threads * sizeof(pthread_t));
    if (!tasks || !threads) {
      free(tasks);
      free(threads);
      pipeline_error_cleanup(edge_bufs, 0, num_colors, out_results, 0,
                             edge_offsets, color_list);
      return CORE_ERROR_ALLOC;
    }

    int32_t colors_per_thread = num_colors / num_threads;
    int32_t remainder = num_colors % num_threads;
    int32_t c_start = 0;

    for (int32_t t = 0; t < num_threads; t++) {
      int32_t count = colors_per_thread + (t < remainder ? 1 : 0);
      tasks[t].c_start = c_start;
      tasks[t].c_end = c_start + count;
      tasks[t].edge_bufs = edge_bufs;
      tasks[t].edge_offsets = edge_offsets;
      tasks[t].out_results = out_results;
      tasks[t].color_list = color_list;
      tasks[t].error = 0;
      pthread_create(&threads[t], NULL, pipeline_worker, &tasks[t]);
      c_start += count;
    }

    int32_t first_error = 0;
    for (int32_t t = 0; t < num_threads; t++) {
      pthread_join(threads[t], NULL);
      if (tasks[t].error != 0 && first_error == 0)
        first_error = tasks[t].error;
    }

    free(tasks);
    free(threads);

    if (first_error != 0) {
      /* Clean up all results — some threads may have succeeded */
      for (int32_t c = 0; c < num_colors; c++) {
        free(edge_bufs[c]);
        free(out_results[c].polygons);
      }
      free(edge_bufs);
      free(edge_offsets);
      free(color_list);
      return first_error;
    }
  }

  free(edge_bufs);
  free(edge_offsets);
  free(color_list);
  return num_colors;
}
