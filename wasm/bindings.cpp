#include <emscripten/bind.h>
#include <emscripten/val.h>
#include <vector>

#include "core.h"

using emscripten::val;

val processEdges(val edgesVal, int32_t edgeCount) {
  std::vector<int32_t> edges =
      emscripten::convertJSArrayToNumberVector<int32_t>(edgesVal);

  int32_t newEdgeCount = remove_bidirectional_edges(edges.data(), edgeCount);
  if (newEdgeCount < 0) {
    return val(newEdgeCount);
  }

  int32_t outCapacity = newEdgeCount * 11;
  std::vector<int32_t> out(outCapacity);
  int32_t bufLen =
      build_polygons(edges.data(), newEdgeCount, out.data(), outCapacity);
  if (bufLen < 0) {
    return val(bufLen);
  }

  int32_t finalLen = concat_polygons(out.data(), bufLen);
  if (finalLen < 0) {
    return val(finalLen);
  }

  val result = val::global("Int32Array").new_(finalLen);
  result.call<void>("set",
                     val(emscripten::typed_memory_view(finalLen, out.data())));
  return result;
}

EMSCRIPTEN_BINDINGS(core) {
  emscripten::function("processEdges", &processEdges);
}
