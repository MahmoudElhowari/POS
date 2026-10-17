import { type Bitmap, bytesPerRow } from "./bitmap.js";

// Pure ESC/POS byte builders: bytes in, bytes out, no I/O.

const ESC = 0x1b;
const GS = 0x1d;

export function init(): Buffer {
  return Buffer.from([ESC, 0x40]);
}

export function feed(lines: number): Buffer {
  return Buffer.from([ESC, 0x64, clampByte(lines)]);
}

/** Feed to the cutter and partial cut. */
export function cut(): Buffer {
  return Buffer.from([GS, 0x56, 66, 0]);
}

/**
 * GS v 0 raster image, split into bands so printers with small buffers
 * (common on low-cost models) still accept it.
 */
export function raster(bitmap: Bitmap, bandRows = 255): Buffer {
  const rowBytes = bytesPerRow(bitmap.width);
  if (!Number.isInteger(rowBytes)) throw new RangeError("Bitmap width must be a multiple of 8");
  if (bitmap.data.length !== rowBytes * bitmap.height) throw new RangeError("Bitmap data size mismatch");

  const parts: Buffer[] = [];
  for (let y = 0; y < bitmap.height; y += bandRows) {
    const rows = Math.min(bandRows, bitmap.height - y);
    parts.push(
      Buffer.from([GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, rows & 0xff, rows >> 8]),
      Buffer.from(bitmap.data.subarray(y * rowBytes, (y + rows) * rowBytes)),
    );
  }
  return Buffer.concat(parts);
}

/** A whole job: initialize, image, feed, cut. */
export function imageJob(bitmap: Bitmap, bandRows?: number): Buffer {
  return Buffer.concat([init(), raster(bitmap, bandRows), feed(4), cut()]);
}

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.trunc(n)));
}
