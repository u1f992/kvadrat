import { parentPort, workerData, isMainThread } from "node:worker_threads";
import { ColorHex } from "./color-hex.js";

import { buildPolygonsFromSegments } from "./assembly/module.js";

type u16 = number;
/** `[u16, u16]` */
type Point = u16[];
/** `[Point, Point]` */
type DLS = Point[];
type Polygon = Point[];

const generateSVGPathData = (polygons: Polygon[]) =>
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
              ? "v" + (point[1]! - polygon[j]![1]!)
              : "h" + (point[0]! - polygon[j]![0]!),
          )
          .join("") +
        "z",
    )
    .join("");

export function toSVGPath(hex: ColorHex, segments: DLS[]) {
  const polygons = buildPolygonsFromSegments(segments);
  const d = generateSVGPathData(polygons);
  return `<path stroke="none" fill="${hex}" d="${d}"/>`;
}

if (!isMainThread) {
  const { hex, segments } = workerData;
  parentPort!.postMessage(toSVGPath(hex, segments));
}
