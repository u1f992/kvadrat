#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>

#include "core.h"

using emscripten::val;

val processImage(val pixelsVal, int32_t width, int32_t height,
                 int32_t numThreads) {
  if (width <= 0 || height <= 0 || (int64_t)width * height > INT32_MAX)
    return val(CORE_ERROR_ALLOC);

  std::vector<uint8_t> pixels =
      emscripten::convertJSArrayToNumberVector<uint8_t>(pixelsVal);

  LayerResult *layers = nullptr;
  int32_t numLayers =
      layered_decompose(pixels.data(), width, height, numThreads, &layers);
  if (numLayers < 0)
    return val(numLayers);

  val jsLayers = val::array();
  for (int32_t i = 0; i < numLayers; i++) {
    val entry = val::object();
    entry.set("color", layers[i].color);

    val rectsArray = val::global("Int32Array").new_(layers[i].rects_len);
    rectsArray.call<void>("set", val(emscripten::typed_memory_view(
                                     layers[i].rects_len, layers[i].rects)));
    entry.set("rects", rectsArray);

    free(layers[i].rects);
    jsLayers.call<void>("push", entry);
  }
  free(layers);

  return jsLayers;
}

EMSCRIPTEN_BINDINGS(core) {
  emscripten::function("processImage", &processImage);
}
