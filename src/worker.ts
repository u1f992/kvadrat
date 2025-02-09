import { parentPort, workerData, isMainThread } from "node:worker_threads";
import { ColorHex } from "./color-hex.js";

const pointEquals = (a: [number, number], b: [number, number]) =>
  a[0] === b[0] && a[1] === b[1];

function removeBidirectionalEdges(edges: [number, number, number, number][]) {
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

function buildPolygons(edges: [number, number, number, number][]) {
  const polygons: [number, number][][] = [];
  while (edges.length > 0) {
    // Pick a random edge and follow its connected edges to form a path (remove used edges)
    // If there are multiple connected edges, pick the first
    // Stop when the starting point of this path is reached
    const polygon: [number, number][] = [];
    polygons.push(polygon);
    let edge = edges.splice(0, 1)[0]!;
    polygon.push([edge[0], edge[1]]);
    polygon.push([edge[2], edge[3]]);
    do {
      let foundEdge = false;
      for (let i = 0; i < edges.length; i++) {
        if (!(edges[i]![0] === edge[2] && edges[i]![1] === edge[3])) {
          continue;
        }
        // Found an edge that starts at the last edge's end
        foundEdge = true;
        edge = edges.splice(i, 1)[0]!;
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
      if (!foundEdge) throw new Error(`no next edge found at ${edge[1]}`);
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
  // Repeat until there are no more unused edges

  return polygons;
}

function concatPolygons(polygons: [number, number][][]) {
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

export function toSVGPath(
  hex: ColorHex,
  edges: [number, number, number, number][],
) {
  removeBidirectionalEdges(edges);
  const polygons = buildPolygons(edges);
  concatPolygons(polygons);

  // Generate SVG path data
  let d = "";
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i]!;
    d += "M" + polygon[0]![0] + "," + polygon[0]![1];
    for (let j = 1; j < polygon.length; j++) {
      if (polygon[j]![0] === polygon[j - 1]![0])
        d += "v" + (polygon[j]![1] - polygon[j - 1]![1]);
      else d += "h" + (polygon[j]![0] - polygon[j - 1]![0]);
    }
    d += "z";
  }

  return `<path stroke="none" fill="${hex}" d="${d}"/>`;
}

if (!isMainThread) {
  const { hex, edges } = workerData;
  parentPort!.postMessage(toSVGPath(hex, edges));
}
