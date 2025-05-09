import path from "node:path";
import { Worker } from "node:worker_threads";
import { Jimp, intToRGBA } from "jimp";
import { ColorHex, colorHex } from "./color-hex.js";

type DLS = [[number, number], [number, number]];

type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

const WORKER = path.join(import.meta.dirname, "worker.js");

export async function toSVG(image: JimpImage) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  // Mark all four edges of each square in clockwise drawing direction
  const segmentsOf = new Map<ColorHex, DLS[]>();
  for (let x = 0; x < image.width; x++) {
    for (let y = 0; y < image.height; y++) {
      const hex = colorHex(intToRGBA(image.getPixelColor(x, y)));
      if (!segmentsOf.has(hex)) {
        segmentsOf.set(hex, []);
      }
      // prettier-ignore
      segmentsOf.get(hex)!.push(
        [[x    , y    ], [x + 1, y    ]],
        [[x + 1, y    ], [x + 1, y + 1]],
        [[x + 1, y + 1], [x    , y + 1]],
        [[x    , y + 1], [x    , y    ]],
      )
    }
  }

  const promises: Promise<string>[] = [];
  for (const [hex, segments] of segmentsOf.entries()) {
    promises.push(
      new Promise((resolve, reject) => {
        new Worker(WORKER, {
          workerData: { hex, segments },
        })
          .on("message", resolve)
          .on("error", reject);
      }),
    );
  }
  svg += (await Promise.all(promises)).join("");
  svg += "</svg>";
  return svg;
}
