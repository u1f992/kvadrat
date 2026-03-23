import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toSVG, toRectangles } from "./index.js";

type MockImage = {
  width: number;
  height: number;
  bitmap: { data: Uint8Array };
};

function makeImage(
  width: number,
  height: number,
  pixels: number[][],
): MockImage {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i * 4] = pixels[i]![0]!;
    data[i * 4 + 1] = pixels[i]![1]!;
    data[i * 4 + 2] = pixels[i]![2]!;
    data[i * 4 + 3] = pixels[i]![3]!;
  }
  return { width, height, bitmap: { data } };
}

describe("toSVG end-to-end", () => {
  test("single red pixel", async () => {
    const img = makeImage(1, 1, [[255, 0, 0, 255]]);
    const svg = await toSVG(img as any);
    assert.match(svg, /fill="#ff0000ff"/);
    assert.match(svg, /d="M0,0h1v1h-1v-1z"/);
  });

  test("2x1 same color produces merged rectangle", async () => {
    const img = makeImage(2, 1, [
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /d="M0,0h2v1h-2v-1z"/);
  });

  test("2x1 different colors produces two paths", async () => {
    const img = makeImage(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /fill="#ff0000ff"/);
    assert.match(svg, /fill="#00ff00ff"/);
  });

  test("2x2 single color produces square", async () => {
    const img = makeImage(2, 2, [
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /d="M0,0h2v2h-2v-2z"/);
  });

  test("L-shape produces 6-segment path", async () => {
    // ##
    // #
    const img = makeImage(2, 2, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const svg = await toSVG(img as any);
    // L-shape has 7 points = 6 segments + z
    const redPath = svg.match(/fill="#ff0000ff" d="([^"]+)"/)?.[1] ?? "";
    const segments = redPath.match(/[Mhvz]/g) ?? [];
    assert.equal(segments.length, 8); // M + 6 segments + z
  });

  test("transparent pixels handled correctly", async () => {
    const img = makeImage(2, 1, [
      [255, 0, 0, 128],
      [255, 0, 0, 0],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /fill="#ff000080"/);
    assert.match(svg, /fill="#ff000000"/);
  });

  test("3x3 checkerboard: diagonal-touching pixels merged into single path per color", async () => {
    const B = [0, 0, 0, 255];
    const W = [255, 255, 255, 255];
    const img = makeImage(3, 3, [B, W, B, W, B, W, B, W, B]);
    const svg = await toSVG(img as any);
    assert.ok(
      svg.includes(
        'fill="#000000ff" d="M0,0h1v1h1v-1h1v1h-1v1h1v1h-1v-1h-1v1h-1v-1h1v-1h-1v-1z"',
      ),
    );
    assert.ok(
      svg.includes(
        'fill="#ffffffff" d="M1,0h1v1h1v1h-1v1h-1v-1h1v-1h-1v1h-1v-1h1v-1z"',
      ),
    );
  });

  test("Uint8ClampedArray input works", async () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255]);
    const img = { width: 1, height: 1, bitmap: { data } };
    const svg = await toSVG(img as any);
    assert.match(svg, /fill="#ff0000ff"/);
  });

  test("number[] input works", async () => {
    const data = [255, 0, 0, 255];
    const img = { width: 1, height: 1, bitmap: { data } };
    const svg = await toSVG(img as any);
    assert.match(svg, /fill="#ff0000ff"/);
  });
});

describe("toRectangles end-to-end", () => {
  test("single pixel produces one 1x1 rectangle", async () => {
    const img = makeImage(1, 1, [[255, 0, 0, 255]]);
    const results = await toRectangles(img as any);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.color, "#ff0000ff");
    assert.deepEqual(results[0]!.rects, [{ x: 0, y: 0, w: 1, h: 1 }]);
  });

  test("2x1 same color produces one 2x1 rectangle", async () => {
    const img = makeImage(2, 1, [
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const results = await toRectangles(img as any);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]!.rects, [{ x: 0, y: 0, w: 2, h: 1 }]);
  });

  test("2x2 single color produces one 2x2 rectangle", async () => {
    const img = makeImage(2, 2, [
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    const results = await toRectangles(img as any);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]!.rects, [{ x: 0, y: 0, w: 2, h: 2 }]);
  });

  test("L-shape produces two rectangles", async () => {
    // ##
    // #
    const img = makeImage(2, 2, [
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [255, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const results = await toRectangles(img as any);
    const red = results.find((r) => r.color === "#ff0000ff")!;
    assert.equal(red.rects.length, 2);
    // Top row: 2x1, then left column remainder: 1x1
    assert.deepEqual(red.rects[0], { x: 0, y: 0, w: 2, h: 1 });
    assert.deepEqual(red.rects[1], { x: 0, y: 1, w: 1, h: 1 });
  });

  test("3x3 checkerboard produces individual 1x1 rectangles", async () => {
    const B = [0, 0, 0, 255];
    const W = [255, 255, 255, 255];
    const img = makeImage(3, 3, [B, W, B, W, B, W, B, W, B]);
    const results = await toRectangles(img as any);
    const black = results.find((r) => r.color === "#000000ff")!;
    const white = results.find((r) => r.color === "#ffffffff")!;
    assert.equal(black.rects.length, 5);
    assert.equal(white.rects.length, 4);
    // Each rect is 1x1
    for (const r of [...black.rects, ...white.rects]) {
      assert.equal(r.w, 1);
      assert.equal(r.h, 1);
    }
  });

  test("2x1 different colors produces two results", async () => {
    const img = makeImage(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    const results = await toRectangles(img as any);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0]!.rects, [{ x: 0, y: 0, w: 1, h: 1 }]);
    assert.deepEqual(results[1]!.rects, [{ x: 1, y: 0, w: 1, h: 1 }]);
  });

  test("vertical 1x2 same color produces one 1x2 rectangle", async () => {
    const img = makeImage(1, 2, [
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const results = await toRectangles(img as any);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0]!.rects, [{ x: 0, y: 0, w: 1, h: 2 }]);
  });
});
