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

  test("2x1 same color", async () => {
    const img = makeImage(2, 1, [
      [0, 0, 0, 255],
      [0, 0, 0, 255],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /d="M0,0h2v1h-2v-1z"/);
  });

  test("2x1 different colors", async () => {
    const img = makeImage(2, 1, [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /fill="#ff0000ff"/);
    assert.match(svg, /fill="#00ff00ff"/);
  });

  test("2x2 single color", async () => {
    const img = makeImage(2, 2, [
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
      [0, 0, 255, 255],
    ]);
    const svg = await toSVG(img as any);
    assert.match(svg, /d="M0,0h2v2h-2v-2z"/);
  });
});
