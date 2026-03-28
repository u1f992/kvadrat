// @ts-expect-error -- Emscripten-generated module, no .d.ts
import createModule from "./wasm/core.js";

let wasmModule: Awaited<ReturnType<typeof createModule>>;
async function getModule() {
  if (!wasmModule) {
    wasmModule = await createModule();
  }
  return wasmModule;
}

/* ─── Types ───────────────────────────────────────────────────── */

export type JimpImageCompat = {
  width: number;
  height: number;
  bitmap: { data: Buffer | Uint8Array | Uint8ClampedArray | number[] };
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Point = [number, number];

export type PolygonLayer = {
  color: number; // RGBA packed as uint32 (R high, A low)
  polygons: Point[][];
};

export type RectLayer = PolygonLayer & {
  rects: Rect[];
};

/* ─── Color helpers ──────────────────────────────────────────── */

function rgbaToHex(rgba: number): string {
  return (
    "#" +
    ((rgba >>> 24) & 0xff).toString(16).padStart(2, "0") +
    ((rgba >>> 16) & 0xff).toString(16).padStart(2, "0") +
    ((rgba >>> 8) & 0xff).toString(16).padStart(2, "0") +
    (rgba & 0xff).toString(16).padStart(2, "0")
  );
}

function rgbaToRgb(rgba: number): string {
  return (
    "#" +
    ((rgba >>> 24) & 0xff).toString(16).padStart(2, "0") +
    ((rgba >>> 16) & 0xff).toString(16).padStart(2, "0") +
    ((rgba >>> 8) & 0xff).toString(16).padStart(2, "0")
  );
}

function rgbaToOpacity(rgba: number): number {
  return (rgba & 0xff) / 255;
}

function svgFillAttrs(rgba: number, fillOpacity: boolean): string {
  if (fillOpacity) {
    const opacity = rgbaToOpacity(rgba);
    return opacity === 1
      ? `fill="${rgbaToRgb(rgba)}"`
      : `fill="${rgbaToRgb(rgba)}" fill-opacity="${opacity}"`;
  }
  return `fill="${rgbaToHex(rgba)}"`;
}

/* ─── Pixel helpers ──────────────────────────────────────────── */

function normalizePixels(
  data: Buffer | Uint8Array | Uint8ClampedArray | number[],
): Uint8Array {
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/* ─── Rect → Polygon conversion ─────────────────────────────── */

export function rectsToPolygons(rects: Rect[]): Point[][] {
  return rects.map(({ x, y, w, h }) => [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ]);
}

/* ─── Decomposition: parsers ─────────────────────────────────── */

function parseFlatRects(buf: Int32Array): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i + 4 <= buf.length; i += 4) {
    rects.push({ x: buf[i]!, y: buf[i + 1]!, w: buf[i + 2]!, h: buf[i + 3]! });
  }
  return rects;
}

function parseFlatPolygons(buf: Int32Array): Point[][] {
  const polygons: Point[][] = [];
  let pos = 0;
  while (pos < buf.length) {
    const pc = buf[pos]!;
    pos++;
    const polygon: Point[] = [];
    for (let i = 0; i < pc; i++) {
      polygon.push([buf[pos + i * 2]!, buf[pos + i * 2 + 1]!]);
    }
    pos += pc * 2;
    polygons.push(polygon);
  }
  return polygons;
}

/* ─── Decomposition: layered (overlapping) ───────────────────── */

export async function decomposeLayered(
  image: JimpImageCompat,
): Promise<RectLayer[]> {
  const wasm = await getModule();
  const pixels = normalizePixels(image.bitmap.data);
  const results = wasm.processImage(
    pixels,
    image.width,
    image.height,
    navigator.hardwareConcurrency,
  );
  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm layered_decompose failed: ${results}`);
  }
  const layers: RectLayer[] = [];
  for (const entry of results) {
    const rects = parseFlatRects(entry.rects);
    layers.push({
      color: entry.color,
      rects,
      polygons: rectsToPolygons(rects),
    });
  }
  return layers;
}

/* ─── Decomposition: flat (non-overlapping rects) ────────────── */

export async function decomposeFlat(
  image: JimpImageCompat,
): Promise<RectLayer[]> {
  const wasm = await getModule();
  const pixels = normalizePixels(image.bitmap.data);
  const results = wasm.processImageFlat(pixels, image.width, image.height);
  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm flat_decompose failed: ${results}`);
  }
  const layers: RectLayer[] = [];
  for (const entry of results) {
    const rects = parseFlatRects(entry.rects);
    layers.push({
      color: entry.color,
      rects,
      polygons: rectsToPolygons(rects),
    });
  }
  return layers;
}

