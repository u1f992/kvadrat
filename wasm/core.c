#include "core.h"
#include <stdlib.h>
#include <string.h>

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
