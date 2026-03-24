import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Implementation ─────────────────────────────────────────────

/**
 * Layered rectangle decomposition using recursive background fill.
 *
 * @param {number[]} pixels - flat color indices, row-major
 * @param {number} width
 * @returns {{ color: number, rects: {x:number,y:number,w:number,h:number}[] }[]}
 *   Layers ordered bottom-to-top (paint in order to reproduce the image).
 */
export function layeredDecompose(pixels, width) {
  const height = pixels.length / width;
  const region = new Set();
  for (let i = 0; i < pixels.length; i++) region.add(i);
  return solve(pixels, width, height, region);
}

function solve(pixels, width, height, initialRegion) {
  const layers = [];
  // Explicit stack to avoid call-stack overflow on deep nesting
  const worklist = [initialRegion];

  while (worklist.length > 0) {
    const region = worklist.pop();
    if (region.size === 0) continue;

    // Count colors
    const freq = new Map();
    for (const i of region) {
      const c = pixels[i];
      freq.set(c, (freq.get(c) || 0) + 1);
    }

    // Single color → leaf
    if (freq.size === 1) {
      const color = freq.keys().next().value;
      layers.push({ color, rects: decomposeRegion(region, width) });
      continue;
    }

    // Background = most frequent color
    let bg = -1,
      bgN = 0;
    for (const [c, n] of freq) {
      if (n > bgN) {
        bg = c;
        bgN = n;
      }
    }

    // Background layer covers entire region
    layers.push({ color: bg, rects: decomposeRegion(region, width) });

    // Remaining (non-bg) pixels → 4-connected components
    const remaining = new Set();
    for (const i of region) {
      if (pixels[i] !== bg) remaining.add(i);
    }
    const comps = findComponents(remaining, width, height);

    // Push in reverse so first component is processed first (LIFO)
    const subs = comps.map((comp) =>
      chooseRegion(comp, region, bg, pixels, width, height),
    );
    for (let i = subs.length - 1; i >= 0; i--) {
      worklist.push(subs[i]);
    }
  }

  return layers;
}

// ─── Connected components (4-connectivity) ──────────────────────

function findComponents(pixelSet, width, height) {
  const visited = new Set();
  const out = [];

  for (const idx of pixelSet) {
    if (visited.has(idx)) continue;
    const comp = new Set();
    const stack = [idx];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (visited.has(cur) || !pixelSet.has(cur)) continue;
      visited.add(cur);
      comp.add(cur);
      const x = cur % width;
      const y = (cur - x) / width;
      if (x > 0) stack.push(cur - 1);
      if (x < width - 1) stack.push(cur + 1);
      if (y > 0) stack.push(cur - width);
      if (y < height - 1) stack.push(cur + width);
    }
    out.push(comp);
  }
  return out;
}

// ─── Region expansion ───────────────────────────────────────────

function getBbox(region, width) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (const i of region) {
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * Try to expand component to its bounding box (absorbing bg pixels).
 * Falls back to outerFill if bbox contains non-bg or out-of-parent pixels.
 */
function chooseRegion(comp, parentRegion, bg, pixels, width, height) {
  const { x0, y0, x1, y1 } = getBbox(comp, width);
  const bboxArea = (x1 - x0 + 1) * (y1 - y0 + 1);

  // Guard: must be strictly smaller than parent to guarantee termination
  if (bboxArea < parentRegion.size) {
    let ok = true;
    for (let y = y0; y <= y1 && ok; y++) {
      for (let x = x0; x <= x1 && ok; x++) {
        const idx = y * width + x;
        if (!comp.has(idx)) {
          if (!parentRegion.has(idx) || pixels[idx] !== bg) ok = false;
        }
      }
    }
    if (ok) {
      const expanded = new Set();
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) expanded.add(y * width + x);
      return expanded;
    }
  }

  const filled = outerFill(comp, width, height);
  // Guard: outerFill with large holes can recreate the parent → infinite loop
  if (filled.size < parentRegion.size) return filled;
  return new Set(comp);
}

/**
 * Fill enclosed holes in a component by flood-filling exterior from a
 * padded bounding box.
 */
