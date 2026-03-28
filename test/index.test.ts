import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  decomposeLayered,
  decomposeFlat,
  decomposeOutline,
  renderAsSVGPath,
  renderAsSVGPolygon,
  renderAsSVGRect,
  renderAsCSSBackground,
} from "../src/index.ts";
import type { JimpImageCompat, RectLayer, PolygonLayer } from "../src/index.ts";

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

function totalRects(layers: RectLayer[]): number {
  return layers.reduce((s, l) => s + l.rects.length, 0);
}

/** Paint RectLayers back-to-front, return flat RGBA uint32 array. */
function renderRectLayers(
  layers: RectLayer[],
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

/** Paint PolygonLayers using scanline fill, return flat RGBA uint32 array. */
function renderPolygonLayers(
  layers: PolygonLayer[],
  width: number,
  height: number,
): number[] {
  const out = new Array(width * height).fill(0);
  for (const { color, polygons } of layers) {
    for (const polygon of polygons) {
      // Fill polygon using point-in-polygon for axis-aligned rectilinear polygons
      // Find bounding box
      let minX = width,
        maxX = 0,
        minY = height,
        maxY = 0;
      for (const [x, y] of polygon) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      // For each pixel center, test if inside polygon using ray casting
      for (let py = minY; py < maxY; py++) {
        for (let px = minX; px < maxX; px++) {
          // Test point (px+0.5, py+0.5)
          const tx = px + 0.5;
          const ty = py + 0.5;
          let inside = false;
          for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i]!;
            const [xj, yj] = polygon[j]!;
            if (
              yi > ty !== yj > ty &&
              tx < ((xj - xi) * (ty - yi)) / (yj - yi) + xi
            ) {
              inside = !inside;
            }
          }
          if (inside) {
            out[py * width + px] = color;
          }
        }
      }
    }
  }
  return out;
}

/** Build expected pixel array from color index grid + palette. */
function expectedPixels(grid: number[], palette: number[][]): number[] {
  return grid.map((c) => {
    const p = palette[c]!;
    return rgba(p[0]!, p[1]!, p[2]!, p[3]!);
  });
}

/* ─── Colors ─────────────────────────────────────────────────── */

const O = [0, 0, 0, 255]; // black
const R = [255, 0, 0, 255]; // red
const G = [0, 255, 0, 255]; // green
const B = [0, 0, 255, 255]; // blue

/* ─── decomposeLayered ───────────────────────────────────────── */

describe("decomposeLayered", () => {
  test("single color", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    assert.equal(totalRects(layers), 1);
    const expected = expectedPixels([0, 0, 0, 0], [O]);
    assert.deepEqual(renderRectLayers(layers, 2, 2), expected);
  });

  test("one pixel different", async () => {
    const img = makeImage(3, 3, [O, O, R, O, O, O, O, O, O]);
    const layers = await decomposeLayered(img);
    assert.equal(totalRects(layers), 2);
    const expected = expectedPixels([0, 0, 1, 0, 0, 0, 0, 0, 0], [O, R]);
    assert.deepEqual(renderRectLayers(layers, 3, 3), expected);
  });

  test("L-shape bbox expansion", async () => {
    const img = makeImage(3, 3, [O, R, O, O, R, R, O, O, O]);
    const layers = await decomposeLayered(img);
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
    const layers = await decomposeLayered(img);
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
    const layers = await decomposeLayered(img);
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
    const layers = await decomposeLayered(img);
    for (const l of layers) assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("center pixel — hole becomes 2 rects", async () => {
    const img = makeImage(3, 3, [O, O, O, O, R, O, O, O, O]);
    const layers = await decomposeLayered(img);
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
    const layers = await decomposeLayered(img);
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
    const layers = await decomposeLayered(img);
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
    const layers = await decomposeLayered(img);
    assert.equal(totalRects(layers), 4);
  });

  test("rendering correctness", async () => {
    const img = makeImage(3, 2, [O, R, G, O, O, O]);
    const layers = await decomposeLayered(img);
    const expected = expectedPixels([0, 1, 2, 0, 0, 0], [O, R, G]);
    assert.deepEqual(renderRectLayers(layers, 3, 2), expected);
  });

  test("returns RectLayer with both rects and polygons", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    assert.equal(layers.length, 1);
    assert.ok(layers[0]!.rects.length > 0);
    assert.ok(layers[0]!.polygons.length > 0);
    assert.equal(layers[0]!.rects.length, layers[0]!.polygons.length);
  });
});

