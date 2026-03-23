import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { toSVG } from "./index.js";

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
