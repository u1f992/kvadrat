import { colorHex } from "./color-hex.js";

import test from "node:test";
import assert from "node:assert";

const testCases: [string, [number, number, number, number]][] = [
  ["#00000000", [0, 0, 0, 0]],
  ["#ff0000ff", [255, 0, 0, 255]],
  ["#00ff00ff", [0, 255, 0, 255]],
  ["#0000ffff", [0, 0, 255, 255]],
];

for (const [expected, input] of testCases) {
  test(expected, () => {
    assert.strictEqual(
      colorHex({ r: input[0], g: input[1], b: input[2], a: input[3] }),
      expected,
    );
  });
}