function outerFill(comp, width, _height) {
  if (comp.size <= 1) return new Set(comp);

  const { x0, y0, x1, y1 } = getBbox(comp, width);
  const pw = x1 - x0 + 3;
  const ph = y1 - y0 + 3;

  const wall = new Uint8Array(pw * ph);
  for (const idx of comp) {
    const px = (idx % width) - x0 + 1;
    const py = ((idx - (idx % width)) / width) - y0 + 1;
    wall[py * pw + px] = 1;
  }

  // Flood fill exterior from padded corner (0,0)
  const ext = new Uint8Array(pw * ph);
  const stack = [0];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (ext[cur] || wall[cur]) continue;
    ext[cur] = 1;
    const x = cur % pw;
    const y = (cur - x) / pw;
    if (x > 0) stack.push(cur - 1);
    if (x < pw - 1) stack.push(cur + 1);
    if (y > 0) stack.push(cur - pw);
    if (y < ph - 1) stack.push(cur + pw);
  }

  // comp + interior holes
  const result = new Set(comp);
  for (let py = 1; py < ph - 1; py++) {
    for (let px = 1; px < pw - 1; px++) {
      if (!ext[py * pw + px] && !wall[py * pw + px]) {
        result.add((py - 1 + y0) * width + (px - 1 + x0));
      }
    }
  }
  return result;
}

// ─── Rectangle decomposition (greedy row-run + vertical ext) ────

function decomposeRegion(region, width) {
  const active = new Set(region);
  const { x0, y0, x1, y1 } = getBbox(region, width);
  const rects = [];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!active.has(y * width + x)) continue;

      let w = 1;
      while (x + w <= x1 && active.has(y * width + x + w)) w++;

      let h = 1;
      extend: while (y + h <= y1) {
        for (let dx = 0; dx < w; dx++) {
          if (!active.has((y + h) * width + x + dx)) break extend;
        }
        h++;
      }

      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++)
          active.delete((y + dy) * width + x + dx);

      rects.push({ x, y, w, h });
    }
  }
  return rects;
}

// ─── SVG rendering ──────────────────────────────────────────────

/**
 * Render layers as SVG with one <path> per layer, back-to-front.
 *
 * @param {{ color: number, rects: {x:number,y:number,w:number,h:number}[] }[]} layers
 * @param {number} width
 * @param {number} height
 * @param {(color: number) => string} colorToCSS  e.g. c => "#ff0000"
 */
export function renderAsSVGPolygon(layers, width, height, colorToCSS) {
  let svg =
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}">`;

  for (const { color, rects } of layers) {
    if (rects.length === 0) continue;
    const fill = colorToCSS(color);
    let d = "";
    for (const { x, y, w, h } of rects) {
      d += `M${x},${y}h${w}v${h}h${-w}z`;
    }
    svg += `<path fill="${fill}" d="${d}"/>`;
  }

  svg += "</svg>";
  return svg;
}

// ─── Test helpers ───────────────────────────────────────────────

function totalRects(layers) {
  return layers.reduce((s, l) => s + l.rects.length, 0);
}

function renderLayers(layers, width, height) {
  const out = new Array(width * height).fill(-1);
  for (const { color, rects } of layers) {
    for (const { x, y, w, h } of rects) {
      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++) out[(y + dy) * width + x + dx] = color;
    }
  }
  return out;
}

// ─── Tests ──────────────────────────────────────────────────────

