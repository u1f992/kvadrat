import { parentPort, isMainThread } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { ColorHex } from "./color-hex.js";
// @ts-ignore -- Emscripten-generated module, no .d.ts
import createModule from "./wasm/core.js";

export const PERF_SYMBOL: unique symbol = Symbol("perf");

const wasmModule = await createModule();

/** Parse flat polygon buffer into JS polygon arrays for SVG generation. */
function parseFlatPolygons(buf: Int32Array): [number, number][][] {
  const polygons: [number, number][][] = [];
  let pos = 0;
  while (pos < buf.length) {
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

  if (perf) perf.marks["start"] = performance.now();
  const flatBuf: Int32Array = wasmModule.processEdges(
    edges.subarray(0, edgeCount * 4),
    edgeCount,
  );
  if (perf) perf.marks["concatPolygons"] = performance.now();

  if (typeof flatBuf === "number" && flatBuf < 0) {
    throw new Error(`wasm processEdges failed: ${flatBuf}`);
  }

  const polygons = parseFlatPolygons(flatBuf);

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
      removeEdges: 0,
      buildPolygons: 0,
      concatPolygons: m["concatPolygons"]! - m["start"]!,
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
