import { parentPort, workerData, isMainThread } from "node:worker_threads";
import { performance } from "node:perf_hooks";
import { ColorHex } from "./color-hex.js";

const pointEquals = (a: [number, number], b: [number, number]) =>
  a[0] === b[0] && a[1] === b[1];

export function removeBidirectionalEdges(
  edges: [number, number, number, number][],
) {
  const seen = new Map<string, number>();
  const toRemove = new Set<number>();

  for (let i = 0; i < edges.length; i++) {
    const [x1, y1, x2, y2] = edges[i]!;
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
  for (let readIndex = 0; readIndex < edges.length; readIndex++) {
    if (!toRemove.has(readIndex)) {
      edges[writeIndex++] = edges[readIndex]!;
    }
  }
  edges.length = writeIndex;
}

export function buildPolygons(edges: [number, number, number, number][]) {
  // Build adjacency index: start-point -> list of edge indices
  const adj = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const key = `${edges[i]![0]},${edges[i]![1]}`;
    let list = adj.get(key);
    if (!list) {
      list = [];
      adj.set(key, list);
    }
    list.push(i);
  }

  const used = new Uint8Array(edges.length);
  let remaining = edges.length;
  // Scan pointer for finding unused starting edges
  let startScan = 0;

  const polygons: [number, number][][] = [];

  while (remaining > 0) {
    // Find an unused edge to start a new polygon
    while (used[startScan]) startScan++;

    const polygon: [number, number][] = [];
    polygons.push(polygon);

    let edgeIdx = startScan;
    used[edgeIdx] = 1;
    remaining--;
    let edge = edges[edgeIdx]!;
    polygon.push([edge[0], edge[1]]);
    polygon.push([edge[2], edge[3]]);

    do {
      // Look up edges starting at the current edge's end point
      const key = `${edge[2]},${edge[3]}`;
      const candidates = adj.get(key);
      if (!candidates)
        throw new Error(`no next edge found at ${edge[2]},${edge[3]}`);

      let foundEdge = false;
      for (let ci = 0; ci < candidates.length; ci++) {
        const idx = candidates[ci]!;
        if (used[idx]) continue;

        foundEdge = true;
        used[idx] = 1;
        remaining--;
        edge = edges[idx]!;

        const secondLastPoint = polygon[polygon.length - 2]!;
        const lastPoint = polygon[polygon.length - 1]!;
        const newPoint: [number, number] = [edge[2], edge[3]];
        // Extend polygon end if it's continuing in the same direction
        if (
          secondLastPoint[0] === lastPoint[0] && // polygon ends vertical
          lastPoint[0] === newPoint[0]
        ) {
          // new point is vertical, too
          polygon[polygon.length - 1]![1] = newPoint[1];
        } else if (
          secondLastPoint[1] === lastPoint[1] && // polygon ends horizontal
          lastPoint[1] === newPoint[1]
        ) {
          // new point is horizontal, too
          polygon[polygon.length - 1]![0] = newPoint[0];
        } else {
          polygon.push(newPoint); // new direction
        }
        break;
      }
      if (!foundEdge)
        throw new Error(`no next edge found at ${edge[2]},${edge[3]}`);
    } while (!pointEquals(polygon[polygon.length - 1]!, polygon[0]!));

    // Move polygon's start and end point into a corner
    if (
      polygon[0]![0] === polygon[1]![0] &&
      polygon[polygon.length - 2]![0] === polygon[polygon.length - 1]![0]
    ) {
      // start/end is along a vertical line
      polygon.length--;
      polygon[0]![1] = polygon[polygon.length - 1]![1];
    } else if (
      polygon[0]![1] === polygon[1]![1] &&
      polygon[polygon.length - 2]![1] === polygon[polygon.length - 1]![1]
    ) {
      // start/end is along a horizontal line
      polygon.length--;
      polygon[0]![0] = polygon[polygon.length - 1]![0];
    }
  }

  return polygons;
}

export function concatPolygons(polygons: [number, number][][]) {
  // If two paths touch in at least one point, pick such a point and include one path in the other's sequence of points
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i]!;
    for (let j = 0; j < polygon.length; j++) {
      const point = polygon[j]!;
      for (let k = i + 1; k < polygons.length; k++) {
        const polygon2 = polygons[k]!;
        for (let l = 0; l < polygon2.length - 1; l++) {
          // exclude end point (same as start)
          const point2 = polygon2[l]!;
          if (pointEquals(point, point2)) {
            // Embed polygon2 into polygon
            if (l > 0) {
              // Touching point is not other polygon's start/end
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
  // Generate SVG path data
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
  edges: [number, number, number, number][],
): { svg: string; perf: WorkerPerf } {
  const edgeCount = edges.length;
  const t0 = performance.now();

  removeBidirectionalEdges(edges);
  const t1 = performance.now();

  const polygons = buildPolygons(edges);
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

export function toSVGPath(
  hex: ColorHex,
  edges: [number, number, number, number][],
) {
  return toSVGPathWithPerf(hex, edges).svg;
}

if (!isMainThread) {
  const { hex, edges, returnPerf } = workerData;
  if (returnPerf) {
    const result = toSVGPathWithPerf(hex, edges);
    parentPort!.postMessage(result);
  } else {
    parentPort!.postMessage(toSVGPath(hex, edges));
  }
}
