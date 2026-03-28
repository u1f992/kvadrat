import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Jimp } from "jimp";
import puppeteer, { Browser } from "puppeteer";
import {
  decomposeLayered,
  decomposeFlat,
  decomposeOutline,
  renderAsSVGPath,
  renderAsSVGPolygon,
  renderAsSVGRect,
  renderAsCSSBackground,
} from "../src/index.ts";
import type { JimpImageCompat } from "../src/index.ts";

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
  const tmp = path.join(
    tmpDir,
    `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
  );
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

async function assertPixelPerfect(
  image: JimpImageCompat & { getPixelColor(x: number, y: number): number },
  svgOrCss: string,
  renderMode: "svg" | "css",
  selector: string = ".image",
): Promise<void> {
  const { width, height } = image;
  const pngBuf =
    renderMode === "css"
      ? await renderCSS(svgOrCss, width, height, selector)
      : await renderSVG(svgOrCss, width, height);
  const rendered = await Jimp.read(pngBuf);

  let diff = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (rendered.getPixelColor(x, y) !== image.getPixelColor(x, y)) diff++;

  assert.equal(diff, 0, `${diff} pixels differ out of ${width * height}`);
}

async function loadImage() {
  const inputPath = path.join(import.meta.dirname, "..", "assets", "input.png");
  return Jimp.read(inputPath);
}

/* ─── Test definitions ───────────────────────────────────────── */

type DecomposeAndRender = (
  image: JimpImageCompat,
) => Promise<{ output: string; mode: "svg" | "css"; selector?: string }>;

const pipelines: [string, DecomposeAndRender][] = [
  [
    "layered-path",
    async (image) => {
      const layers = await decomposeLayered(image);
      return {
        output: renderAsSVGPath(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "layered-rect",
    async (image) => {
      const layers = await decomposeLayered(image);
      return {
        output: renderAsSVGRect(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "layered-polygon",
    async (image) => {
      const layers = await decomposeLayered(image);
      return {
        output: renderAsSVGPolygon(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "flat-path",
    async (image) => {
      const layers = await decomposeFlat(image);
      return {
        output: renderAsSVGPath(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "flat-rect",
    async (image) => {
      const layers = await decomposeFlat(image);
      return {
        output: renderAsSVGRect(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "flat-polygon",
    async (image) => {
      const layers = await decomposeFlat(image);
      return {
        output: renderAsSVGPolygon(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "outline-polygon",
    async (image) => {
      const layers = await decomposeOutline(image);
      return {
        output: renderAsSVGPolygon(layers, image.width, image.height),
        mode: "svg",
      };
    },
  ],
  [
    "layered-css-gradient",
    async (image) => {
      const layers = await decomposeLayered(image);
      return {
        output: renderAsCSSBackground(layers, image.width, image.height, {
          selector: ".image",
          material: "linear-gradient",
        }),
        mode: "css",
        selector: ".image",
      };
    },
  ],
  [
    "layered-css-svg",
    async (image) => {
      const layers = await decomposeLayered(image);
      return {
        output: renderAsCSSBackground(layers, image.width, image.height, {
          selector: ".image",
          material: "svg",
        }),
        mode: "css",
        selector: ".image",
      };
    },
  ],
];

/* ─── Tests ──────────────────────────────────────────────────── */

describe("visual regression", () => {
  for (const [name, pipeline] of pipelines) {
    test(`${name}: 50×50 crop`, async () => {
      const image = await loadImage();
      const crop = image.clone().crop({ x: 0, y: 0, w: 50, h: 50 });
      const { output, mode, selector } = await pipeline(crop);
      await assertPixelPerfect(crop, output, mode, selector);
    });

    test(`${name}: 200×100 crop`, async () => {
      const image = await loadImage();
      const crop = image.clone().crop({ x: 0, y: 0, w: 200, h: 100 });
      const { output, mode, selector } = await pipeline(crop);
      await assertPixelPerfect(crop, output, mode, selector);
    });

    test(`${name}: full 1390×900`, async () => {
      const image = await loadImage();
      const { output, mode, selector } = await pipeline(image);
      await assertPixelPerfect(image, output, mode, selector);
    });
  }
});
