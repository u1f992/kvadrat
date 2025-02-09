import { parentPort, workerData, isMainThread } from "node:worker_threads";
import { ColorHex } from "./color-hex.js";
import { measureTime } from "./measure-time.js";

const pointEquals = (a: [number, number], b: [number, number]) =>
  a[0] === b[0] && a[1] === b[1];

function removeBidirectionalEdges(edges: [number, number, number, number][]) {
  for (let i = edges.length - 1; i >= 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      if (
        pointEquals(
          [edges[i]![0], edges[i]![1]],
          [edges[j]![2], edges[j]![3]],
        ) &&
        pointEquals([edges[i]![2], edges[i]![3]], [edges[j]![0], edges[j]![1]])
      ) {
        // First remove index i, it's greater than j
        edges.splice(i, 1);
        edges.splice(j, 1);
        i--;
        break;
      }
    }
  }
}

export function toSVGPath(
  hex: ColorHex,
  edges: [number, number, number, number][],
) {
  // Edges that exist in both directions cancel each other (connecting the rectangles)
  measureTime(() => {
    removeBidirectionalEdges(edges);
  });

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
        if (pointEquals([edges[i]![0], edges[i]![1]], [edge[2], edge[3]])) {
          // Found an edge that starts at the last edge's end
          foundEdge = true;
          edge = edges.splice(i, 1)[0]!;
          const p1 = polygon[polygon.length - 2]!; // polygon's second-last point
          const p2 = polygon[polygon.length - 1]!; // polygon's current end
          const p3: [number, number] = [edge[2], edge[3]]; // new point
          // Extend polygon end if it's continuing in the same direction
          if (
            p1[0] === p2[0] && // polygon ends vertical
            p2[0] === p3[0]
          ) {
            // new point is vertical, too
            polygon[polygon.length - 1]![1] = p3[1];
          } else if (
            p1[1] === p2[1] && // polygon ends horizontal
            p2[1] === p3[1]
          ) {
            // new point is horizontal, too
            polygon[polygon.length - 1]![0] = p3[0];
          } else {
            polygon.push(p3); // new direction
          }
          break;
        }
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