/* ─── Decomposition: outline (non-overlapping polygons) ──────── */

export async function decomposeOutline(
  image: JimpImageCompat,
): Promise<PolygonLayer[]> {
  const wasm = await getModule();
  const pixels = normalizePixels(image.bitmap.data);
  const results = wasm.processImageOutline(pixels, image.width, image.height);
  if (typeof results === "number" && results < 0) {
    throw new Error(`wasm outline_decompose failed: ${results}`);
  }
  const layers: PolygonLayer[] = [];
  for (const entry of results) {
    layers.push({
      color: entry.color,
      polygons: parseFlatPolygons(entry.polygons),
    });
  }
  return layers;
}

/* ─── Renderers ──────────────────────────────────────────────── */

function svgHeader(width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${width}" height="${height}"` +
    ` viewBox="0 0 ${width} ${height}">`
  );
}

export type SVGOptions = {
  fillOpacity?: boolean;
};

function generateSVGPathDataFromPolygons(polygons: Point[][]): string {
  return polygons
    .map((polygon) => {
      if (polygon.length === 0) return "";
      let d = `M${polygon[0]![0]},${polygon[0]![1]}`;
      for (let i = 1; i < polygon.length; i++) {
        const [x, y] = polygon[i]!;
        const [px, py] = polygon[i - 1]!;
        if (x === px) {
          d += `v${y - py}`;
        } else {
          d += `h${x - px}`;
        }
      }
      d += "z";
      return d;
    })
    .join("");
}

export function renderAsSVGPolygon(
  layers: PolygonLayer[],
  width: number,
  height: number,
  options: SVGOptions = {},
): string {
  const { fillOpacity = true } = options;
  let svg = svgHeader(width, height);
  for (const { color, polygons } of layers) {
    if (polygons.length === 0) continue;
    const d = generateSVGPathDataFromPolygons(polygons);
    svg += `<path ${svgFillAttrs(color, fillOpacity)} d="${d}"/>`;
  }
  svg += "</svg>";
  return svg;
}

export function renderAsSVGPath(
  layers: RectLayer[],
  width: number,
  height: number,
  options: SVGOptions = {},
): string {
  const { fillOpacity = true } = options;
  let svg = svgHeader(width, height);
  for (const { color, rects } of layers) {
    if (rects.length === 0) continue;
    let d = "";
    for (const { x, y, w, h } of rects) {
      d += `M${x},${y}h${w}v${h}h${-w}z`;
    }
    svg += `<path ${svgFillAttrs(color, fillOpacity)} d="${d}"/>`;
  }
  svg += "</svg>";
  return svg;
}

export function renderAsSVGRect(
  layers: RectLayer[],
  width: number,
  height: number,
  options: SVGOptions = {},
): string {
  const { fillOpacity = true } = options;
  let svg = svgHeader(width, height);
  for (const { color, rects } of layers) {
    if (rects.length === 0) continue;
    const fill = svgFillAttrs(color, fillOpacity);
    for (const { x, y, w, h } of rects) {
      svg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${fill}/>`;
    }
  }
  svg += "</svg>";
  return svg;
}

export type CSSBackgroundOptions = {
  selector?: string;
  material?: "linear-gradient" | "svg";
};

export function renderAsCSSBackground(
  layers: RectLayer[],
  width: number,
  height: number,
  options: CSSBackgroundOptions = {},
): string {
  const { selector = ".image", material = "linear-gradient" } = options;
  const bgs: string[] = [];

  for (let i = layers.length - 1; i >= 0; i--) {
    const { color, rects } = layers[i]!;
    if (rects.length === 0) continue;
    const hex = rgbaToHex(color);
    for (const { x, y, w, h } of rects) {
      if (material === "svg") {
        const encoded = hex.replace(/#/g, "%23");
        bgs.push(
          `url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='1' height='1'><rect fill='${encoded}' width='1' height='1'/></svg>") ${x}px ${y}px / ${w}px ${h}px no-repeat`,
        );
      } else {
        bgs.push(
          `linear-gradient(${hex},${hex}) ${x}px ${y}px / ${w}px ${h}px no-repeat`,
        );
      }
    }
  }

  return `${selector} {\n  width: ${width}px;\n  height: ${height}px;\n  background:\n    ${bgs.join(",\n    ")};\n}\n`;
}
