import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Jimp } from "jimp";
import { toSVG } from "./index.js";

describe("toSVG regression", () => {
  test("test/input.png produces identical SVG to test/output.svg", async () => {
    const inputPath = path.join(import.meta.dirname, "..", "test", "input.png");
    const expectedPath = path.join(
      import.meta.dirname,
      "..",
      "test",
      "output.svg",
    );

    const image = await Jimp.read(inputPath);
    const actual = await toSVG(image);
    const expected = fs.readFileSync(expectedPath, "utf-8");

    assert.equal(actual, expected);
  });
});
