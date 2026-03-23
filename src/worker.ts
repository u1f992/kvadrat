import { parentPort, isMainThread } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { ColorHex } from "./color-hex.js";
// @ts-ignore -- Emscripten-generated module, no .d.ts
import createModule from "./wasm/core.js";

export const PERF_SYMBOL: unique symbol = Symbol("perf");

const wasmModule = await createModule();

const wasmRemoveBidirectionalEdges: (ptr: number, count: number) => number =
  wasmModule.cwrap("remove_bidirectional_edges", "number", [
    "number",
    "number",
  ]);

const wasmBuildPolygons: (
  edgesPtr: number,
  edgeCount: number,
  outPtr: number,
  outCapacity: number,
) => number = wasmModule.cwrap("build_polygons", "number", [
  "number",
  "number",
  "number",
  "number",
]);

const wasmConcatPolygons: (bufPtr: number, bufLen: number) => number =
  wasmModule.cwrap("concat_polygons", "number", ["number", "number"]);

const pointEquals = (a: [number, number], b: [number, number]) =>
  a[0] === b[0] && a[1] === b[1];

/** Parse flat polygon buffer into JS polygon arrays. */
function parseFlatPolygons(
  buf: Int32Array,
  bufLen: number,
): [number, number][][] {
  const polygons: [number, number][][] = [];
  let pos = 0;
  while (pos < bufLen) {
    const pc = buf[pos]!;
    pos++;
    const polygon: [number, number][] = [];
    for (let i = 0; i < pc; i++) {
      polygon.push([buf[pos + i * 2]!, buf[pos + i * 2 + 1]!]);
    }
    pos += pc * 2;
    polygons.push(polygon);
  }
  return polygons;
}

function concatPolygons(polygons: [number, number][][]) {
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i]!;
    for (let j = 0; j < polygon.length; j++) {
      const point = polygon[j]!;
      for (let k = i + 1; k < polygons.length; k++) {
        const polygon2 = polygons[k]!;
        for (let l = 0; l < polygon2.length - 1; l++) {
          const point2 = polygon2[l]!;
          if (pointEquals(point, point2)) {
            if (l > 0) {
              polygon.splice.apply(
                polygon,
                // @ts-ignore
                [j + 1, 0].concat(polygon2.slice(1, l + 1)),
              );
            }
            polygon.splice.apply(
              polygon,
              // @ts-ignore
              [j + 1, 0].concat(polygon2.slice(l + 1)),
            );
            polygons.splice(k, 1);
            k--;
            break;
          }
        }
      }
    }
  }
}

function generateSVGPathData(polygons: [number, number][][]): string {
  return polygons
    .map(
      (polygon) =>
        "M" +
        polygon[0]![0] +
        "," +
        polygon[0]![1] +
        polygon
          .slice(1)
          .map((point, j) =>
            point[0] === polygon[j]![0]
              ? "v" + (point[1] - polygon[j]![1])
              : "h" + (point[0] - polygon[j]![0]),
          )
          .join("") +
        "z",
    )
    .join("");
}

export type WorkerPerf = {
  hex: string;
  edges: number;
  polygons: number;
  removeEdges: number;
  buildPolygons: number;
  concatPolygons: number;
  generateSVG: number;
  total: number;
};

export type PerfContext = {
  marks: Record<string, number>;
  polygonCount: number;
};

/**
 * Process edges through the full Wasm pipeline and generate an SVG path element.
 */
export function toSVGPath(
  hex: ColorHex,
  edges: Int32Array,
  edgeCount: number,
  perf?: PerfContext,
): string {
  if (edgeCount <= 0) return `<path stroke="none" fill="${hex}" d=""/>`;

  const edgeBytes = edgeCount * 4 * 4;
  /* Worst case: each edge becomes a separate polygon with 5 points (closed
     rectangle), requiring 1 (count) + 5*2 (coords) = 11 int32s per edge.
     concat_polygons only shrinks the buffer (net -3 per merge). */
  const outCapacity = edgeCount * 11;
  const outBytes = outCapacity * 4;
  const totalBytes = edgeBytes + outBytes;

  const ptr = wasmModule._malloc(totalBytes);
  if (!ptr) throw new Error("wasm malloc failed");

  const edgesPtr = ptr;
  const outPtr = ptr + edgeBytes;

  try {
    wasmModule.HEAP32.set(edges.subarray(0, edgeCount * 4), edgesPtr / 4);

    if (perf) perf.marks["start"] = performance.now();
    const newEdgeCount = wasmRemoveBidirectionalEdges(edgesPtr, edgeCount);
    if (newEdgeCount < 0)
      throw new Error("wasm remove_bidirectional_edges failed");
    if (perf) perf.marks["removeEdges"] = performance.now();

    const bufLen = wasmBuildPolygons(
      edgesPtr,
      newEdgeCount,
      outPtr,
      outCapacity,
    );
    if (bufLen < 0) throw new Error("wasm build_polygons failed");
    if (perf) perf.marks["buildPolygons"] = performance.now();

    const finalLen = wasmConcatPolygons(outPtr, bufLen);
    if (finalLen < 0) throw new Error("wasm concat_polygons failed");
    if (perf) perf.marks["concatPolygons"] = performance.now();

    /* Read flat buffer and convert to JS polygon arrays for SVG generation */
    const flatBuf = new Int32Array(finalLen);
    flatBuf.set(wasmModule.HEAP32.subarray(outPtr / 4, outPtr / 4 + finalLen));
    const polygons = parseFlatPolygons(flatBuf, finalLen);

    const d = generateSVGPathData(polygons);
    if (perf) {
      perf.marks["generateSVG"] = performance.now();
      perf.polygonCount = polygons.length;
    }

    return `<path stroke="none" fill="${hex}" d="${d}"/>`;
  } finally {
    wasmModule._free(ptr);
  }
}

export function collectPerf(
  hex: ColorHex,
  edges: Int32Array,
  edgeCount: number,
): { svg: string; perf: WorkerPerf } {
  const ctx: PerfContext = { marks: {}, polygonCount: 0 };
  const svg = toSVGPath(hex, edges, edgeCount, ctx);
  const m = ctx.marks;
  return {
    svg,
    perf: {
      hex,
      edges: edgeCount,
      polygons: ctx.polygonCount,
      removeEdges: m["removeEdges"]! - m["start"]!,
      buildPolygons: m["buildPolygons"]! - m["removeEdges"]!,
      concatPolygons: m["concatPolygons"]! - m["buildPolygons"]!,
      generateSVG: m["generateSVG"]! - m["concatPolygons"]!,
      total: m["generateSVG"]! - m["start"]!,
    },
  };
}

if (!isMainThread) {
  parentPort!.on(
    "message",
    (msg: {
      hex: ColorHex;
      edges: Int32Array;
      edgeCount: number;
      returnPerf: boolean;
    }) => {
      if (msg.returnPerf) {
        parentPort!.postMessage(collectPerf(msg.hex, msg.edges, msg.edgeCount));
      } else {
        const svg = toSVGPath(msg.hex, msg.edges, msg.edgeCount);
        parentPort!.postMessage({ svg });
      }
    },
  );
}
