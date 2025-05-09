// The entry file of your WebAssembly module.

/** `[u16, u16]` */
type Point = u16[];
const X = 0;
const Y = 1;

function pointEquals(a: Point, b: Point): bool {
  return a[X] === b[X] && a[Y] === b[Y];
}

/** `[Point, Point]` */
type DLS = Point[];
const START = 0;
const END = 1;

type Polygon = Point[];

function resolveOffsets(segments: DLS[]): void {
  const seen = new Map<string, number>();
  const toRemove = new Set<number>();

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const key = `${seg[START][X]},${seg[START][Y]},${seg[END][X]},${seg[END][Y]}`;
    const reverseKey = `${seg[END][X]},${seg[END][Y]},${seg[START][X]},${seg[START][Y]}`;

    if (seen.has(reverseKey)) {
      toRemove.add(i);
      toRemove.add(seen.get(reverseKey));
      seen.delete(reverseKey);
    } else {
      seen.set(key, i);
    }
  }

  let writeIndex = 0;
  for (let readIndex = 0; readIndex < segments.length; readIndex++) {
    if (!toRemove.has(readIndex)) {
      segments[writeIndex++] = segments[readIndex];
    }
  }
  segments.length = writeIndex;
}

function buildPolygons(segments: DLS[]): Polygon[] {
  const polygons: Polygon[] = [];
  while (segments.length > 0) {
    // Pick a random edge and follow its connected edges to form a path (remove used edges)
    // If there are multiple connected edges, pick the first
    // Stop when the starting point of this path is reached
    const polygon: Polygon = [];
    polygons.push(polygon);
    let seg = segments.splice(0, 1)[0];
    polygon.push(seg[START]);
    polygon.push(seg[END]);
    do {
      let foundEdge = false;
      for (let i = 0; i < segments.length; i++) {
        if (!pointEquals(segments[i][START], seg[END])) {
          continue;
        }
        // Found an edge that starts at the last edge's end
        foundEdge = true;
        seg = segments.splice(i, 1)[0];
        const secondLastPoint = polygon[polygon.length - 2];
        const lastPoint = polygon[polygon.length - 1];
        const newPoint = seg[END];
        // Extend polygon end if it's continuing in the same direction
        if (
          // polygon ends vertical
          secondLastPoint[X] === lastPoint[X] &&
          lastPoint[X] === newPoint[X]
        ) {
          // new point is vertical, too
          polygon[polygon.length - 1][Y] = newPoint[Y];
        } else if (
          // polygon ends horizontal
          secondLastPoint[Y] === lastPoint[Y] &&
          lastPoint[Y] === newPoint[Y]
        ) {
          // new point is horizontal, too
          polygon[polygon.length - 1][X] = newPoint[X];
        } else {
          // new direction
          polygon.push(newPoint);
        }
        break;
      }
      if (!foundEdge) {
        // no next edge found at seg[1]
        return [];
      }
    } while (!pointEquals(polygon[polygon.length - 1], polygon[0]));

    // Move polygon's start and end point into a corner
    if (
      polygon[0][X] === polygon[1][X] &&
      polygon[polygon.length - 2][X] === polygon[polygon.length - 1][X]
    ) {
      // start/end is along a vertical line
      polygon.length--;
      polygon[0][Y] = polygon[polygon.length - 1][Y];
    } else if (
      polygon[0][Y] === polygon[1][Y] &&
      polygon[polygon.length - 2][Y] === polygon[polygon.length - 1][Y]
    ) {
      // start/end is along a horizontal line
      polygon.length--;
      polygon[0][X] = polygon[polygon.length - 1][X];
    }
  }
  // Repeat until there are no more unused edges

  return polygons;
}

function insertAt(array: Point[], index: i32, value: Point): void {
  array.push(array[array.length - 1]);
  for (let i = array.length - 2; i >= index; i--) {
    array[i + 1] = array[i];
  }
  array[index] = value;
}

function concatPolygons(polygons: Polygon[]): void {
  // If two paths touch in at least one point, pick such a point and include one path in the other's sequence of points
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    for (let j = 0; j < polygon.length; j++) {
      const point = polygon[j];
      for (let k = i + 1; k < polygons.length; k++) {
        const polygon2 = polygons[k];
        for (let l = 0; l < polygon2.length - 1; l++) {
          // exclude end point (same as start)
          const point2 = polygon2[l];
          if (pointEquals(point, point2)) {
            // Embed polygon2 into polygon
            if (l > 0) {
              // Touching point is not other polygon's start/end

              // polygon.splice.apply(
              //   polygon,
              //   // @ts-ignore
              //   [j + 1, 0].concat(polygon2.slice(1, l + 1))
              // );
              // ERROR TS2339: Property 'apply' does not exist on type '~lib/function/Function<%28this:~lib/array/Array<assembly/index/Point>%2Ci32%2Ci32?%29=>~lib/array/Array<assembly/index/Point>>'.
              const insert1 = polygon2.slice(1, l + 1);
              for (let m = 0; m < insert1.length; m++) {
                insertAt(polygon, j + 1 + m, insert1[m]);
              }
            }
            // polygon.splice.apply(
            //   polygon,
            //   // @ts-ignore
            //   [j + 1, 0].concat(polygon2.slice(l + 1))
            // );
            const insert2 = polygon2.slice(l + 1);
            for (let m = 0; m < insert2.length; m++) {
              insertAt(polygon, j + 1 + m, insert2[m]);
            }
            polygons.splice(k, 1);
            k--;
            break;
          }
        }
      }
    }
  }
}

export function buildPolygonsFromSegments(segments: DLS[]): Polygon[] {
  resolveOffsets(segments);
  const polygons = buildPolygons(segments);
  concatPolygons(polygons);
  return polygons;
}
