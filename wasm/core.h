#ifndef CORE_H
#define CORE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
  CORE_ERROR_ALLOC = -1,
};

typedef struct {
  uint32_t color; /* RGBA packed uint32 */
  int32_t *rects; /* flat [x, y, w, h, ...], caller must free */
  int32_t rects_len;
} LayerResult;

/*
 * Layered rectangle decomposition of an RGBA image.
 * pixels: width * height * 4 bytes RGBA.
 * out_layers: pointer to array (allocated by this function).
 * Returns number of layers, or negative on error.
 * Caller must free each out_layers[i].rects, then free out_layers.
 */
int32_t layered_decompose(const uint8_t *pixels, int32_t width, int32_t height,
                          int32_t num_threads, LayerResult **out_layers);

#ifdef __cplusplus
}
#endif

#endif
