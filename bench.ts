import { Jimp } from "jimp";
import { toSVGWithPerf, PerfResult } from "./dist/index.js";
import { WorkerPerf } from "./dist/worker.js";

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
    const { perf } = await toSVGWithPerf(image);
    allPerfs.push(perf);
    console.error(
      `  Run ${(i + 1).toString().padStart(2)}: ${fmt(perf.total)}`,
    );
  }

  // --- Overall summary ---
  console.error(`\n${"=".repeat(60)}`);
  console.error(
    `Overall (${allPerfs[0]!.colorCount} colors, ${allPerfs[0]!.edgeCount} edges)`,
  );
  console.error(`${"=".repeat(60)}`);

  const phases = ["buildEdges", "workers", "total"] as const;
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

  // --- Per-worker summary: aggregate across runs by hex ---
  // Collect worker-level metrics keyed by hex
  const workerMap = new Map<
    string,
    { edges: number; polygons: number; runs: WorkerPerf[] }
  >();
  for (const perf of allPerfs) {
    for (const wp of perf.workerPerfs) {
      if (!workerMap.has(wp.hex)) {
        workerMap.set(wp.hex, {
          edges: wp.edges,
          polygons: wp.polygons,
          runs: [],
        });
      }
      workerMap.get(wp.hex)!.runs.push(wp);
    }
  }

  // Sort by median total desc, show top 10
  const sorted = [...workerMap.entries()].sort((a, b) => {
    return (
      median(b[1].runs.map((r) => r.total)) -
      median(a[1].runs.map((r) => r.total))
    );
  });

  console.error(`\n${"=".repeat(90)}`);
  console.error(`Top 10 slowest colors (by median total)`);
  console.error(`${"=".repeat(90)}`);

  const workerPhases = [
    "removeEdges",
    "buildPolygons",
    "concatPolygons",
    "generateSVG",
    "total",
  ] as const;

  console.error(
    `${"Color".padEnd(12)} ${"Edges".padStart(9)} ${"Polys".padStart(7)}` +
      workerPhases.map((p) => ` ${p.padStart(15)}`).join(""),
  );
  console.error("-".repeat(90));

  for (const [hex, data] of sorted.slice(0, 10)) {
    const cols = workerPhases.map((phase) => {
      const values = data.runs.map((r) => r[phase]);
      return `${fmt(median(values))}`;
    });
    console.error(
      `${hex.padEnd(12)} ${data.edges.toString().padStart(9)} ${data.polygons.toString().padStart(7)} ${cols.join(" ")}`,
    );
  }

  console.error(`\n${"=".repeat(90)}`);
  console.error(`Top 10 slowest colors (by median total) — mean`);
  console.error(`${"=".repeat(90)}`);
  console.error(
    `${"Color".padEnd(12)} ${"Edges".padStart(9)} ${"Polys".padStart(7)}` +
      workerPhases.map((p) => ` ${p.padStart(15)}`).join(""),
  );
  console.error("-".repeat(90));

  for (const [hex, data] of sorted.slice(0, 10)) {
    const cols = workerPhases.map((phase) => {
      const values = data.runs.map((r) => r[phase]);
      return `${fmt(mean(values))}`;
    });
    console.error(
      `${hex.padEnd(12)} ${data.edges.toString().padStart(9)} ${data.polygons.toString().padStart(7)} ${cols.join(" ")}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
