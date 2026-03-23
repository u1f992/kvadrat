import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Jimp } from "jimp";
import puppeteer, { Browser } from "puppeteer";
import { toSVG, toRectSVG } from "./index.js";

let browser: Browser;

before(async () => {
  browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
});

after(async () => {
  await browser.close();
});

async function renderSVGToPixels(
  svgContent: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });

  const tmpFile = path.join(
    import.meta.dirname,
    "..",
    "test",
    `_vrt_tmp_${Date.now()}.svg`,
  );
  fs.writeFileSync(tmpFile, svgContent, "utf-8");
  try {
    await page.goto("file://" + tmpFile, { waitUntil: "load" });
    const screenshot = await page.screenshot({
      type: "png",
      omitBackground: true,
    });
    await page.close();
    return Buffer.from(screenshot);
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

async function assertPixelMatch(
  actualSVG: string,
  referenceSVG: string,
  width: number,
  height: number,
) {
  const [actualPng, referencePng] = await Promise.all([
    renderSVGToPixels(actualSVG, width, height),
    renderSVGToPixels(referenceSVG, width, height),
  ]);

  const actualImg = await Jimp.read(actualPng);
  const referenceImg = await Jimp.read(referencePng);

  assert.equal(actualImg.width, referenceImg.width, "width mismatch");
  assert.equal(actualImg.height, referenceImg.height, "height mismatch");

  let diffPixels = 0;
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      if (actualImg.getPixelColor(x, y) !== referenceImg.getPixelColor(x, y)) {
        diffPixels++;
      }
    }
  }

  assert.equal(
    diffPixels,
    0,
    `${diffPixels} pixels differ out of ${width * height}`,
  );
}

describe("toSVG visual regression", () => {
  test("rendered output matches reference SVG pixel-for-pixel", async () => {
    const inputPath = path.join(import.meta.dirname, "..", "test", "input.png");
    const referencePath = path.join(
      import.meta.dirname,
      "..",
      "test",
      "output.svg",
    );

    const image = await Jimp.read(inputPath);
    const actualSVG = await toSVG(image);
    const referenceSVG = fs.readFileSync(referencePath, "utf-8");

    await assertPixelMatch(actualSVG, referenceSVG, image.width, image.height);
  });
});

describe("toRectSVG visual regression", () => {
  test("rendered rect SVG matches baseline pixel-for-pixel", async () => {
    const inputPath = path.join(import.meta.dirname, "..", "test", "input.png");
    const referencePath = path.join(
      import.meta.dirname,
      "..",
      "test",
      "output-rect-baseline.svg",
    );

    const image = await Jimp.read(inputPath);
    const actualSVG = await toRectSVG(image);
    const referenceSVG = fs.readFileSync(referencePath, "utf-8");

    await assertPixelMatch(actualSVG, referenceSVG, image.width, image.height);
  });
});
