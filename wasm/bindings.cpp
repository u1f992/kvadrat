#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>

#include "core.h"

using emscripten::val;

val processImage(val pixelsVal, int32_t width, int32_t height) {
  std::vector<uint8_t> pixels =
      emscripten::convertJSArrayToNumberVector<uint8_t>(pixelsVal);

  /* Allocate result array with generous capacity */
  int32_t maxColors = width * height; /* theoretical max */
  if (maxColors > 65536)
    maxColors = 65536; /* practical limit */
  std::vector<ColorResult> results(maxColors);

  int32_t numColors =
      process_image(pixels.data(), width, height, results.data(), maxColors);
  if (numColors < 0) {
    return val(numColors);
  }

  /* Build JS array of { rgba, polygons } */
  val jsResults = val::array();
  for (int32_t i = 0; i < numColors; i++) {
    val entry = val::object();
    entry.set("rgba", results[i].rgba);

    val polyArray = val::global("Int32Array").new_(results[i].polygons_len);
    polyArray.call<void>(
        "set", val(emscripten::typed_memory_view(results[i].polygons_len,
                                                 results[i].polygons)));
    entry.set("polygons", polyArray);

    free(results[i].polygons);
    jsResults.call<void>("push", entry);
  }

  return jsResults;
}

EMSCRIPTEN_BINDINGS(core) {
  emscripten::function("processImage", &processImage);
}
