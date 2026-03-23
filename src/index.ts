import path from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { intToRGBA } from "jimp";
import { ColorHex, colorHex } from "./color-hex.js";
import { toSVGPathWithPerf, WorkerPerf } from "./worker.js";

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

  // Pass 1: Count pixels per color
  const pixelCount = new Map<ColorHex, number>();
  for (let x = 0; x < image.width; x++) {
    for (let y = 0; y < image.height; y++) {
      const hex = colorHex(intToRGBA(image.getPixelColor(x, y)));
      pixelCount.set(hex, (pixelCount.get(hex) ?? 0) + 1);
    }
  }

  // Allocate Int32Arrays: 4 edges per pixel, 4 ints per edge = 16 ints per pixel
  const edgesOf = new Map<ColorHex, Int32Array>();
  const offsets = new Map<ColorHex, number>();
  for (const [hex, count] of pixelCount) {
    edgesOf.set(hex, new Int32Array(count * 16));
    offsets.set(hex, 0);
  }

  // Pass 2: Fill edge data
  for (let x = 0; x < image.width; x++) {
    for (let y = 0; y < image.height; y++) {
      const hex = colorHex(intToRGBA(image.getPixelColor(x, y)));
      const buf = edgesOf.get(hex)!;
      let off = offsets.get(hex)!;
      // prettier-ignore
      buf[off++] = x;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y;
      // prettier-ignore
      buf[off++] = x + 1;
      buf[off++] = y;
      buf[off++] = x + 1;
      buf[off++] = y + 1;
      // prettier-ignore
      buf[off++] = x + 1;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y + 1;
      // prettier-ignore
      buf[off++] = x;
      buf[off++] = y + 1;
      buf[off++] = x;
      buf[off++] = y;
      offsets.set(hex, off);
    }
  }

  const tEdges = performance.now();

  let totalEdges = 0;
  for (const count of pixelCount.values()) {
    totalEdges += count * 4;
  }

  // Phase 1: Spawn workers for heavy colors first so they run in parallel
  const WORKER_EDGE_THRESHOLD = 10000;
  const entries = [...edgesOf.entries()];
  const results: ({ svg: string; perf: WorkerPerf } | null)[] = new Array(
    entries.length,
  ).fill(null);
  const workerSlots: {
    index: number;
    promise: Promise<{ svg: string; perf: WorkerPerf }>;
  }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const [hex, edges] = entries[i]!;
    const edgeCount = edges.length / 4;
    if (edgeCount > WORKER_EDGE_THRESHOLD) {
      workerSlots.push({
        index: i,
        promise: new Promise((resolve, reject) => {
          new Worker(WORKER, {
            workerData: { hex, edges, edgeCount, returnPerf: true },
            transferList: [edges.buffer],
          })
            .on("message", resolve)
            .on("error", reject);
        }),
      });
    }
  }

  // Phase 2: Process lightweight colors on main thread while workers run
  for (let i = 0; i < entries.length; i++) {
    const [hex, edges] = entries[i]!;
    const edgeCount = edges.length / 4;
    if (edgeCount <= WORKER_EDGE_THRESHOLD) {
      results[i] = toSVGPathWithPerf(hex, edges, edgeCount);
    }
  }

  // Phase 3: Await worker results and fill remaining slots
  const workerResults = await Promise.all(workerSlots.map((s) => s.promise));
  for (let j = 0; j < workerSlots.length; j++) {
    results[workerSlots[j]!.index] = workerResults[j]!;
  }

  svg += results.map((r) => r!.svg).join("");
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
      workerPerfs: results.map((r) => r!.perf),
    },
  };
}
