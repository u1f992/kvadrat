#include "core.h"
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
        /* Should not happen with valid input */
        free(adj);
        free(next_same_start);
        free(used);
        return CORE_ERROR_ALLOC;
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

int32_t concat_polygons(int32_t *buf, int32_t buf_len) {
  int32_t num_polys = poly_count(buf, buf_len);

  for (int32_t i = 0; i < num_polys; i++) {
    int32_t i_off = poly_offset(buf, buf_len, i);
    if (i_off < 0)
      break;
    int32_t i_pc = buf[i_off];
    int32_t i_pts = i_off + 1; /* start of points for polygon i */

    for (int32_t j = 0; j < i_pc; j++) {
      int32_t jx = buf[i_pts + j * 2];
      int32_t jy = buf[i_pts + j * 2 + 1];

      for (int32_t k = i + 1; k < num_polys; k++) {
        int32_t k_off = poly_offset(buf, buf_len, k);
        if (k_off < 0)
          break;
        int32_t k_pc = buf[k_off];
        int32_t k_pts = k_off + 1;
        int32_t k_size = 1 + k_pc * 2; /* total elements for polygon k */

        for (int32_t l = 0; l < k_pc - 1; l++) {
          /* Exclude end point (same as start) */
          int32_t lx = buf[k_pts + l * 2];
          int32_t ly = buf[k_pts + l * 2 + 1];

          if (jx != lx || jy != ly)
            continue;

          /* Match found: embed polygon k into polygon i at position j.
             Insert points from k into i, then remove polygon k. */
          int32_t insert_count = 0;
          /* Points to insert from polygon k:
             If l > 0: k[1..l] then k[l+1..end]
             If l == 0: k[1..end] */

          /* Calculate total points to insert */
          if (l > 0) {
            insert_count = k_pc - 1; /* all points except start (==end) */
          } else {
            insert_count = k_pc - 1;
          }
          int32_t insert_elems = insert_count * 2;

          /* Make room in polygon i: shift everything after j by
           * insert_elems */
          int32_t insert_pos =
              i_pts + (j + 1) * 2; /* byte position after point j */
          int32_t tail_len = buf_len - insert_pos;

          /* Shift tail right to make room */
          memmove(buf + insert_pos + insert_elems, buf + insert_pos,
                  (size_t)tail_len * sizeof(int32_t));
          buf_len += insert_elems;

          /* Copy points from polygon k */
          int32_t wp = insert_pos;
          if (l > 0) {
            /* First: k[1..l] */
            for (int32_t m = 1; m <= l; m++) {
              /* k_off shifted by insert_elems since it's after insert_pos
               */
              int32_t src_off = k_off + insert_elems + 1 + m * 2;
              buf[wp++] = buf[src_off];
              buf[wp++] = buf[src_off + 1];
            }
            /* Then: k[l+1..end-1] (skip last which == first) */
            for (int32_t m = l + 1; m < k_pc; m++) {
              int32_t src_off = k_off + insert_elems + 1 + m * 2;
              buf[wp++] = buf[src_off];
              buf[wp++] = buf[src_off + 1];
            }
          } else {
            /* l == 0: insert k[1..end-1] */
            for (int32_t m = 1; m < k_pc; m++) {
              int32_t src_off = k_off + insert_elems + 1 + m * 2;
              buf[wp++] = buf[src_off];
              buf[wp++] = buf[src_off + 1];
            }
          }

          /* Update polygon i's point count */
          /* i_off may have shifted if k was before i (impossible since k >
           * i) */
          buf[i_off] = i_pc + insert_count;
          i_pc = buf[i_off];

          /* Remove polygon k (which is now after the insertion) */
          int32_t new_k_off = poly_offset(buf, buf_len, k);
          int32_t new_k_size = 1 + buf[new_k_off] * 2;
          int32_t after_k = new_k_off + new_k_size;
          memmove(buf + new_k_off, buf + after_k,
                  (size_t)(buf_len - after_k) * sizeof(int32_t));
          buf_len -= new_k_size;
          num_polys--;
          k--;
          break;
        }
      }
    }
  }

  return buf_len;
}
