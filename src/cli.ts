#!/usr/bin/env node

import fs from "node:fs";
import { parseArgs } from "node:util";
import { Jimp } from "jimp";
import { toSVG } from "./index.js";
import { VERSION } from "./version.js";

const { input, output, version, help } = parseArgs({
  options: {
    input: { type: "string", short: "i" },
    output: { type: "string", short: "o" },
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
  -v, --version         output the version number
  -h, --help            display help for command`,
  );
  process.exit(0);
}

const svg = await toSVG(
  await Jimp.read(fs.readFileSync(input ?? process.stdin.fd)),
);
if (output) {
  fs.writeFileSync(output, svg, {
    encoding: "utf-8",
  });
} else {
  process.stdout.write(svg);
}