/* ─── decomposeFlat ──────────────────────────────────────────── */

describe("decomposeFlat", () => {
  test("single color → 1 layer, 1 rect", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeFlat(img);
    assert.equal(layers.length, 1);
    assert.equal(totalRects(layers), 1);
  });

  test("two colors → 2 layers, no overlap", async () => {
    const img = makeImage(2, 2, [O, R, R, O]);
    const layers = await decomposeFlat(img);
    assert.equal(layers.length, 2);
    // Verify non-overlapping: total rect area == total pixels
    let totalArea = 0;
    for (const l of layers) for (const { w, h } of l.rects) totalArea += w * h;
    assert.equal(totalArea, 4);
  });

  test("rendering correctness — each pixel covered exactly once", async () => {
    const img = makeImage(3, 2, [O, R, G, O, O, O]);
    const layers = await decomposeFlat(img);
    // Every pixel should be assigned to exactly one layer
    const pixelCount = new Map<number, number>();
    for (const { rects } of layers) {
      for (const { x, y, w, h } of rects) {
        for (let dy = 0; dy < h; dy++)
          for (let dx = 0; dx < w; dx++) {
            const idx = (y + dy) * 3 + (x + dx);
            pixelCount.set(idx, (pixelCount.get(idx) ?? 0) + 1);
          }
      }
    }
    assert.equal(pixelCount.size, 6);
    for (const [, count] of pixelCount) {
      assert.equal(count, 1, "each pixel covered exactly once");
    }
  });

  test("returns RectLayer with both rects and polygons", async () => {
    const img = makeImage(2, 2, [O, R, R, O]);
    const layers = await decomposeFlat(img);
    for (const l of layers) {
      assert.ok(l.rects.length > 0);
      assert.ok(l.polygons.length > 0);
      assert.equal(l.rects.length, l.polygons.length);
    }
  });

  test("greedy merges adjacent same-color pixels into rects", async () => {
    // All same color → should be 1 rect
    const img = makeImage(4, 4, Array(16).fill(O));
    const layers = await decomposeFlat(img);
    assert.equal(layers.length, 1);
    assert.equal(layers[0]!.rects.length, 1);
    assert.deepEqual(layers[0]!.rects[0], { x: 0, y: 0, w: 4, h: 4 });
  });
});

/* ─── decomposeOutline ───────────────────────────────────────── */

describe("decomposeOutline", () => {
  test("single color → 1 layer with 1 polygon", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeOutline(img);
    assert.equal(layers.length, 1);
    assert.equal(layers[0]!.polygons.length, 1);
  });

  test("single pixel → closed polygon with 5 vertices", async () => {
    const img = makeImage(1, 1, [O]);
    const layers = await decomposeOutline(img);
    assert.equal(layers.length, 1);
    assert.equal(layers[0]!.polygons.length, 1);
    // Closed loop: (0,0)→(1,0)→(1,1)→(0,1)→(0,0)
    assert.equal(layers[0]!.polygons[0]!.length, 5);
  });

  test("2×2 single color → closed rectangle polygon with 5 vertices", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeOutline(img);
    assert.equal(layers[0]!.polygons[0]!.length, 5);
  });

  test("two colors → 2 layers", async () => {
    const img = makeImage(2, 1, [O, R]);
    const layers = await decomposeOutline(img);
    assert.equal(layers.length, 2);
  });

  test("polygon covers correct area — rendering correctness", async () => {
    const img = makeImage(3, 2, [O, R, G, O, O, O]);
    const layers = await decomposeOutline(img);
    const expected = expectedPixels([0, 1, 2, 0, 0, 0], [O, R, G]);
    assert.deepEqual(renderPolygonLayers(layers, 3, 2), expected);
  });

  test("L-shape merges into single polygon", async () => {
    // R R
    // R .
    const img = makeImage(2, 2, [R, R, R, O]);
    const layers = await decomposeOutline(img);
    const rLayer = layers.find((l) => l.color === rgba(255, 0, 0, 255));
    assert.ok(rLayer);
    // After concat_polygons, should be merged into 1 polygon (L-shape)
    assert.equal(rLayer.polygons.length, 1);
    // L-shape closed loop has 7 vertices (6 corners + return to start)
    assert.equal(rLayer.polygons[0]!.length, 7);
  });

  test("does NOT have rects field", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeOutline(img);
    // PolygonLayer should not have rects
    assert.equal("rects" in layers[0]!, false);
  });
});

