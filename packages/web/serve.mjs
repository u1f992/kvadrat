import { createServer } from "node:https";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const dir = join(import.meta.dirname, "dist");
const port = 3000;

const serverOptions = {
  key: await readFile(join(import.meta.dirname, "key.pem")),
  cert: await readFile(join(import.meta.dirname, "cert.pem")),
};

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
};

createServer(serverOptions, async (req, res) => {
  const url = new URL(req.url, "http://localhost").pathname;
  const filePath = url === "/" ? "/index.html" : url;
  try {
    const data = await readFile(join(dir, filePath));
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.setHeader("Content-Type", mime[extname(filePath)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, () => console.log(`https://localhost:${port}/`));
