import { performance } from "node:perf_hooks";
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

function normalizePixels(
  data: Buffer | Uint8Array | Uint8ClampedArray | number[],
): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

function processImage(
  image: JimpImage,
  mode: number,
): { rgba: number; polygons: Int32Array }[] {
  const pixels = normalizePixels(image.bitmap.data);
  const results = wasmModule.processImage(
    pixels,
    image.width,
    image.height,
    mode,
  );
  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm processImage failed: ${results}`);
  }
  return results;
}

function svgHeader(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
}

/* --- Polygon mode --- */

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

export async function toSVG(image: JimpImage): Promise<string> {
  const results = processImage(image, 0);
  let svg = svgHeader(image.width, image.height);
  for (const { rgba, polygons } of results) {
    const d = generateSVGPathData(parseFlatPolygons(polygons));
    svg += `<path stroke="none" fill="${rgbaToHex(rgba)}" d="${d}"/>`;
  }
  svg += "</svg>";
  return svg;
}

/* --- Rectangle mode --- */

export type Rect = { x: number; y: number; w: number; h: number };

export type RectResult = {
  color: string;
  rects: Rect[];
};

function parseFlatRectangles(buf: Int32Array): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    rects.push({
      x: buf[i]!,
      y: buf[i + 1]!,
      w: buf[i + 2]!,
      h: buf[i + 3]!,
    });
  }
  return rects;
}

export async function toRectangles(image: JimpImage): Promise<RectResult[]> {
  const results = processImage(image, 1);
  return results.map(({ rgba, polygons }) => ({
    color: rgbaToHex(rgba),
    rects: parseFlatRectangles(polygons),
  }));
}

export async function toRectSVG(image: JimpImage): Promise<string> {
  const results = await toRectangles(image);
  let svg = svgHeader(image.width, image.height);
  for (const { color, rects } of results) {
    for (const { x, y, w, h } of rects) {
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
    }
  }
  svg += "</svg>";
  return svg;
}

/* --- CSS background mode --- */

export async function toCSSBackground(
  image: JimpImage,
  selector: string = ".image",
): Promise<string> {
  const results = await toRectangles(image);
  const gradients: string[] = [];
  for (const { color, rects } of results) {
    for (const { x, y, w, h } of rects) {
      gradients.push(
        `linear-gradient(${color},${color}) ${x}px ${y}px / ${w}px ${h}px no-repeat`,
      );
    }
  }

  return `${selector} {\n  width: ${image.width}px;\n  height: ${image.height}px;\n  background:\n    ${gradients.join(",\n    ")};\n}\n`;
}

/* --- Perf --- */

export async function toSVGWithPerf(
  image: JimpImage,
): Promise<{ svg: string; perf: PerfResult }> {
  const t0 = performance.now();
  const pixels = normalizePixels(image.bitmap.data);
  const tPixels = performance.now();

  const results: { rgba: number; polygons: Int32Array }[] =
    wasmModule.processImage(pixels, image.width, image.height, 0);
  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm processImage failed: ${results}`);
  }
  const tWasm = performance.now();

  let svg = svgHeader(image.width, image.height);
  for (const { rgba, polygons } of results) {
    const d = generateSVGPathData(parseFlatPolygons(polygons));
    svg += `<path stroke="none" fill="${rgbaToHex(rgba)}" d="${d}"/>`;
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
    },
  };
}
