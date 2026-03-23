import { parentPort, workerData, isMainThread } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { ColorHex } from "./color-hex.js";

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
  const seen = new Map<string, number>();
  const toRemove = new Set<number>();

  for (let i = 0; i < edgeCount; i++) {
    const off = i * 4;
    const x1 = edges[off]!;
    const y1 = edges[off + 1]!;
    const x2 = edges[off + 2]!;
    const y2 = edges[off + 3]!;
    const key = `${x1},${y1},${x2},${y2}`;
    const reverseKey = `${x2},${y2},${x1},${y1}`;

    if (seen.has(reverseKey)) {
      toRemove.add(i);
      toRemove.add(seen.get(reverseKey)!);
      seen.delete(reverseKey);
    } else {
      seen.set(key, i);
    }
  }

  let writeIndex = 0;
  for (let readIndex = 0; readIndex < edgeCount; readIndex++) {
    if (!toRemove.has(readIndex)) {
      if (writeIndex !== readIndex) {
        const rOff = readIndex * 4;
        const wOff = writeIndex * 4;
        edges[wOff] = edges[rOff]!;
        edges[wOff + 1] = edges[rOff + 1]!;
        edges[wOff + 2] = edges[rOff + 2]!;
        edges[wOff + 3] = edges[rOff + 3]!;
      }
      writeIndex++;
    }
  }
  return writeIndex;
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

export function toSVGPathWithPerf(
  hex: ColorHex,
  edges: Int32Array,
  edgeCount: number,
): { svg: string; perf: WorkerPerf } {
  const t0 = performance.now();

  edgeCount = removeBidirectionalEdges(edges, edgeCount);
  const t1 = performance.now();

  const polygons = buildPolygons(edges, edgeCount);
  const t2 = performance.now();

  concatPolygons(polygons);
  const t3 = performance.now();

  const d = generateSVGPathData(polygons);
  const t4 = performance.now();

  return {
    svg: `<path stroke="none" fill="${hex}" d="${d}"/>`,
    perf: {
      hex,
      edges: edgeCount,
      polygons: polygons.length,
      removeEdges: t1 - t0,
      buildPolygons: t2 - t1,
      concatPolygons: t3 - t2,
      generateSVG: t4 - t3,
      total: t4 - t0,
    },
  };
}

export function toSVGPath(hex: ColorHex, edges: Int32Array, edgeCount: number) {
  return toSVGPathWithPerf(hex, edges, edgeCount).svg;
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
        const result = toSVGPathWithPerf(msg.hex, msg.edges, msg.edgeCount);
        parentPort!.postMessage(result);
      } else {
        parentPort!.postMessage(toSVGPath(msg.hex, msg.edges, msg.edgeCount));
      }
    },
  );
}
