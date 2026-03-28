#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";
import {
  decomposeLayered,
  decomposeFlat,
  decomposeOutline,
  renderAsSVGPath,
  renderAsSVGPolygon,
  renderAsSVGRect,
  renderAsCSSBackground,
} from "./index.ts";
import { VERSION } from "./version.ts";

const {
  input,
  output,
  decompose,
  format,
  "css-selector": cssSelector,
  "css-material": cssMaterial,
  rgba,
  version,
  help,
} = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    decompose: { type: "string", short: "d", default: "layered" },
    format: { type: "string", short: "f", default: "path" },
    "css-selector": { type: "string", default: ".image" },
    "css-material": { type: "string", default: "linear-gradient" },
    rgba: { type: "boolean", default: false },
    version: { type: "boolean", short: "v" },
    help: { type: "boolean", short: "h" },
  },
}).values;

if (version) {
  console.log(VERSION);
  process.exit(0);
}
if (help) {
  console.log(
    `Usage: kvadrat [options]

Options:
  -i, --input <file>
  -o, --output <file>       output file (.svg or .css)
  -d, --decompose <mode>    layered (default), flat, or outline
  -f, --format <format>     path (default), rect, polygon, or css-background
  --css-selector <sel>      CSS selector (default: .image)
  --css-material <type>     linear-gradient (default) or svg
  --rgba                    use #RRGGBBAA instead of fill-opacity attribute
  -v, --version             output the version number
  -h, --help                display help for command

Decompose + format combinations:
  layered + path            overlapping rects as compact <path> (default)
  layered + rect            overlapping rects as <rect> elements
  layered + polygon         overlapping rects as polygon <path>
  layered + css-background  overlapping rects as CSS background
  flat + path               non-overlapping rects as compact <path>
  flat + rect               non-overlapping rects as <rect> elements
  flat + polygon            non-overlapping rects as polygon <path>
  flat + css-background     non-overlapping rects as CSS background
  outline + polygon         non-overlapping polygon outlines (format forced)`,
  );
  process.exit(0);
}

const DECOMPOSES = ["layered", "flat", "outline"] as const;
type Decompose = (typeof DECOMPOSES)[number];
if (!DECOMPOSES.includes(decompose as Decompose)) {
  console.error(`Unknown decompose mode: ${decompose}`);
  process.exit(1);
}

const FORMATS = ["path", "rect", "polygon", "css-background"] as const;
type Format = (typeof FORMATS)[number];
if (!FORMATS.includes(format as Format)) {
  console.error(`Unknown format: ${format}`);
  process.exit(1);
}

const dec = decompose as Decompose;
const fmt = dec === "outline" ? "polygon" : (format as Format);

if (fmt === "polygon" && dec !== "outline") {
  // polygon format with layered/flat uses renderAsSVGPolygon on RectLayer[]
  // which is valid since RectLayer extends PolygonLayer — allow it
}

const image = await Jimp.read(fs.readFileSync(input ?? process.stdin.fd));
const svgOptions = { fillOpacity: !rgba };

let result: string;

if (dec === "outline") {
  const layers = await decomposeOutline(image);
  result = renderAsSVGPolygon(layers, image.width, image.height, svgOptions);
} else {
  const layers =
    dec === "flat" ? await decomposeFlat(image) : await decomposeLayered(image);

  switch (fmt) {
    case "rect":
      result = renderAsSVGRect(layers, image.width, image.height, svgOptions);
      break;
    case "polygon":
      result = renderAsSVGPolygon(
        layers,
        image.width,
        image.height,
        svgOptions,
      );
      break;
    case "css-background": {
      const material = cssMaterial === "svg" ? "svg" : "linear-gradient";
      result = renderAsCSSBackground(layers, image.width, image.height, {
        selector: cssSelector,
        material,
      });
      break;
    }
    default:
      result = renderAsSVGPath(layers, image.width, image.height, svgOptions);
      break;
  }
}

if (output) {
  fs.writeFileSync(output, result, { encoding: "utf-8" });

  if (fmt === "css-background") {
    const parsed = path.parse(output);
    const htmlPath = path.join(parsed.dir, parsed.name + ".html");
    const className = (cssSelector ?? ".image").replace(/^\./, "");
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="${parsed.base}">
</head>
<body>
<div class="${className}"></div>
</body>
</html>
`;
    fs.writeFileSync(htmlPath, html, { encoding: "utf-8" });
  }
} else {
  process.stdout.write(result);
}
