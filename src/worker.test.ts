import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  removeBidirectionalEdges,
  buildPolygons,
  concatPolygons,
  generateSVGPathData,
} from "./worker.js";

type Edge = [number, number, number, number];

/** Generate the 4 clockwise edges for a pixel at (x, y). */
function pixelEdges(x: number, y: number): Edge[] {
  return [
    [x, y, x + 1, y],
    [x + 1, y, x + 1, y + 1],
    [x + 1, y + 1, x, y + 1],
    [x, y + 1, x, y],
  ];
}

describe("removeBidirectionalEdges", () => {
  test("single pixel: all 4 edges remain", () => {
    const edges: Edge[] = pixelEdges(0, 0);
    removeBidirectionalEdges(edges);
    assert.equal(edges.length, 4);
  });

  test("2x1 horizontal pixels: shared vertical edge removed", () => {
    // Two adjacent pixels share the edge between x=1 columns
    //  (0,0)-(1,0) and (1,0)-(2,0)
    const edges: Edge[] = [...pixelEdges(0, 0), ...pixelEdges(1, 0)];
    removeBidirectionalEdges(edges);
    // 8 original - 2 shared (bidirectional pair) = 6
    assert.equal(edges.length, 6);
    // The removed pair: [1,0,1,1] and [1,1,1,0]
    const hasInternalEdge = edges.some(
      ([x1, y1, x2, y2]) =>
        (x1 === 1 && y1 === 0 && x2 === 1 && y2 === 1) ||
        (x1 === 1 && y1 === 1 && x2 === 1 && y2 === 0),
    );
    assert.equal(hasInternalEdge, false);
  });

  test("2x2 square: 4 internal edge pairs removed", () => {
    const edges: Edge[] = [
      ...pixelEdges(0, 0),
      ...pixelEdges(1, 0),
      ...pixelEdges(0, 1),
      ...pixelEdges(1, 1),
    ];
    removeBidirectionalEdges(edges);
    // 16 original - 8 (4 shared pairs) = 8 outer edges
    assert.equal(edges.length, 8);
  });
});

describe("buildPolygons", () => {
  test("single pixel: produces one rectangular polygon", () => {
    const edges: Edge[] = pixelEdges(0, 0);
    const polygons = buildPolygons(edges);
    assert.equal(polygons.length, 1);
    // Should form a closed rectangle: first point == last point
    const p = polygons[0]!;
    assert.deepEqual(p[0], p[p.length - 1]);
  });

  test("2x1 horizontal: collinear edges merged", () => {
    const edges: Edge[] = [...pixelEdges(0, 0), ...pixelEdges(1, 0)];
    removeBidirectionalEdges(edges);
    const polygons = buildPolygons(edges);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    // A 2x1 rectangle has 4 corners + closing point = 5 points
    assert.equal(p.length, 5);
  });

  test("2x2 square: 4 corners + closing point", () => {
    const edges: Edge[] = [
      ...pixelEdges(0, 0),
      ...pixelEdges(1, 0),
      ...pixelEdges(0, 1),
      ...pixelEdges(1, 1),
    ];
    removeBidirectionalEdges(edges);
    const polygons = buildPolygons(edges);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    assert.equal(p.length, 5);
  });

  test("L-shape: produces correct polygon", () => {
    // ##
    // #
    const edges: Edge[] = [
      ...pixelEdges(0, 0),
      ...pixelEdges(1, 0),
      ...pixelEdges(0, 1),
    ];
    removeBidirectionalEdges(edges);
    const polygons = buildPolygons(edges);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    // L-shape has 6 corners + closing = 7 points
    assert.equal(p.length, 7);
  });

  test("two separate pixels: produces two polygons", () => {
    // Pixels at (0,0) and (2,0) — not adjacent
    const edges: Edge[] = [...pixelEdges(0, 0), ...pixelEdges(2, 0)];
    const polygons = buildPolygons(edges);
    assert.equal(polygons.length, 2);
  });
});

describe("concatPolygons", () => {
  test("two touching polygons merged into one", () => {
    // Two 1x1 squares sharing point (1,0)
    // Polygon A: (0,0)→(1,0)→(1,1)→(0,1)→(0,0)
    // Polygon B: (1,0)→(2,0)→(2,1)→(1,1)→(1,0)
    const polygons: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [1, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 0],
      ],
    ];
    concatPolygons(polygons);
    assert.equal(polygons.length, 1);
  });

  test("non-touching polygons remain separate", () => {
    const polygons: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [3, 3],
        [4, 3],
        [4, 4],
        [3, 4],
        [3, 3],
      ],
    ];
    concatPolygons(polygons);
    assert.equal(polygons.length, 2);
  });
});

describe("generateSVGPathData", () => {
  test("single 1x1 square", () => {
    const polygons: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ];
    const d = generateSVGPathData(polygons);
    assert.equal(d, "M0,0h1v1h-1v-1z");
  });

  test("2x1 rectangle", () => {
    const polygons: [number, number][][] = [
      [
        [0, 0],
        [2, 0],
        [2, 1],
        [0, 1],
        [0, 0],
      ],
    ];
    const d = generateSVGPathData(polygons);
    assert.equal(d, "M0,0h2v1h-2v-1z");
  });

  test("multiple polygons concatenated", () => {
    const polygons: [number, number][][] = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
      [
        [2, 2],
        [3, 2],
        [3, 3],
        [2, 3],
        [2, 2],
      ],
    ];
    const d = generateSVGPathData(polygons);
    assert.equal(d, "M0,0h1v1h-1v-1zM2,2h1v1h-1v-1z");
  });
});