describe("layeredDecompose", () => {
  test("single color", () => {
    const px = [0, 0, 0, 0];
    const layers = layeredDecompose(px, 2);
    assert.deepEqual(renderLayers(layers, 2, 2), px);
    assert.equal(totalRects(layers), 1);
  });

  test("one pixel different", () => {
    // 0 0 1
    // 0 0 0
    // 0 0 0
    const px = [0, 0, 1, 0, 0, 0, 0, 0, 0];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 3), px);
    assert.equal(totalRects(layers), 2); // 3×3 + 1×1
  });

  test("L-shape bbox expansion (#$# / #$$ / ###)", () => {
    const px = [0, 1, 0, 0, 1, 1, 0, 0, 0];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 3), px);
    assert.equal(totalRects(layers), 3); // 3×3 + 2×2 + 1×1
    for (const l of layers)
      assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("nested ring", () => {
    // prettier-ignore
    const px = [
      0,0,0,0,0,
      0,1,1,1,0,
      0,1,0,1,0,
      0,1,1,1,0,
      0,0,0,0,0,
    ];
    const layers = layeredDecompose(px, 5);
    assert.deepEqual(renderLayers(layers, 5, 5), px);
    assert.equal(totalRects(layers), 3); // 5×5 + 3×3 + 1×1
  });

  test("deep nesting (3 levels)", () => {
    // prettier-ignore
    const px = [
      0,0,0,0,0,0,
      0,1,1,1,1,0,
      0,1,0,0,1,0,
      0,1,0,0,1,0,
      0,1,1,1,1,0,
      0,0,0,0,0,0,
    ];
    const layers = layeredDecompose(px, 6);
    assert.deepEqual(renderLayers(layers, 6, 6), px);
    assert.equal(totalRects(layers), 3); // 6×6 + 4×4 + 2×2
  });

  test("staircase — each layer is a single rect", () => {
    // prettier-ignore
    const px = [
      1,1,1,1,1,
      0,1,1,1,1,
      0,0,1,1,1,
      0,0,0,1,1,
      0,0,0,0,1,
    ];
    const layers = layeredDecompose(px, 5);
    assert.deepEqual(renderLayers(layers, 5, 5), px);
    for (const l of layers)
      assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("center pixel — hole becomes 2 rects instead of 5", () => {
    const px = [0, 0, 0, 0, 1, 0, 0, 0, 0];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 3), px);
    assert.equal(totalRects(layers), 2);
  });

  test("snake spanning full bbox — terminates (no infinite recursion)", () => {
    // B(1) snakes through A(0) grid:
    // 1 0 0 0
    // 1 1 1 0
    // 0 0 1 1
    // 0 0 0 1
    // prettier-ignore
    const px = [
      1,0,0,0,
      1,1,1,0,
      0,0,1,1,
      0,0,0,1,
    ];
    const layers = layeredDecompose(px, 4);
    assert.deepEqual(renderLayers(layers, 4, 4), px);
    assert.ok(totalRects(layers) > 0);
  });

  test("multi-color adjacent (3 colors)", () => {
    // 0 1 2
    // 0 0 0
    const px = [0, 1, 2, 0, 0, 0];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 2), px);
    for (const l of layers)
      assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("side-by-side equal areas", () => {
    // 0 0 1 1
    // 0 0 1 1
    const px = [0, 0, 1, 1, 0, 0, 1, 1];
    const layers = layeredDecompose(px, 4);
    assert.deepEqual(renderLayers(layers, 4, 2), px);
    assert.equal(totalRects(layers), 2);
  });

  // ─── 3-color compositions ──────────────────────────────────────

  test("3 colors: concentric rings", () => {
    // prettier-ignore
    const px = [
      0,0,0,0,0,
      0,1,1,1,0,
      0,1,2,1,0,
      0,1,1,1,0,
      0,0,0,0,0,
    ];
    const layers = layeredDecompose(px, 5);
    assert.deepEqual(renderLayers(layers, 5, 5), px);
    assert.equal(totalRects(layers), 3); // 5×5 + 3×3 + 1×1
  });

  test("3 colors: vertical stripes", () => {
    // 0 0 1 1 2 2
    // 0 0 1 1 2 2
    // prettier-ignore
    const px = [
      0,0,1,1,2,2,
      0,0,1,1,2,2,
    ];
    const layers = layeredDecompose(px, 6);
    assert.deepEqual(renderLayers(layers, 6, 2), px);
    // bg covers 6×2, two sub-regions on top → 3 rects
    assert.equal(totalRects(layers), 3);
  });

  test("3 colors: column stack", () => {
    // 0 0 0
    // 0 1 0
    // 0 2 0
    // 0 0 0
    // prettier-ignore
    const px = [
      0,0,0,
      0,1,0,
      0,2,0,
      0,0,0,
    ];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 4), px);
    assert.equal(totalRects(layers), 3); // 3×4 + 1×2 + 1×1
  });

  test("3 colors: L-shapes interleaved", () => {
    // 0 1 2
    // 0 1 2
    // 0 0 0
    // prettier-ignore
    const px = [
      0,1,2,
      0,1,2,
      0,0,0,
    ];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 3), px);
    for (const l of layers)
      assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("3 colors: diagonal scatter", () => {
    // 0 1 2
    // 2 0 1
    // 1 2 0
    // prettier-ignore
    const px = [
      0,1,2,
      2,0,1,
      1,2,0,
    ];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 3), px);
    // correctness is the key check here
  });

  // ─── N-color compositions ─────────────────────────────────────

  test("5 colors: horizontal stripes", () => {
    // prettier-ignore
    const px = [
      0,0,0,0,0,
      1,1,1,1,1,
      2,2,2,2,2,
      3,3,3,3,3,
      4,4,4,4,4,
    ];
    const layers = layeredDecompose(px, 5);
    assert.deepEqual(renderLayers(layers, 5, 5), px);
    assert.equal(totalRects(layers), 5);
    for (const l of layers)
      assert.equal(l.rects.length, 1, `color=${l.color}`);
  });

  test("4 colors: concentric squares", () => {
    // prettier-ignore
    const px = [
      0,0,0,0,0,0,0,
      0,1,1,1,1,1,0,
      0,1,2,2,2,1,0,
      0,1,2,3,2,1,0,
      0,1,2,2,2,1,0,
      0,1,1,1,1,1,0,
      0,0,0,0,0,0,0,
    ];
    const layers = layeredDecompose(px, 7);
    assert.deepEqual(renderLayers(layers, 7, 7), px);
    assert.equal(totalRects(layers), 4); // 7×7 + 5×5 + 3×3 + 1×1
  });

  test("6 colors: 2×3 grid of distinct colors", () => {
    // 0 1 2
    // 3 4 5
    const px = [0, 1, 2, 3, 4, 5];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 2), px);
    assert.equal(layers.length, 6);
  });

  test("8 colors: checkerboard 4×4 with 2 repeats", () => {
    // prettier-ignore
    const px = [
      0,1,2,3,
      4,5,6,7,
      0,1,2,3,
      4,5,6,7,
    ];
    const layers = layeredDecompose(px, 4);
    assert.deepEqual(renderLayers(layers, 4, 4), px);
  });

  test("5 colors: nested L-shapes", () => {
    // 0 1 1 1
    // 0 2 3 1
    // 0 2 4 1
    // 0 0 0 0
    // prettier-ignore
    const px = [
      0,1,1,1,
      0,2,3,1,
      0,2,4,1,
      0,0,0,0,
    ];
    const layers = layeredDecompose(px, 4);
    assert.deepEqual(renderLayers(layers, 4, 4), px);
  });

  test("3 colors: T-shape composition", () => {
    // 1 1 1
    // 0 1 0
    // 0 2 0
    // 0 2 0
    // prettier-ignore
    const px = [
      1,1,1,
      0,1,0,
      0,2,0,
      0,2,0,
    ];
    const layers = layeredDecompose(px, 3);
    assert.deepEqual(renderLayers(layers, 3, 4), px);
  });

  // ─── renderAsSVGPolygon ─────────────────────────────────────────

  test("SVG: one path per layer, correct order", () => {
    // 0 0 1
    // 0 0 0
    // 0 0 0
    const px = [0, 0, 1, 0, 0, 0, 0, 0, 0];
    const layers = layeredDecompose(px, 3);
    const palette = ["#ff0000", "#0000ff"];
    const svg = renderAsSVGPolygon(layers, 3, 3, (c) => palette[c]);

    assert.ok(svg.startsWith('<svg xmlns='));
    assert.ok(svg.endsWith("</svg>"));

    // 2 layers → 2 <path> elements
    const paths = [...svg.matchAll(/<path /g)];
    assert.equal(paths.length, 2);

    // Background (red) appears before foreground (blue) in SVG
    assert.ok(svg.indexOf("#ff0000") < svg.indexOf("#0000ff"));
  });

  test("SVG: path data uses h/v relative commands", () => {
    const px = [0, 0, 0, 0];
    const layers = layeredDecompose(px, 2);
    const svg = renderAsSVGPolygon(layers, 2, 2, () => "#000");

    // Single rect 2×2 → M0,0h2v2h-2z
    assert.ok(svg.includes("M0,0h2v2h-2z"));
  });

  test("SVG: nested ring produces 3 paths", () => {
    // prettier-ignore
    const px = [
      0,0,0,0,0,
      0,1,1,1,0,
      0,1,2,1,0,
      0,1,1,1,0,
      0,0,0,0,0,
    ];
    const layers = layeredDecompose(px, 5);
    const palette = ["#aaa", "#bbb", "#ccc"];
    const svg = renderAsSVGPolygon(layers, 5, 5, (c) => palette[c]);

    const paths = [...svg.matchAll(/<path /g)];
    assert.equal(paths.length, 3);

    // Each layer is a single rect, so each path has exactly one M command
    const mCount = [...svg.matchAll(/M\d/g)];
    assert.equal(mCount.length, 3);
  });

  test("SVG: staircase all single-rect paths", () => {
    // prettier-ignore
    const px = [
      1,1,1,1,1,
      0,1,1,1,1,
      0,0,1,1,1,
      0,0,0,1,1,
      0,0,0,0,1,
    ];
    const layers = layeredDecompose(px, 5);
    const svg = renderAsSVGPolygon(layers, 5, 5, (c) =>
      c === 0 ? "#000" : "#fff",
    );

    // Each of the 5 layers is a single rect → 5 M commands
    const mCount = [...svg.matchAll(/M\d/g)];
    assert.equal(mCount.length, 5);
  });

  test("SVG: viewBox matches dimensions", () => {
    const px = [0, 1, 2, 3, 4, 5];
    const layers = layeredDecompose(px, 3);
    const svg = renderAsSVGPolygon(layers, 3, 2, (c) => `#${c}${c}${c}`);

    assert.ok(svg.includes('width="3"'));
    assert.ok(svg.includes('height="2"'));
    assert.ok(svg.includes('viewBox="0 0 3 2"'));
  });
});

