import { performance } from "node:perf_hooks";
import { intToRGBA } from "jimp";
import { ColorHex, colorHex } from "./color-hex.js";
import { toSVGPath, collectPerf, PERF_SYMBOL, WorkerPerf } from "./worker.js";
import { submitTask, TaskResult } from "./worker-pool.js";

type JimpImage = {
  width: number;
  height: number;
  getPixelColor: (x: number, y: number) => number;
};

export type PerfResult = {
  buildEdges: number;
  workers: number;
  total: number;
  colorCount: number;
  edgeCount: number;
  workerPerfs: WorkerPerf[];
};

// Edge count threshold: colors with fewer edges are processed on the main
// thread to avoid worker dispatch overhead, which exceeds processing time
// for small inputs.
const WORKER_EDGE_THRESHOLD = 10000;

type EdgeEntry = [ColorHex, Int32Array] | null;

function buildEdges(image: JimpImage): {
  entries: EdgeEntry[];
  totalEdges: number;
} {
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

  let totalEdges = 0;
  for (const count of pixelCount.values()) {
    totalEdges += count * 4;
  }

  return {
    entries: [...edgesOf.entries()] as EdgeEntry[],
    totalEdges,
  };
}

export async function toSVG(image: JimpImage) {
  const { entries, totalEdges } = buildEdges(image);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  // Phase 1: Submit heavy colors to worker pool
  const workerSlots: { index: number; promise: Promise<TaskResult> }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const [hex, edges] = entry;
    const edgeCount = edges.length / 4;
    if (edgeCount > WORKER_EDGE_THRESHOLD) {
      workerSlots.push({
        index: i,
        promise: submitTask(hex, edges, edgeCount, false),
      });
      entries[i] = null; // buffer transferred, prevent accidental access
    }
  }

  // Phase 2: Process lightweight colors on main thread while workers run
  const svgParts: (string | null)[] = new Array(entries.length).fill(null);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const [hex, edges] = entry;
    svgParts[i] = toSVGPath(hex, edges, edges.length / 4);
  }

  // Phase 3: Await worker results
  const workerResults = await Promise.all(workerSlots.map((s) => s.promise));
  for (let j = 0; j < workerSlots.length; j++) {
    svgParts[workerSlots[j]!.index] = workerResults[j]!.svg;
  }

  svg += svgParts.filter(Boolean).join("");
  svg += "</svg>";
  return svg;
}

export async function toSVGWithPerf(
  image: JimpImage,
): Promise<{ svg: string; perf: PerfResult }> {
  const t0 = performance.now();

  const { entries, totalEdges } = buildEdges(image);
  const colorCount = entries.length;

  const tEdges = performance.now();

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  // Phase 1: Submit heavy colors to worker pool with perf
  const results: (TaskResult | null)[] = new Array(entries.length).fill(null);
  const workerSlots: { index: number; promise: Promise<TaskResult> }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const [hex, edges] = entry;
    const edgeCount = edges.length / 4;
    if (edgeCount > WORKER_EDGE_THRESHOLD) {
      workerSlots.push({
        index: i,
        promise: submitTask(hex, edges, edgeCount, true),
      });
      entries[i] = null;
    }
  }

  // Phase 2: Process lightweight colors on main thread with perf
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    const [hex, edges] = entry;
    const edgeCount = edges.length / 4;
    const { svg: pathSvg, perf } = collectPerf(hex, edges, edgeCount);
    results[i] = { svg: pathSvg, [PERF_SYMBOL]: perf };
  }

  // Phase 3: Await worker results
  const workerResults = await Promise.all(workerSlots.map((s) => s.promise));
  for (let j = 0; j < workerSlots.length; j++) {
    results[workerSlots[j]!.index] = workerResults[j]!;
  }

  svg += results
    .filter(Boolean)
    .map((r) => r!.svg)
    .join("");
  svg += "</svg>";

  const tTotal = performance.now();

  const workerPerfs: WorkerPerf[] = [];
  for (const r of results) {
    if (r && r[PERF_SYMBOL]) workerPerfs.push(r[PERF_SYMBOL]);
  }

  return {
    svg,
    perf: {
      buildEdges: tEdges - t0,
      workers: tTotal - tEdges,
      total: tTotal - t0,
      colorCount,
      edgeCount: totalEdges,
      workerPerfs,
    },
  };
}
