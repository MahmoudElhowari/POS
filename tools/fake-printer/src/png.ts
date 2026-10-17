import { createCanvas } from "@napi-rs/canvas";
import type { DecodedJob } from "./decode.js";

export async function toPng(job: DecodedJob): Promise<Buffer> {
  const canvas = createCanvas(Math.max(job.width, 1), Math.max(job.height, 1));
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(canvas.width, canvas.height);
  const rowBytes = job.width / 8;
  for (let y = 0; y < job.height; y++) {
    for (let x = 0; x < job.width; x++) {
      const black = (job.data[y * rowBytes + (x >> 3)]! & (0x80 >> (x & 7))) !== 0;
      const p = (y * job.width + x) * 4;
      image.data[p] = image.data[p + 1] = image.data[p + 2] = black ? 0 : 255;
      image.data[p + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas.encode("png");
}
