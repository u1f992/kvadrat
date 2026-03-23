import { Jimp } from "jimp";
import { toRectangles } from "../dist/index.js";

const input = process.argv[2] ?? "test/input.png";
const image = await Jimp.read(input);

const t0 = performance.now();
const results = await toRectangles(image);
const dt = performance.now() - t0;
const totalRects = results.reduce((s, r) => s + r.rects.length, 0);
let totalArea = 0;
for (const { rects } of results)
  for (const { w, h } of rects) totalArea += w * h;
console.log(`Image: ${input} (${image.width}x${image.height})`);
console.log(`Colors: ${results.length}`);
console.log(`Rects: ${totalRects}`);
console.log(`Pixel coverage: ${totalArea} (expected ${image.width * image.height}, diff ${totalArea - image.width * image.height})`);
console.log(`Time: ${dt.toFixed(1)}ms`);
