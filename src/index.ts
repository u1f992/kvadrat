import child_process from "node:child_process";

import path from "node:path";
import { Worker } from "node:worker_threads";
import { intToRGBA } from "jimp";
import * as jimp from "jimp";
import { ColorHex, colorHex } from "./color-hex.js";

const WORKER = path.join(import.meta.dirname, "worker.js");

function createPBM10x(
  width: number,
  height: number,
  pixels: [number, number][],
): string {
  const w10 = width * 10;
  const h10 = height * 10;
  const map = new Set(pixels.map(([x, y]) => `${x},${y}`));

  let pbm = `P1\n${w10} ${h10}\n`;
  for (let y = 0; y < height; y++) {
    for (let dy = 0; dy < 10; dy++) {
      let row = "";
      for (let x = 0; x < width; x++) {
        const on = map.has(`${x},${y}`) ? "1" : "0";
        row += `${on} `.repeat(10);
      }
      pbm += row + "\n";
    }
  }
  return pbm;
}

export async function toSVG(image: Awaited<ReturnType<typeof jimp.Jimp.read>>) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;
  console.log("start");

  const width = image.width;
  const height = image.height;
  const colors = new Map<ColorHex, [number, number][]>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const rgba = intToRGBA(image.getPixelColor(x, y));
      const hex = colorHex(rgba);
      if (!colors.has(hex)) {
        colors.set(hex, []);
      }
      colors.get(hex)!.push([x, y]);
    }
  }
  console.log("done");

  for (const [color, pixels] of colors.entries()) {
    const pbm = createPBM10x(image.width, image.height, pixels);
    const svg = new TextDecoder().decode(
      child_process.spawnSync(
        "potrace",
        [
          "-",
          "--output",
          "-",
          "--svg",
          "--turdsize=0",
          "--alphamax=0",
          "--longcurve",
          "--resolution=720",
          "--flat",
        ],
        { input: new TextEncoder().encode(pbm) },
      ).stdout,
    );
    (await import("node:fs")).writeFileSync(`out/${color}.svg`, svg);
  }
  svg += "</svg>";
  return svg;
}
