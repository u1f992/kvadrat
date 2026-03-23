#ifndef CORE_H
#define CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  CORE_ERROR_ALLOC = -1,
  CORE_ERROR_CAPACITY = -2,
  CORE_ERROR_BROKEN_CHAIN = -3,
};

typedef enum {
  CORE_MODE_POLYGON = 0,
  CORE_MODE_RECTANGLE = 1,
} CoreMode;

int32_t remove_bidirectional_edges(int32_t *edges, int32_t edge_count);

/* Build polygons from edges into a flat buffer.
   Output format: [point_count, x0, y0, x1, y1, ..., point_count, ...]
   Returns: total int32 elements written, or negative on error. */
int32_t build_polygons(const int32_t *edges, int32_t edge_count, int32_t *out,
                       int32_t out_capacity);

/* Merge touching polygons in-place in a flat buffer.
   buf_len: number of valid int32 elements in buf.
   Returns: new buf_len after merging, or negative on error. */
int32_t concat_polygons(int32_t *buf, int32_t buf_len, int32_t buf_capacity);

/* Build rectangles from pixel coordinates using greedy row-run + vertical
   extension. coords: flat [x0, y0, x1, y1, ...] pairs, count entries.
   Output format: [x, y, w, h, ...].
   Returns: total int32 elements written, or negative on error. */
int32_t build_rectangles(const int32_t *coords, int32_t count, int32_t width,
                         int32_t height, int32_t *out, int32_t out_capacity);

/* Result for one color from process_image. */
typedef struct {
  uint32_t rgba;
  int32_t *polygons; /* flat buffer: polygons or rectangles, caller must free */
  int32_t polygons_len;
} ColorResult;

/* Process an RGBA pixel buffer into per-color polygon or rectangle buffers.
   pixels: width * height * 4 bytes RGBA.
   mode: CORE_MODE_POLYGON or CORE_MODE_RECTANGLE.
   out_results: caller-provided array of ColorResult, capacity out_capacity.
   Returns: number of colors written, or negative on error.
   Caller must free each out_results[i].polygons. */
int32_t process_image(const uint8_t *pixels, int32_t width, int32_t height,
                      CoreMode mode, ColorResult *out_results,
                      int32_t out_capacity);

#ifdef __cplusplus
}
#endif

#endif
