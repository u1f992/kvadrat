import path from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { intToRGBA } from "jimp";
import { ColorHex, colorHex } from "./color-hex.js";
import { WorkerPerf } from "./worker.js";

type JimpImage = {
  width: number;
  height: number;
  getPixelColor: (x: number, y: number) => number;
};

const WORKER = path.join(import.meta.dirname, "worker.js");

export type PerfResult = {
  buildEdges: number;
  workers: number;
  total: number;
  colorCount: number;
  edgeCount: number;
  workerPerfs: WorkerPerf[];
};

export async function toSVG(image: JimpImage) {
  const { svg } = await toSVGWithPerf(image);
  return svg;
}

export async function toSVGWithPerf(
  image: JimpImage,
): Promise<{ svg: string; perf: PerfResult }> {
  const t0 = performance.now();

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  // Mark all four edges of each square in clockwise drawing direction
  const edgesOf = new Map<ColorHex, [number, number, number, number][]>();
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

  const tEdges = performance.now();

  const totalEdges = [...edgesOf.values()].reduce(
    (sum, e) => sum + e.length,
    0,
  );

  const promises: Promise<{ svg: string; perf: WorkerPerf }>[] = [];
  for (const [hex, edges] of edgesOf.entries()) {
    promises.push(
      new Promise((resolve, reject) => {
        new Worker(WORKER, {
          workerData: { hex, edges, returnPerf: true },
        })
          .on("message", resolve)
          .on("error", reject);
      }),
    );
  }
  const results = await Promise.all(promises);
  svg += results.map((r) => r.svg).join("");
  svg += "</svg>";

  const tTotal = performance.now();

  return {
    svg,
    perf: {
      buildEdges: tEdges - t0,
      workers: tTotal - tEdges,
      total: tTotal - t0,
      colorCount: edgesOf.size,
      edgeCount: totalEdges,
      workerPerfs: results.map((r) => r.perf),
    },
  };
}
