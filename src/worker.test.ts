import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toSVGPath } from "./worker.js";
import { ColorHex } from "./color-hex.js";

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

describe("toSVGPath end-to-end", () => {
  const hex = "#ff0000ff" as ColorHex;

  test("single pixel produces unit square path", () => {
    const edges = makeEdges(pixelEdges(0, 0));
    const svg = toSVGPath(hex, edges, 4);
    assert.match(svg, /d="M0,0h1v1h-1v-1z"/);
  });

  test("2x1 horizontal produces 2x1 rectangle path", () => {
    const edges = makeEdges(pixelEdges(0, 0), pixelEdges(1, 0));
    const svg = toSVGPath(hex, edges, 8);
    assert.match(svg, /d="M0,0h2v1h-2v-1z"/);
  });

  test("2x2 square produces 2x2 rectangle path", () => {
    const edges = makeEdges(
      pixelEdges(0, 0),
      pixelEdges(1, 0),
      pixelEdges(0, 1),
      pixelEdges(1, 1),
    );
    const svg = toSVGPath(hex, edges, 16);
    assert.match(svg, /d="M0,0h2v2h-2v-2z"/);
  });

  test("L-shape produces 6-segment path", () => {
    const edges = makeEdges(
      pixelEdges(0, 0),
      pixelEdges(1, 0),
      pixelEdges(0, 1),
    );
    const svg = toSVGPath(hex, edges, 12);
    // L-shape has 7 points = 6 segments + z
    const d = svg.match(/d="([^"]+)"/)?.[1] ?? "";
    const segments = d.match(/[Mhvz]/g) ?? [];
    // M + 6 segments + z = 8 total
    assert.equal(segments.length, 8);
  });

  test("two disjoint pixels produce two separate paths", () => {
    const edges = makeEdges(pixelEdges(0, 0), pixelEdges(3, 3));
    const svg = toSVGPath(hex, edges, 8);
    const d = svg.match(/d="([^"]+)"/)?.[1] ?? "";
    // Two polygons touching at diagonal => 2 separate M commands
    const mCount = (d.match(/M/g) ?? []).length;
    assert.equal(mCount, 2);
  });

  test("zero edges produces empty path", () => {
    const edges = new Int32Array(0);
    const svg = toSVGPath(hex, edges, 0);
    assert.match(svg, /d=""/);
  });
});
