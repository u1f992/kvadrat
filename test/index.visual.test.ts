import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Jimp } from "jimp";
import puppeteer, { Browser } from "puppeteer";
import {
  layeredDecompose,
  renderAsSVGPolygon,
  renderAsSVGRect,
  renderAsCSSBackground,
} from "../src/index.ts";
import type { JimpImageCompat, Layer } from "../src/index.ts";

let browser: Browser;

before(async () => {
  const tmpDir = path.join(import.meta.dirname, "..", ".vrt-tmp");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
});

after(async () => {
  await browser.close();
});

/* ─── Helpers ────────────────────────────────────────────────── */

async function renderInBrowser(
  content: string,
  width: number,
  height: number,
  ext: string = "svg",
): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const tmpDir = path.join(import.meta.dirname, "..", ".vrt-tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${Date.now()}.${ext}`);
  fs.writeFileSync(tmp, content, "utf-8");
  await page.goto("file://" + tmp, { waitUntil: "load" });
  const buf = await page.screenshot({ type: "png", omitBackground: true });
  await page.close();
  return Buffer.from(buf);
}

function renderSVG(svg: string, w: number, h: number) {
  return renderInBrowser(svg, w, h, "svg");
}

function renderCSS(css: string, w: number, h: number, selector: string) {
  const className = selector.replace(/^\./, "");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body style="margin:0"><div class="${className}"></div></body></html>`;
  return renderInBrowser(html, w, h, "html");
}

type Renderer = (
  layers: Layer[],
  w: number,
  h: number,
  opts?: Record<string, unknown>,
) => string;

async function assertPixelPerfect(
  image: JimpImageCompat & { getPixelColor(x: number, y: number): number },
  renderer: Renderer,
  renderMode: "svg" | "css",
  rendererOpts?: Record<string, unknown>,
): Promise<{ rects: number; layers: number }> {
  const { layers } = await layeredDecompose(image);
  const { width, height } = image;
  const output = renderer(layers, width, height, rendererOpts);

  const selector = (rendererOpts?.selector as string | undefined) ?? ".image";
  const pngBuf =
    renderMode === "css"
      ? await renderCSS(output, width, height, selector)
      : await renderSVG(output, width, height);
  const rendered = await Jimp.read(pngBuf);

  let diff = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (rendered.getPixelColor(x, y) !== image.getPixelColor(x, y)) diff++;

  assert.equal(diff, 0, `${diff} pixels differ out of ${width * height}`);

  const nRects = layers.reduce((s: number, l: Layer) => s + l.rects.length, 0);
  return { rects: nRects, layers: layers.length };
}

async function loadImage(): Promise<
  JimpImageCompat & {
    getPixelColor(x: number, y: number): number;
    clone(): any;
    crop(opts: { x: number; y: number; w: number; h: number }): any;
  }
> {
  const inputPath = path.join(import.meta.dirname, "..", "assets", "input.png");
  return Jimp.read(inputPath) as any;
}

/* ─── Tests ──────────────────────────────────────────────────── */

const renderers: [string, Renderer, "svg" | "css", Record<string, unknown>?][] =
  [
    ["path", renderAsSVGPolygon as Renderer, "svg"],
    ["rect", renderAsSVGRect as Renderer, "svg"],
    [
      "css-gradient",
      (l, w, h, o) => renderAsCSSBackground(l, w, h, o as any),
      "css",
      { selector: ".image", material: "linear-gradient" },
    ],
    [
      "css-svg",
      (l, w, h, o) => renderAsCSSBackground(l, w, h, o as any),
      "css",
      { selector: ".image", material: "svg" },
    ],
  ];

describe("visual regression", () => {
  for (const [name, renderer, mode, opts] of renderers) {
    test(`${name}: 50×50 crop`, async () => {
      const image = await loadImage();
      const crop = image.clone().crop({ x: 0, y: 0, w: 50, h: 50 });
      const { rects } = await assertPixelPerfect(crop, renderer, mode, opts);
      console.log(`  ${name} 50×50: ${rects} rects`);
    });

    test(`${name}: 200×100 crop`, async () => {
      const image = await loadImage();
      const crop = image.clone().crop({ x: 0, y: 0, w: 200, h: 100 });
      const { rects } = await assertPixelPerfect(crop, renderer, mode, opts);
      console.log(`  ${name} 200×100: ${rects} rects`);
    });

    test(`${name}: full 1390×900`, async () => {
      const image = await loadImage();
      const { rects, layers } = await assertPixelPerfect(
        image,
        renderer,
        mode,
        opts,
      );
      console.log(`  ${name} full: ${rects} rects, ${layers} layers`);
    });
  }
});
