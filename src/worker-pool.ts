import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { ColorHex } from "./color-hex.js";
import { WorkerPerf } from "./worker.js";

const WORKER_PATH = path.join(import.meta.dirname, "worker.js");
const POOL_SIZE = os.cpus().length;

type TaskResult = { svg: string; perf: WorkerPerf };

type PendingTask = {
  hex: ColorHex;
  edges: Int32Array;
  edgeCount: number;
  returnPerf: boolean;
  resolve: (result: TaskResult) => void;
  reject: (err: unknown) => void;
};

let workers: Worker[] = [];
let idle: Worker[] = [];
const queue: PendingTask[] = [];

function ensurePool() {
  if (workers.length > 0) return;
  for (let i = 0; i < POOL_SIZE; i++) {
    const w = new Worker(WORKER_PATH);
    w.unref();
    workers.push(w);
    idle.push(w);
  }
}

function dispatch() {
  while (idle.length > 0 && queue.length > 0) {
    const worker = idle.pop()!;
    const task = queue.shift()!;

    const onMessage = (result: TaskResult) => {
      worker.removeListener("error", onError);
      task.resolve(result);
      idle.push(worker);
      dispatch();
    };
    const onError = (err: unknown) => {
      worker.removeListener("message", onMessage);
      task.reject(err);
      // Replace dead worker
      const idx = workers.indexOf(worker);
      const replacement = new Worker(WORKER_PATH);
      replacement.unref();
      workers[idx] = replacement;
      idle.push(replacement);
      dispatch();
    };

    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.postMessage(
      {
        hex: task.hex,
        edges: task.edges,
        edgeCount: task.edgeCount,
        returnPerf: task.returnPerf,
      },
      [task.edges.buffer],
    );
  }
}

export function submitTask(
  hex: ColorHex,
  edges: Int32Array,
  edgeCount: number,
  returnPerf: boolean,
): Promise<TaskResult> {
  ensurePool();
  return new Promise((resolve, reject) => {
    queue.push({ hex, edges, edgeCount, returnPerf, resolve, reject });
    dispatch();
  });
}

export function destroyPool() {
  for (const w of workers) w.terminate();
  workers = [];
  idle = [];
  queue.length = 0;
}
