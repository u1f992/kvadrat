import { Worker } from "node:worker_threads";
import os from "node:os";
import path from "node:path";
import { ColorHex } from "./color-hex.js";
import { PERF_SYMBOL, WorkerPerf } from "./worker.js";

const WORKER_PATH = path.join(import.meta.dirname, "worker.js");
const POOL_SIZE = os.cpus().length;

export type TaskResult = { svg: string; [PERF_SYMBOL]?: WorkerPerf };

type WorkerMessage = { svg: string; perf?: WorkerPerf };

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
const inflight = new Map<Worker, PendingTask>();

function ensurePool() {
  if (workers.length > 0) return;
  try {
    for (let i = 0; i < POOL_SIZE; i++) {
      const w = new Worker(WORKER_PATH);
      w.unref();
      workers.push(w);
      idle.push(w);
    }
  } catch (err) {
    for (const w of workers) w.terminate();
    workers = [];
    idle = [];
    throw err;
  }
}

function dispatch() {
  while (idle.length > 0 && queue.length > 0) {
    const worker = idle.pop()!;
    const task = queue.shift()!;

    inflight.set(worker, task);

    const onMessage = (raw: WorkerMessage) => {
      worker.removeListener("error", onError);
      inflight.delete(worker);
      const result: TaskResult = { svg: raw.svg };
      if (raw.perf) result[PERF_SYMBOL] = raw.perf;
      task.resolve(result);
      idle.push(worker);
      dispatch();
    };
    const onError = (err: unknown) => {
      worker.removeListener("message", onMessage);
      inflight.delete(worker);
      worker.terminate();
      task.reject(err);
      const idx = workers.indexOf(worker);
      if (idx === -1) return; // Pool already destroyed
      try {
        const replacement = new Worker(WORKER_PATH);
        replacement.unref();
        workers[idx] = replacement;
        idle.push(replacement);
      } catch {
        // Remove dead slot; pool operates at reduced capacity
        workers.splice(idx, 1);
      }
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
  for (const task of queue) {
    task.reject(new Error("worker pool destroyed"));
  }
  queue.length = 0;
  for (const [worker, task] of inflight) {
    worker.removeAllListeners();
    task.reject(new Error("worker pool destroyed"));
  }
  inflight.clear();
  for (const w of workers) w.terminate();
  workers = [];
  idle = [];
}