// ─── Visual regression (Puppeteer) ─────────────────────────────

describe("visual regression", () => {
  let browser;

  before(async () => {
    const puppeteer = await import("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
  });

  after(async () => {
    await browser?.close();
  });

  async function renderSVG(svgContent, width, height) {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    const tmp = path.join(__dirname, `_vrt_tmp_${Date.now()}.svg`);
    fs.writeFileSync(tmp, svgContent, "utf-8");
    try {
      await page.goto("file://" + tmp, { waitUntil: "load" });
      const buf = await page.screenshot({ type: "png", omitBackground: true });
      return Buffer.from(buf);
    } finally {
      fs.unlinkSync(tmp);
      await page.close();
    }
  }

  function rgbaToCSS(rgba) {
    const r = (rgba >>> 24) & 0xff;
    const g = (rgba >>> 16) & 0xff;
    const b = (rgba >>> 8) & 0xff;
    return `rgb(${r},${g},${b})`;
  }

  /**
   * Build indexed pixel array + palette from a Jimp image.
   */
  function indexImage(image) {
    const { width, height } = image;
    const map = new Map();
    const palette = [];
    const pixels = new Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const rgba = image.getPixelColor(x, y);
        let idx = map.get(rgba);
        if (idx === undefined) {
          idx = palette.length;
          map.set(rgba, idx);
          palette.push(rgba);
        }
        pixels[y * width + x] = idx;
      }
    }
    return { pixels, palette, width, height };
  }

  test("synthetic 10×10: layered SVG matches naive per-pixel SVG", async () => {
    const { Jimp } = await import("jimp");
    const inputPath = path.join(__dirname, "..", "test", "input.png");
    const fullImage = await Jimp.read(inputPath);

    // Crop a small 10×10 region for fast PoC
    const image = fullImage.clone().crop({ x: 0, y: 0, w: 10, h: 10 });
    const { pixels, palette, width, height } = indexImage(image);
    const toCSS = (c) => rgbaToCSS(palette[c]);

    // ── Layered SVG ──
    const layers = layeredDecompose(pixels, width);
    const layeredSVG = renderAsSVGPolygon(layers, width, height, toCSS);

    // ── Naive per-pixel SVG (ground truth) ──
    let naiveSVG =
      `<svg xmlns="http://www.w3.org/2000/svg"` +
      ` width="${width}" height="${height}"` +
      ` viewBox="0 0 ${width} ${height}">`;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const c = pixels[y * width + x];
        naiveSVG += `<rect x="${x}" y="${y}" width="1" height="1" fill="${toCSS(c)}"/>`;
      }
    naiveSVG += "</svg>";

    // ── Render both and compare ──
    const [layeredPng, naivePng] = await Promise.all([
      renderSVG(layeredSVG, width, height),
      renderSVG(naiveSVG, width, height),
    ]);

    const layeredImg = await Jimp.read(layeredPng);
    const naiveImg = await Jimp.read(naivePng);

    let diff = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (layeredImg.getPixelColor(x, y) !== naiveImg.getPixelColor(x, y))
          diff++;
      }

    assert.equal(diff, 0, `${diff} pixels differ out of ${width * height}`);
  });

  async function runCrop(label, cx, cy, cw, ch) {
    const { Jimp } = await import("jimp");
    const inputPath = path.join(__dirname, "..", "test", "input.png");
    const fullImage = await Jimp.read(inputPath);
    const image = fullImage.clone().crop({ x: cx, y: cy, w: cw, h: ch });
    const { pixels, palette, width, height } = indexImage(image);
    const toCSS = (c) => rgbaToCSS(palette[c]);

    const t0 = performance.now();
    const layers = layeredDecompose(pixels, width);
    const dt = performance.now() - t0;
    const layeredSVG = renderAsSVGPolygon(layers, width, height, toCSS);

    // Naive per-pixel SVG as ground truth
    let naiveSVG =
      `<svg xmlns="http://www.w3.org/2000/svg"` +
      ` width="${width}" height="${height}"` +
      ` viewBox="0 0 ${width} ${height}">`;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const c = pixels[y * width + x];
        naiveSVG += `<rect x="${x}" y="${y}" width="1" height="1" fill="${toCSS(c)}"/>`;
      }
    naiveSVG += "</svg>";

    const [layeredPng, naivePng] = await Promise.all([
      renderSVG(layeredSVG, width, height),
      renderSVG(naiveSVG, width, height),
    ]);

    const layeredImg = await Jimp.read(layeredPng);
    const naiveImg = await Jimp.read(naivePng);

    let diff = 0;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (layeredImg.getPixelColor(x, y) !== naiveImg.getPixelColor(x, y))
          diff++;
      }

    const nRects = totalRects(layers);
    console.log(
      `  ${label}: ${palette.length} colors, ${nRects} rects (naive: ${width * height}), ${dt.toFixed(0)}ms`,
    );

    assert.equal(diff, 0, `${diff} pixels differ out of ${width * height}`);
    return { colors: palette.length, rects: nRects, naive: width * height, ms: dt };
  }

  test("50×50 (0,0)", async () => {
    await runCrop("50×50", 0, 0, 50, 50);
  });

  test("100×100 (0,0) 203 colors", async () => {
    await runCrop("100×100", 0, 0, 100, 100);
  });

  test("200×100 (0,0) 203 colors", async () => {
    await runCrop("200×100", 0, 0, 200, 100);
  });

  test("200×100 (200,0) 164 colors", async () => {
    await runCrop("200×100 b", 200, 0, 200, 100);
  });

  test("full image 1390×900", async () => {
    const { Jimp } = await import("jimp");
    const inputPath = path.join(__dirname, "..", "test", "input.png");
    const image = await Jimp.read(inputPath);
    const { pixels, palette, width, height } = indexImage(image);
    const toCSS = (c) => rgbaToCSS(palette[c]);

    console.log(`  full: ${width}×${height}, ${palette.length} colors`);

    const t0 = performance.now();
    const layers = layeredDecompose(pixels, width);
    const dt = performance.now() - t0;

    const nRects = totalRects(layers);
    console.log(`  full: ${nRects} rects (naive: ${width * height}), ${dt.toFixed(0)}ms`);
    console.log(`  full: ${layers.length} layers`);

    // Render SVG and verify via Puppeteer
    const layeredSVG = renderAsSVGPolygon(layers, width, height, toCSS);

    // Build a naive 1-rect-per-color SVG (grouped by color, no overlap)
    // Too large for per-pixel naive, so just verify rendering correctness
    // by checking a sample of pixels
    const pngBuf = await renderSVG(layeredSVG, width, height);
    const rendered = await Jimp.read(pngBuf);

    let diff = 0;
    const total = width * height;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (rendered.getPixelColor(x, y) !== image.getPixelColor(x, y))
          diff++;
      }
    }
    console.log(`  full: ${diff} pixel diffs out of ${total}`);
    assert.equal(diff, 0, `${diff} pixels differ out of ${total}`);
  });
});
