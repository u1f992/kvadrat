#ifndef CORE_H
#define CORE_H

#include <stdint.h>

#define CORE_ERROR_ALLOC (-1)
#define CORE_ERROR_CAPACITY (-2)
#define CORE_ERROR_BROKEN_CHAIN (-3)

#ifdef __cplusplus
extern "C" {
#endif

int32_t remove_bidirectional_edges(int32_t *edges, int32_t edge_count);

/* Build polygons from edges into a flat buffer.
   Output format: [point_count, x0, y0, x1, y1, ..., point_count, ...]
   Returns: total int32 elements written, or negative on error. */
int32_t build_polygons(const int32_t *edges, int32_t edge_count, int32_t *out,
                       int32_t out_capacity);

/* Merge touching polygons in-place in a flat buffer.
   buf_len: number of valid int32 elements in buf.
   Returns: new buf_len after merging, or negative on error. */
int32_t concat_polygons(int32_t *buf, int32_t buf_len);

#ifdef __cplusplus
}
#endif

#endif
