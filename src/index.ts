/* ─── Types ───────────────────────────────────────────────────── */

type JimpImage = {
  width: number;
  height: number;
  bitmap: { data: Buffer | Uint8Array | Uint8ClampedArray | number[] };
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Layer = {
  color: number; // RGBA packed as uint32 (R high, A low)
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

/* ─── Image → indexed pixels ─────────────────────────────────── */

function indexImage(image: JimpImage): {
  pixels: number[];
  palette: number[];
  width: number;
  height: number;
} {
  const { width, height } = image;
  const data = image.bitmap.data;
  const map = new Map<number, number>();
  const palette: number[] = [];
  const pixels: number[] = new Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    const rgba =
      ((data[off]! << 24) |
        (data[off + 1]! << 16) |
        (data[off + 2]! << 8) |
        data[off + 3]!) >>>
      0;
    let idx = map.get(rgba);
    if (idx === undefined) {
      idx = palette.length;
      map.set(rgba, idx);
      palette.push(rgba);
    }
    pixels[i] = idx;
  }

  return { pixels, palette, width, height };
}

/* ─── Layered decomposition ──────────────────────────────────── */

export function layeredDecompose(image: JimpImage): {
  layers: Layer[];
  palette: number[];
} {
  const { pixels, palette, width, height } = indexImage(image);
  const indexedLayers = layeredDecomposeIndexed(pixels, width);
  const layers: Layer[] = indexedLayers.map((l) => ({
    color: palette[l.color]!,
    rects: l.rects,
  }));
  return { layers, palette };
}

type IndexedLayer = { color: number; rects: Rect[] };

function layeredDecomposeIndexed(
  pixels: number[],
  width: number,
): IndexedLayer[] {
  const height = pixels.length / width;
  const region = new Set<number>();
  for (let i = 0; i < pixels.length; i++) region.add(i);
  return solve(pixels, width, height, region);
}

function solve(
  pixels: number[],
  width: number,
  height: number,
  initialRegion: Set<number>,
): IndexedLayer[] {
  const layers: IndexedLayer[] = [];
  const worklist: Set<number>[] = [initialRegion];

  while (worklist.length > 0) {
    const region = worklist.pop()!;
    if (region.size === 0) continue;

    const freq = new Map<number, number>();
    for (const i of region) {
      const c = pixels[i]!;
      freq.set(c, (freq.get(c) || 0) + 1);
    }

    if (freq.size === 1) {
      const color = freq.keys().next().value as number;
      layers.push({ color, rects: decomposeRegion(region, width) });
      continue;
    }

    let bg = -1;
    let bgN = 0;
    for (const [c, n] of freq) {
      if (n > bgN) {
        bg = c;
        bgN = n;
      }
    }

    layers.push({ color: bg, rects: decomposeRegion(region, width) });

    const remaining = new Set<number>();
    for (const i of region) {
      if (pixels[i] !== bg) remaining.add(i);
    }
    const comps = findComponents(remaining, width, height);

    for (let i = comps.length - 1; i >= 0; i--) {
      const sub = chooseRegion(
        comps[i]!,
        region,
        bg,
        pixels,
        width,
        height,
      );
      if (sub !== null) {
        worklist.push(sub);
      } else {
        const byColor = new Map<number, Set<number>>();
        for (const idx of comps[i]!) {
          const c = pixels[idx]!;
          if (!byColor.has(c)) byColor.set(c, new Set());
          byColor.get(c)!.add(idx);
        }
        for (const [color, pxSet] of byColor) {
          layers.push({ color, rects: decomposeRegion(pxSet, width) });
        }
      }
    }
  }

  return layers;
}

/* ─── Connected components (4-connectivity) ──────────────────── */

function findComponents(
  pixelSet: Set<number>,
  width: number,
  height: number,
): Set<number>[] {
  const visited = new Set<number>();
  const out: Set<number>[] = [];

  for (const idx of pixelSet) {
    if (visited.has(idx)) continue;
    const comp = new Set<number>();
    const stack = [idx];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur) || !pixelSet.has(cur)) continue;
      visited.add(cur);
      comp.add(cur);
      const x = cur % width;
      const y = (cur - x) / width;
      if (x > 0) stack.push(cur - 1);
      if (x < width - 1) stack.push(cur + 1);
      if (y > 0) stack.push(cur - width);
      if (y < height - 1) stack.push(cur + width);
    }
    out.push(comp);
  }
  return out;
}

