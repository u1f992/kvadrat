import { parentPort, isMainThread } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { ColorHex } from "./color-hex.js";
// @ts-ignore -- Emscripten-generated module, no .d.ts
import createModule from "./wasm/core.js";

export const PERF_SYMBOL: unique symbol = Symbol("perf");

const wasmModule = await createModule();
const wasmRemoveBidirectionalEdges: (
  edgesPtr: number,
  edgeCount: number,
) => number = wasmModule.cwrap("remove_bidirectional_edges", "number", [
  "number",
  "number",
]);

const pointEquals = (a: [number, number], b: [number, number]) =>
  a[0] === b[0] && a[1] === b[1];

/**
 * Remove bidirectional edge pairs in-place. Returns the new edge count.
 * Edges are stored as a flat Int32Array with stride 4: [x1,y1,x2,y2, ...].
 */
export function removeBidirectionalEdges(
  edges: Int32Array,
  edgeCount: number,
): number {
  if (edgeCount <= 0) return 0;
  const byteLength = edgeCount * 4 * 4; // 4 ints per edge, 4 bytes per int
  const ptr = wasmModule._malloc(byteLength);
  if (!ptr) throw new Error("wasm malloc failed");
  try {
    wasmModule.HEAP32.set(edges.subarray(0, edgeCount * 4), ptr / 4);
    const newCount = wasmRemoveBidirectionalEdges(ptr, edgeCount);
    if (newCount < 0) throw new Error("wasm remove_bidirectional_edges failed");
    const result = wasmModule.HEAP32.subarray(ptr / 4, ptr / 4 + newCount * 4);
    edges.set(result);
    return newCount;
  } finally {
    wasmModule._free(ptr);
  }
}

export function buildPolygons(edges: Int32Array, edgeCount: number) {
  // Build adjacency index: start-point -> list of edge indices
  const adj = new Map<string, number[]>();
  for (let i = 0; i < edgeCount; i++) {
    const off = i * 4;
    const key = `${edges[off]},${edges[off + 1]}`;
    let list = adj.get(key);
    if (!list) {
      list = [];
      adj.set(key, list);
    }
    list.push(i);
  }

  const used = new Uint8Array(edgeCount);
  let remaining = edgeCount;
  let startScan = 0;

  const polygons: [number, number][][] = [];

  while (remaining > 0) {
    while (used[startScan]) startScan++;

    const polygon: [number, number][] = [];
    polygons.push(polygon);

    let edgeIdx = startScan;
    used[edgeIdx] = 1;
    remaining--;
    let off = edgeIdx * 4;
    let ex1 = edges[off]!;
    let ey1 = edges[off + 1]!;
    let ex2 = edges[off + 2]!;
    let ey2 = edges[off + 3]!;
    polygon.push([ex1, ey1]);
    polygon.push([ex2, ey2]);

    do {
      const key = `${ex2},${ey2}`;
      const candidates = adj.get(key);
      if (!candidates) throw new Error(`no next edge found at ${ex2},${ey2}`);

      let foundEdge = false;
      for (let ci = 0; ci < candidates.length; ci++) {
        const idx = candidates[ci]!;
        if (used[idx]) continue;

        foundEdge = true;
        used[idx] = 1;
        remaining--;
        off = idx * 4;
        ex1 = edges[off]!;
        ey1 = edges[off + 1]!;
        ex2 = edges[off + 2]!;
        ey2 = edges[off + 3]!;

        const secondLastPoint = polygon[polygon.length - 2]!;
        const lastPoint = polygon[polygon.length - 1]!;
        // Extend polygon end if it's continuing in the same direction
        if (
          secondLastPoint[0] === lastPoint[0] && // polygon ends vertical
          lastPoint[0] === ex2
        ) {
          polygon[polygon.length - 1]![1] = ey2;
        } else if (
          secondLastPoint[1] === lastPoint[1] && // polygon ends horizontal
          lastPoint[1] === ey2
        ) {
          polygon[polygon.length - 1]![0] = ex2;
        } else {
          polygon.push([ex2, ey2]);
        }
        break;
      }
      if (!foundEdge) throw new Error(`no next edge found at ${ex2},${ey2}`);
    } while (!pointEquals(polygon[polygon.length - 1]!, polygon[0]!));

    // Move polygon's start and end point into a corner
    if (
      polygon[0]![0] === polygon[1]![0] &&
      polygon[polygon.length - 2]![0] === polygon[polygon.length - 1]![0]
    ) {
      polygon.length--;
      polygon[0]![1] = polygon[polygon.length - 1]![1];
    } else if (
      polygon[0]![1] === polygon[1]![1] &&
      polygon[polygon.length - 2]![1] === polygon[polygon.length - 1]![1]
    ) {
      polygon.length--;
      polygon[0]![0] = polygon[polygon.length - 1]![0];
    }
  }

  return polygons;
}

export function concatPolygons(polygons: [number, number][][]) {
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

export const generateSVGPathData = (polygons: [number, number][][]) =>
  polygons
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

export function toSVGPath(
  hex: ColorHex,
  edges: Int32Array,
  edgeCount: number,
  perf?: PerfContext,
): string {
  if (perf) perf.marks["start"] = performance.now();
  edgeCount = removeBidirectionalEdges(edges, edgeCount);
  if (perf) perf.marks["removeEdges"] = performance.now();
  const polygons = buildPolygons(edges, edgeCount);
  if (perf) perf.marks["buildPolygons"] = performance.now();
  concatPolygons(polygons);
  if (perf) perf.marks["concatPolygons"] = performance.now();
  const d = generateSVGPathData(polygons);
  if (perf) {
    perf.marks["generateSVG"] = performance.now();
    perf.polygonCount = polygons.length;
  }
  return `<path stroke="none" fill="${hex}" d="${d}"/>`;
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
