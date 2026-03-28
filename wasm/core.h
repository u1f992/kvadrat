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

typedef struct {
  uint32_t color; /* RGBA packed uint32 */
  int32_t *rects; /* flat [x, y, w, h, ...], caller must free */
  int32_t rects_len;
} LayerResult;

typedef struct {
  uint32_t color;    /* RGBA packed uint32 */
  int32_t *polygons; /* flat [point_count, x0, y0, ..., point_count, ...] */
  int32_t polygons_len;
} OutlineResult;

/*
 * Layered rectangle decomposition of an RGBA image (overlapping).
 * pixels: width * height * 4 bytes RGBA.
 * out_layers: pointer to array (allocated by this function).
 * Returns number of layers, or negative on error.
 * Caller must free each out_layers[i].rects, then free out_layers.
 */
int32_t layered_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                          int32_t num_threads, LayerResult **out_layers);

/*
 * Flat rectangle decomposition of an RGBA image (non-overlapping).
 * Each color gets its own layer with greedy-merged rectangles.
 * Returns number of layers, or negative on error.
 * Caller must free each out_layers[i].rects, then free out_layers.
 */
int32_t flat_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                       LayerResult **out_layers);

/*
 * Outline polygon decomposition of an RGBA image (non-overlapping).
 * Each color gets its own layer with merged polygon outlines.
 * Returns number of layers, or negative on error.
 * Caller must free each out_results[i].polygons, then free out_results.
 */
int32_t outline_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                          OutlineResult **out_results);

#ifdef __cplusplus
}
#endif

#endif