/* ─── renderAsSVGPath (RectLayer[] → compact path) ───────────── */

describe("renderAsSVGPath", () => {
  test("produces path elements with correct fill order", async () => {
    const img = makeImage(3, 3, [O, O, R, O, O, O, O, O, O]);
    const layers = await decomposeLayered(img);
    const svg = renderAsSVGPath(layers, 3, 3);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.endsWith("</svg>"));
    const paths = [...svg.matchAll(/<path /g)];
    assert.equal(paths.length, 2);
  });

  test("path data uses h/v relative commands", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    const svg = renderAsSVGPath(layers, 2, 2);
    assert.ok(svg.includes("M0,0h2v2h-2z"));
  });
});

/* ─── renderAsSVGPolygon (PolygonLayer[] → polygon path) ─────── */

describe("renderAsSVGPolygon", () => {
  test("produces valid SVG with path elements", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeOutline(img);
    const svg = renderAsSVGPolygon(layers, 2, 2);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.endsWith("</svg>"));
    assert.ok(svg.includes("<path"));
  });

  test("accepts RectLayer[] (subtype compatibility)", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    // RectLayer[] should be accepted where PolygonLayer[] is expected
    const svg = renderAsSVGPolygon(layers, 2, 2);
    assert.ok(svg.startsWith("<svg"));
    assert.ok(svg.endsWith("</svg>"));
  });

  test("path data uses h/v relative commands for outline", async () => {
    const img = makeImage(1, 1, [O]);
    const layers = await decomposeOutline(img);
    const svg = renderAsSVGPolygon(layers, 1, 1);
    // Single pixel: should trace M0,0 h1 v1 h-1 z (or similar)
    assert.ok(svg.includes("<path"));
    // Outline polygon includes return-to-start vertex, so path has v-1 before z
    assert.match(svg, /d="M0,0h1v1h-1v-1z"/);
  });
});

/* ─── renderAsSVGRect ────────────────────────────────────────── */

describe("renderAsSVGRect", () => {
  test("produces rect elements", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    const svg = renderAsSVGRect(layers, 2, 2);
    assert.ok(svg.includes('<rect x="0" y="0" width="2" height="2"'));
  });
});

/* ─── renderAsCSSBackground ──────────────────────────────────── */

describe("renderAsCSSBackground", () => {
  test("linear-gradient output", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    const css = renderAsCSSBackground(layers, 2, 2);
    assert.ok(css.includes("linear-gradient("));
    assert.ok(css.includes("width: 2px"));
    assert.ok(css.includes(".image"));
  });

  test("svg material output", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeLayered(img);
    const css = renderAsCSSBackground(layers, 2, 2, { material: "svg" });
    assert.ok(css.includes("data:image/svg+xml"));
  });

  test("custom selector", async () => {
    const img = makeImage(1, 1, [O]);
    const layers = await decomposeLayered(img);
    const css = renderAsCSSBackground(layers, 1, 1, { selector: ".foo" });
    assert.ok(css.startsWith(".foo {"));
  });

  test("works with decomposeFlat results", async () => {
    const img = makeImage(2, 2, [O, O, O, O]);
    const layers = await decomposeFlat(img);
    const css = renderAsCSSBackground(layers, 2, 2);
    assert.ok(css.includes("linear-gradient("));
  });
});
