#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";
import { toSVG, toRectSVG, toCSSBackground } from "./index.js";
import { VERSION } from "./version.js";

const {
  input,
  output,
  mode,
  "css-selector": cssSelector,
  rgba,
  version,
  help,
} = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    mode: { type: "string", short: "m", default: "polygon" },
    "css-selector": { type: "string", default: ".image" },
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
  -m, --mode <mode>         polygon (default), rectangle, or css-background
  --css-selector <sel>      CSS selector (default: .image)
  --rgba                    use #RRGGBBAA instead of fill-opacity attribute
  -v, --version             output the version number
  -h, --help                display help for command`,
  );
  process.exit(0);
}

const MODES = ["polygon", "rectangle", "css-background"] as const;
if (!MODES.includes(mode as (typeof MODES)[number])) {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

const image = await Jimp.read(fs.readFileSync(input ?? process.stdin.fd));

if (mode === "css-background") {
  const css = await toCSSBackground(image, cssSelector);
  if (output) {
    fs.writeFileSync(output, css, { encoding: "utf-8" });

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
  } else {
    process.stdout.write(css);
  }
} else {
  const svgOptions = { fillOpacity: !rgba };
  const svg =
    mode === "rectangle"
      ? await toRectSVG(image, svgOptions)
      : await toSVG(image, svgOptions);
  if (output) {
    fs.writeFileSync(output, svg, { encoding: "utf-8" });
  } else {
    process.stdout.write(svg);
  }
}
