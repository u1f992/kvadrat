import { performance } from "node:perf_hooks";
import { Jimp } from "jimp";
// @ts-ignore -- Emscripten-generated module, no .d.ts
import createModule from "./wasm/core.js";

const wasmModule = await createModule();

type JimpImage = {
  width: number;
  height: number;
  bitmap: { data: Buffer | Uint8Array | Uint8ClampedArray | number[] };
};

export type PerfResult = {
  buildEdges: number;
  workers: number;
  total: number;
  colorCount: number;
  edgeCount: number;
  workerPerfs: never[];
};

function rgbaToHex(rgba: number): string {
  return (
    "#" +
    ((rgba >>> 24) & 0xff).toString(16).padStart(2, "0") +
    ((rgba >>> 16) & 0xff).toString(16).padStart(2, "0") +
    ((rgba >>> 8) & 0xff).toString(16).padStart(2, "0") +
    (rgba & 0xff).toString(16).padStart(2, "0")
  );
}

function parseFlatPolygons(buf: Int32Array): [number, number][][] {
  const polygons: [number, number][][] = [];
  let pos = 0;
  while (pos < buf.length) {
    const pc = buf[pos]!;
    pos++;
    const polygon: [number, number][] = [];
    for (let i = 0; i < pc; i++) {
      polygon.push([buf[pos + i * 2]!, buf[pos + i * 2 + 1]!]);
    }
    pos += pc * 2;
    polygons.push(polygon);
  }
  return polygons;
}

function generateSVGPathData(polygons: [number, number][][]): string {
  return polygons
    .map(
      (polygon) =>
        "M" +
        polygon[0]![0] +
        "," +
        polygon[0]![1] +
        polygon
          .slice(1)
          .map((point, j) =>
            point[0] === polygon[j]![0]
              ? "v" + (point[1] - polygon[j]![1])
              : "h" + (point[0] - polygon[j]![0]),
          )
          .join("") +
        "z",
    )
    .join("");
}

function normalizePixels(
  data: Buffer | Uint8Array | Uint8ClampedArray | number[],
): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

export async function toSVG(image: JimpImage) {
  const pixels = normalizePixels(image.bitmap.data);

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  const results: { rgba: number; polygons: Int32Array }[] =
    wasmModule.processImage(pixels, image.width, image.height);

  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm processImage failed: ${results}`);
  }

  for (const { rgba, polygons } of results) {
    const hex = rgbaToHex(rgba);
    const polys = parseFlatPolygons(polygons);
    const d = generateSVGPathData(polys);
    svg += `<path stroke="none" fill="${hex}" d="${d}"/>`;
  }

  svg += "</svg>";
  return svg;
}

export async function toSVGWithPerf(
  image: JimpImage,
): Promise<{ svg: string; perf: PerfResult }> {
  const t0 = performance.now();

  const pixels = normalizePixels(image.bitmap.data);

  const tPixels = performance.now();

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width}" height="${image.height}" viewBox="0 0 ${image.width} ${image.height}">`;

  const results: { rgba: number; polygons: Int32Array }[] =
    wasmModule.processImage(pixels, image.width, image.height);

  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm processImage failed: ${results}`);
  }

  const tWasm = performance.now();

  let edgeCount = 0;
  for (const { rgba, polygons } of results) {
    const hex = rgbaToHex(rgba);
    const polys = parseFlatPolygons(polygons);
    const d = generateSVGPathData(polys);
    svg += `<path stroke="none" fill="${hex}" d="${d}"/>`;
  }

  svg += "</svg>";

  const tTotal = performance.now();

  return {
    svg,
    perf: {
      buildEdges: tPixels - t0,
      workers: tWasm - tPixels,
      total: tTotal - t0,
      colorCount: results.length,
      edgeCount,
      workerPerfs: [],
    },
  };
}
