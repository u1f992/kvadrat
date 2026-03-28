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

val processImageFlat(val pixelsVal, int32_t width, int32_t height) {
  if (width <= 0 || height <= 0 || (int64_t)width * height > INT32_MAX)
    return val(CORE_ERROR_ALLOC);

  std::vector<uint8_t> pixels =
      emscripten::convertJSArrayToNumberVector<uint8_t>(pixelsVal);

  LayerResult *layers = nullptr;
  int32_t numLayers = flat_decompose(pixels.data(), width, height, &layers);
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

val processImageOutline(val pixelsVal, int32_t width, int32_t height) {
  if (width <= 0 || height <= 0 || (int64_t)width * height > INT32_MAX)
    return val(CORE_ERROR_ALLOC);

  std::vector<uint8_t> pixels =
      emscripten::convertJSArrayToNumberVector<uint8_t>(pixelsVal);

  OutlineResult *results = nullptr;
  int32_t numColors = outline_decompose(pixels.data(), width, height, &results);
  if (numColors < 0)
    return val(numColors);

  val jsResults = val::array();
  for (int32_t i = 0; i < numColors; i++) {
    val entry = val::object();
    entry.set("color", results[i].color);

    val polyArray = val::global("Int32Array").new_(results[i].polygons_len);
    polyArray.call<void>(
        "set", val(emscripten::typed_memory_view(results[i].polygons_len,
                                                 results[i].polygons)));
    entry.set("polygons", polyArray);

    free(results[i].polygons);
    jsResults.call<void>("push", entry);
  }
  free(results);

  return jsResults;
}

EMSCRIPTEN_BINDINGS(core) {
  emscripten::function("processImage", &processImage);
  emscripten::function("processImageFlat", &processImageFlat);
  emscripten::function("processImageOutline", &processImageOutline);
}
