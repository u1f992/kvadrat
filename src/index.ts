import path from "node:path";
import { Worker } from "node:worker_threads";
import { intToRGBA } from "jimp";
import { ColorHex, colorHex } from "./color-hex.js";
import { measureTime } from "./measure-time.js";

type JimpImage = {
  width: number;
  height: number;
  getPixelColor: (x: number, y: number) => number;
};

const WORKER = path.join(import.meta.dirname, "worker.js");

export async function toSVG(image: JimpImage) {
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  // Mark all four edges of each square in clockwise drawing direction
  const edgesOf = new Map<ColorHex, [number, number, number, number][]>();
  await measureTime("collectEdges", () => {
    for (let x = 0; x < image.width; x++) {
      for (let y = 0; y < image.height; y++) {
        const hex = colorHex(intToRGBA(image.getPixelColor(x, y)));
        if (!edgesOf.has(hex)) {
          edgesOf.set(hex, []);
        }
        // prettier-ignore
        edgesOf.get(hex)!.push(
          [x    , y    , x + 1, y    ],
          [x + 1, y    , x + 1, y + 1],
          [x + 1, y + 1, x    , y + 1],
          [x    , y + 1, x    , y    ],
        )
      }
    }
  });

  // for (const [hex, edges] of edgesOf.entries()) {
  //   svg += toSVGPath(hex, edges);
  // }
  const promises: Promise<string>[] = [];
  for (const [hex, edges] of edgesOf.entries()) {
    promises.push(
      new Promise((resolve, reject) => {
        new Worker(WORKER, {
          workerData: { hex, edges },
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
