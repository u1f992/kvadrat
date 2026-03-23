import { Jimp } from "jimp";
import { toSVG, PerfResult } from "./dist/index.js";

const RUNS = 10;
const INPUT = process.argv[2] ?? "test/input.png";

function median(arr: number[]) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function mean(arr: number[]) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function fmt(ms: number) {
  return ms.toFixed(1).padStart(9) + "ms";
}

async function main() {
  const image = await Jimp.read(INPUT);
  console.error(`Input: ${INPUT} (${image.width}x${image.height})`);
  console.error(`Runs: ${RUNS}\n`);

  const allPerfs: PerfResult[] = [];

  for (let i = 0; i < RUNS; i++) {
    const perf = {} as PerfResult;
    await toSVG(image, { perf });
    allPerfs.push(perf);
    console.error(
      `  Run ${(i + 1).toString().padStart(2)}: ${fmt(perf.total)}`,
    );
  }

  console.error(`\n${"=".repeat(60)}`);
  console.error(`Overall (${allPerfs[0]!.colorCount} colors)`);
  console.error(`${"=".repeat(60)}`);

  const phases = ["wasm", "render", "total"] as const;
  console.error(
    `${"Phase".padEnd(16)} ${"Mean".padStart(11)} ${"Median".padStart(11)}`,
  );
  console.error(`${"-".repeat(16)} ${"-".repeat(11)} ${"-".repeat(11)}`);
  for (const phase of phases) {
    const values = allPerfs.map((p) => p[phase]);
    console.error(
      `${phase.padEnd(16)} ${fmt(mean(values))} ${fmt(median(values))}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
