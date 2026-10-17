import { describe, expect, it } from "vitest";
import { decodeJob } from "./decode.js";

describe("decodeJob", () => {
  it("joins raster bands and notices the cut", () => {
    const band = (rows: number, fill: number) =>
      Buffer.concat([Buffer.from([0x1d, 0x76, 0x30, 0, 1, 0, rows, 0]), Buffer.alloc(rows, fill)]);
    const bytes = Buffer.concat([
      Buffer.from([0x1b, 0x40]),
      band(2, 0xff),
      band(1, 0x0f),
      Buffer.from([0x1b, 0x64, 4, 0x1d, 0x56, 66, 0]),
    ]);
    expect(decodeJob(bytes)).toEqual({ width: 8, height: 3, data: Uint8Array.from([0xff, 0xff, 0x0f]), cut: true });
  });
});
