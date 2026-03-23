import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  removeBidirectionalEdges,
  buildPolygons,
  concatPolygons,
  generateSVGPathData,
} from "./worker.js";

/** Generate a flat Int32Array of 4 clockwise edges for a pixel at (x, y). */
function pixelEdges(x: number, y: number): number[] {
  return [
    x,
    y,
    x + 1,
    y,
    x + 1,
    y,
    x + 1,
    y + 1,
    x + 1,
    y + 1,
    x,
    y + 1,
    x,
    y + 1,
    x,
    y,
  ];
}

/** Create an Int32Array from multiple pixel edge arrays. */
function makeEdges(...pixels: number[][]): Int32Array {
  const flat: number[] = [];
  for (const p of pixels) flat.push(...p);
  return new Int32Array(flat);
}

describe("removeBidirectionalEdges", () => {
  test("single pixel: all 4 edges remain", () => {
    const edges = makeEdges(pixelEdges(0, 0));
    const count = removeBidirectionalEdges(edges, 4);
    assert.equal(count, 4);
  });

  test("2x1 horizontal pixels: shared vertical edge removed", () => {
    const edges = makeEdges(pixelEdges(0, 0), pixelEdges(1, 0));
    const count = removeBidirectionalEdges(edges, 8);
    assert.equal(count, 6);
  });

  test("2x2 square: 4 internal edge pairs removed", () => {
    const edges = makeEdges(
      pixelEdges(0, 0),
      pixelEdges(1, 0),
      pixelEdges(0, 1),
      pixelEdges(1, 1),
    );
    const count = removeBidirectionalEdges(edges, 16);
    assert.equal(count, 8);
  });
});

describe("buildPolygons", () => {
  test("single pixel: produces one rectangular polygon", () => {
    const edges = makeEdges(pixelEdges(0, 0));
    const polygons = buildPolygons(edges, 4);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    assert.deepEqual(p[0], p[p.length - 1]);
  });

  test("2x1 horizontal: collinear edges merged", () => {
    const edges = makeEdges(pixelEdges(0, 0), pixelEdges(1, 0));
    const count = removeBidirectionalEdges(edges, 8);
    const polygons = buildPolygons(edges, count);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    assert.equal(p.length, 5);
  });

  test("2x2 square: 4 corners + closing point", () => {
    const edges = makeEdges(
      pixelEdges(0, 0),
      pixelEdges(1, 0),
      pixelEdges(0, 1),
      pixelEdges(1, 1),
    );
    const count = removeBidirectionalEdges(edges, 16);
    const polygons = buildPolygons(edges, count);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    assert.equal(p.length, 5);
  });

  test("L-shape: produces correct polygon", () => {
    const edges = makeEdges(
      pixelEdges(0, 0),
      pixelEdges(1, 0),
      pixelEdges(0, 1),
    );
    const count = removeBidirectionalEdges(edges, 12);
    const polygons = buildPolygons(edges, count);
    assert.equal(polygons.length, 1);
    const p = polygons[0]!;
    assert.equal(p.length, 7);
  });

  test("two separate pixels: produces two polygons", () => {
    const edges = makeEdges(pixelEdges(0, 0), pixelEdges(2, 0));
    const polygons = buildPolygons(edges, 8);
    assert.equal(polygons.length, 2);
  });
});

describe("concatPolygons", () => {
  test("two touching polygons merged into one", () => {
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
