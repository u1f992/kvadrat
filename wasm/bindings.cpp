#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "core.h"

using emscripten::val;

/* Placeholder binding — returns an empty array.
   Will be replaced when the layered decomposition is ported to C. */
val processImage(val /*pixelsVal*/, int32_t /*width*/, int32_t /*height*/,
                 int32_t /*mode*/) {
  return val::array();
}

EMSCRIPTEN_BINDINGS(core) {
  emscripten::function("processImage", &processImage);
}
