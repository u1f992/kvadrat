#!/usr/bin/env node

import fs from "node:fs";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";
import { toSVG, toRectSVG } from "./index.js";
import { VERSION } from "./version.js";

const { input, output, mode, version, help } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
    mode: { type: "string", short: "m", default: "polygon" },
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
  -o, --output <file>
  -m, --mode <mode>     polygon (default) or rectangle
  -v, --version         output the version number
  -h, --help            display help for command`,
  );
  process.exit(0);
}

if (mode !== "polygon" && mode !== "rectangle") {
  console.error(`Unknown mode: ${mode}`);
  process.exit(1);
}

const image = await Jimp.read(fs.readFileSync(input ?? process.stdin.fd));
const svg = mode === "rectangle" ? await toRectSVG(image) : await toSVG(image);

if (output) {
  fs.writeFileSync(output, svg, { encoding: "utf-8" });
} else {
  process.stdout.write(svg);
}