/* ─── Region expansion ───────────────────────────────────────── */

function getBbox(
  region: Set<number>,
  width: number,
): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const i of region) {
    const x = i % width;
    const y = (i - x) / width;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function chooseRegion(
  comp: Set<number>,
  parentRegion: Set<number>,
  bg: number,
  pixels: number[],
  width: number,
  height: number,
): Set<number> | null {
  const { x0, y0, x1, y1 } = getBbox(comp, width);
  const bboxArea = (x1 - x0 + 1) * (y1 - y0 + 1);

  if (bboxArea < parentRegion.size) {
    let ok = true;
    for (let y = y0; y <= y1 && ok; y++) {
      for (let x = x0; x <= x1 && ok; x++) {
        const idx = y * width + x;
        if (!comp.has(idx)) {
          if (!parentRegion.has(idx) || pixels[idx] !== bg) ok = false;
        }
      }
    }
    if (ok) {
      const expanded = new Set<number>();
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) expanded.add(y * width + x);
      return expanded;
    }
  }

  const filled = outerFill(comp, width, height);
  if (filled.size < parentRegion.size) return filled;
  return null;
}

function outerFill(
  comp: Set<number>,
  width: number,
  _height: number,
): Set<number> {
  if (comp.size <= 1) return new Set(comp);

  const { x0, y0, x1, y1 } = getBbox(comp, width);
  const pw = x1 - x0 + 3;
  const ph = y1 - y0 + 3;

  const wall = new Uint8Array(pw * ph);
  for (const idx of comp) {
    const px = (idx % width) - x0 + 1;
    const py = ((idx - (idx % width)) / width) - y0 + 1;
    wall[py * pw + px] = 1;
  }

  const ext = new Uint8Array(pw * ph);
  const stack = [0];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (ext[cur] || wall[cur]) continue;
    ext[cur] = 1;
    const x = cur % pw;
    const y = (cur - x) / pw;
    if (x > 0) stack.push(cur - 1);
    if (x < pw - 1) stack.push(cur + 1);
    if (y > 0) stack.push(cur - pw);
    if (y < ph - 1) stack.push(cur + pw);
  }

  const result = new Set(comp);
  for (let py = 1; py < ph - 1; py++) {
    for (let px = 1; px < pw - 1; px++) {
      if (!ext[py * pw + px] && !wall[py * pw + px]) {
        result.add((py - 1 + y0) * width + (px - 1 + x0));
      }
    }
  }
  return result;
}

/* ─── Rectangle decomposition (greedy row-run + vertical ext) ── */

function decomposeRegion(region: Set<number>, width: number): Rect[] {
  const active = new Set(region);
  const { x0, y0, x1, y1 } = getBbox(region, width);
  const rects: Rect[] = [];

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!active.has(y * width + x)) continue;

      let w = 1;
      while (x + w <= x1 && active.has(y * width + x + w)) w++;

      let h = 1;
      extend: while (y + h <= y1) {
        for (let dx = 0; dx < w; dx++) {
          if (!active.has((y + h) * width + x + dx)) break extend;
        }
        h++;
      }

      for (let dy = 0; dy < h; dy++)
        for (let dx = 0; dx < w; dx++)
          active.delete((y + dy) * width + x + dx);

      rects.push({ x, y, w, h });
    }
  }
  return rects;
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

export function renderAsSVGPolygon(
  layers: Layer[],
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
  layers: Layer[],
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
  layers: Layer[],
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
