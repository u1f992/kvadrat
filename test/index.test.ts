import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  layeredDecompose,
  renderAsSVGPolygon,
  renderAsSVGRect,
  renderAsCSSBackground,
} from "../src/index.ts";
import type { JimpImageCompat, Layer } from "../src/index.ts";

/* ─── Helpers ────────────────────────────────────────────────── */

function makeImage(
  width: number,
  height: number,
  pixels: number[][],
): JimpImageCompat {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i++) {
    data[i * 4] = pixels[i]![0]!;
    data[i * 4 + 1] = pixels[i]![1]!;
    data[i * 4 + 2] = pixels[i]![2]!;
    data[i * 4 + 3] = pixels[i]![3]!;
  }
  return { width, height, bitmap: { data } };
}

/** Pack RGBA to uint32 matching the Layer.color format. */
function rgba(r: number, g: number, b: number, a: number): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

function totalRects(layers: Layer[]): number {
  return layers.reduce((s, l) => s + l.rects.length, 0);
}

/** Paint layers back-to-front, return flat RGBA uint32 array. */
function renderLayers(
  layers: Layer[],
  width: number,
  height: number,
): number[] {
  const out = new Array(width * height).fill(-1);
  for (const { color, rects } of layers) {
    for (const { x, y, w, h } of rects) {
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) out[(y + dy) * width + x + dx] = color;
    }
  }
  return out;
}

/** Build expected pixel array from color index grid + palette. */
function expectedPixels(
  grid: number[],
  palette: number[][],
  width: number,
): number[] {
  return grid.map((c) => {
    const p = palette[c]!;
    return rgba(p[0]!, p[1]!, p[2]!, p[3]!);
  });
}

/* ─── layeredDecompose ───────────────────────────────────────── */

const O = [0, 0, 0, 255]; // black
const R = [255, 0, 0, 255]; // red
const G = [0, 255, 0, 255]; // green
const B = [0, 0, 255, 255]; // blue

describe("layeredDecompose", () => {
  test("single color", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 1);
    const expected = expectedPixels([0, 0, 0, 0], [O], 2);
    assert.deepEqual(renderLayers(layers, 2, 2), expected);
  });

  test("one pixel different", async () => {
    // O O R
    // O O O
    // O O O
    const img = makeImage(3, 3, [O, O, R, O, O, O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 2);
    const expected = expectedPixels([0, 0, 1, 0, 0, 0, 0, 0, 0], [O, R], 3);
    assert.deepEqual(renderLayers(layers, 3, 3), expected);
  });

  test("L-shape bbox expansion", async () => {
    // O R O
    // O R R
    // O O O
    const img = makeImage(3, 3, [O, R, O, O, R, R, O, O, O]);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 3);
    for (const l of layers) assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("nested ring", async () => {
    // prettier-ignore
    const px = [
      O,O,O,O,O,
      O,R,R,R,O,
      O,R,O,R,O,
      O,R,R,R,O,
      O,O,O,O,O,
    ];
    const img = makeImage(5, 5, px);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 3);
  });

  test("deep nesting (3 levels)", async () => {
    // prettier-ignore
    const px = [
      O,O,O,O,O,O,
      O,R,R,R,R,O,
      O,R,O,O,R,O,
      O,R,O,O,R,O,
      O,R,R,R,R,O,
      O,O,O,O,O,O,
    ];
    const img = makeImage(6, 6, px);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 3);
  });

  test("staircase — each layer is a single rect", async () => {
    // prettier-ignore
    const px = [
      R,R,R,R,R,
      O,R,R,R,R,
      O,O,R,R,R,
      O,O,O,R,R,
      O,O,O,O,R,
    ];
    const img = makeImage(5, 5, px);
    const { layers } = await layeredDecompose(img);
    for (const l of layers) assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("center pixel — hole becomes 2 rects", async () => {
    const img = makeImage(3, 3, [O, O, O, O, R, O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 2);
  });

  test("snake — terminates", async () => {
    // prettier-ignore
    const px = [
      R,O,O,O,
      R,R,R,O,
      O,O,R,R,
      O,O,O,R,
    ];
    const img = makeImage(4, 4, px);
    const { layers } = await layeredDecompose(img);
    assert.ok(totalRects(layers) > 0);
  });

  test("3 colors: concentric rings", async () => {
    // prettier-ignore
    const px = [
      O,O,O,O,O,
      O,R,R,R,O,
      O,R,G,R,O,
      O,R,R,R,O,
      O,O,O,O,O,
    ];
    const img = makeImage(5, 5, px);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 3);
  });

  test("4 colors: concentric squares", async () => {
    // prettier-ignore
    const px = [
      O,O,O,O,O,O,O,
      O,R,R,R,R,R,O,
      O,R,G,G,G,R,O,
      O,R,G,B,G,R,O,
      O,R,G,G,G,R,O,
      O,R,R,R,R,R,O,
      O,O,O,O,O,O,O,
    ];
    const img = makeImage(7, 7, px);
    const { layers } = await layeredDecompose(img);
    assert.equal(totalRects(layers), 4);
  });

  test("rendering correctness", async () => {
    // O R G
    // O O O
    const img = makeImage(3, 2, [O, R, G, O, O, O]);
    const { layers } = await layeredDecompose(img);
    const expected = expectedPixels([0, 1, 2, 0, 0, 0], [O, R, G], 3);
    assert.deepEqual(renderLayers(layers, 3, 2), expected);
  });
});

/* ─── Renderers ──────────────────────────────────────────────── */

describe("renderAsSVGPolygon", () => {
  test("produces path elements with correct fill order", async () => {
    const img = makeImage(3, 3, [O, O, R, O, O, O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    const svg = renderAsSVGPolygon(layers, 3, 3);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.endsWith("</svg>"));
    const paths = [...svg.matchAll(/<path /g)];
    assert.equal(paths.length, 2);
  });

  test("path data uses h/v relative commands", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    const svg = renderAsSVGPolygon(layers, 2, 2);
    assert.ok(svg.includes("M0,0h2v2h-2z"));
  });
});

describe("renderAsSVGRect", () => {
  test("produces rect elements", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    const svg = renderAsSVGRect(layers, 2, 2);
    assert.ok(svg.includes('<rect x="0" y="0" width="2" height="2"'));
  });
});

describe("renderAsCSSBackground", () => {
  test("linear-gradient output", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    const css = renderAsCSSBackground(layers, 2, 2);
    assert.ok(css.includes("linear-gradient("));
    assert.ok(css.includes("width: 2px"));
    assert.ok(css.includes(".image"));
  });

  test("svg material output", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const { layers } = await layeredDecompose(img);
    const css = renderAsCSSBackground(layers, 2, 2, { material: "svg" });
    assert.ok(css.includes("data:image/svg+xml"));
  });

  test("custom selector", async () => {
    const img = makeImage(1, 1, [O]);
    const { layers } = await layeredDecompose(img);
    const css = renderAsCSSBackground(layers, 1, 1, { selector: ".foo" });
    assert.ok(css.startsWith(".foo {"));
  });
});
