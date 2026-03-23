import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Jimp } from "jimp";
import puppeteer, { Browser } from "puppeteer";
import { toSVG } from "./index.js";

let browser: Browser;

async function renderSVGToPixels(
  svgContent: string,
  width: number,
  height: number,
): Promise<Buffer> {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  const dataUrl =
    "data:image/svg+xml;base64," + Buffer.from(svgContent).toString("base64");
  await page.goto(dataUrl, { waitUntil: "load" });
  const screenshot = await page.screenshot({
    type: "png",
    omitBackground: true,
  });
  await page.close();
  return Buffer.from(screenshot);
}

describe("toSVG visual regression", () => {
  before(async () => {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox"],
    });
  });

  after(async () => {
    await browser.close();
  });

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

    const width = image.width;
    const height = image.height;

    const [actualPng, referencePng] = await Promise.all([
      renderSVGToPixels(actualSVG, width, height),
      renderSVGToPixels(referenceSVG, width, height),
    ]);

    // Decode PNGs with Jimp for pixel comparison
    const actualImg = await Jimp.read(actualPng);
    const referenceImg = await Jimp.read(referencePng);

    assert.equal(actualImg.width, referenceImg.width, "width mismatch");
    assert.equal(actualImg.height, referenceImg.height, "height mismatch");

    let diffPixels = 0;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (
          actualImg.getPixelColor(x, y) !== referenceImg.getPixelColor(x, y)
        ) {
          diffPixels++;
        }
      }
    }

    assert.equal(
      diffPixels,
      0,
      `${diffPixels} pixels differ out of ${width * height}`,
    );
  });
});
