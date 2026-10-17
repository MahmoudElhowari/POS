import { describe, expect, it } from "vitest";
import { cut, feed, imageJob, init, raster } from "./escpos.js";

const bitmap = (width: number, height: number) => ({
  width,
  height,
  data: new Uint8Array((width / 8) * height).map((_, i) => i & 0xff),
});

describe("escpos", () => {
  it("encodes init, feed and cut", () => {
    expect([...init()]).toEqual([0x1b, 0x40]);
    expect([...feed(3)]).toEqual([0x1b, 0x64, 3]);
    expect([...cut()]).toEqual([0x1d, 0x56, 66, 0]);
  });

  it("encodes a small raster with its header", () => {
    const out = raster({ width: 16, height: 2, data: Uint8Array.from([0xff, 0x00, 0x0f, 0xf0]) });
    expect([...out]).toEqual([0x1d, 0x76, 0x30, 0, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0]);
  });

  it("splits tall images into bands", () => {
    const out = raster(bitmap(576, 600), 255);
    // 3 bands (255 + 255 + 90 rows), each with an 8-byte header.
    expect(out.length).toBe(72 * 600 + 3 * 8);
    expect(out.subarray(0, 8)).toEqual(Buffer.from([0x1d, 0x76, 0x30, 0, 72, 0, 255, 0]));
    const lastHeader = 2 * (8 + 72 * 255);
    expect(out.subarray(lastHeader, lastHeader + 8)).toEqual(Buffer.from([0x1d, 0x76, 0x30, 0, 72, 0, 90, 0]));
  });

  it("rejects widths that are not a multiple of 8", () => {
    expect(() => raster({ width: 10, height: 1, data: new Uint8Array(2) })).toThrow(RangeError);
  });

  it("wraps a job with init, feed and cut", () => {
    const job = imageJob(bitmap(8, 1));
    expect([...job.subarray(0, 2)]).toEqual([0x1b, 0x40]);
    expect([...job.subarray(-4)]).toEqual([0x1d, 0x56, 66, 0]);
  });
});
