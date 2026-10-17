export interface DecodedJob {
  width: number;
  height: number;
  /** 1 bit per pixel, MSB first, 1 = black. */
  data: Uint8Array;
  cut: boolean;
}

/** Decodes the ESC/POS subset our printer service sends: ESC @, ESC d, GS V and GS v 0 raster. */
export function decodeJob(bytes: Buffer): DecodedJob {
  const bands: Buffer[] = [];
  let width = 0;
  let height = 0;
  let cut = false;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i]!;
    const next = bytes[i + 1];
    if (b === 0x1b && next === 0x40) i += 2;
    else if (b === 0x1b && next === 0x64) i += 3;
    else if (b === 0x1d && next === 0x56) {
      cut = true;
      i += bytes[i + 2] === 65 || bytes[i + 2] === 66 ? 4 : 3;
    } else if (b === 0x1d && next === 0x76 && bytes[i + 2] === 0x30) {
      const rowBytes = bytes[i + 4]! | (bytes[i + 5]! << 8);
      const rows = bytes[i + 6]! | (bytes[i + 7]! << 8);
      if (width && width !== rowBytes * 8) throw new Error("raster bands have different widths");
      width = rowBytes * 8;
      height += rows;
      bands.push(bytes.subarray(i + 8, i + 8 + rowBytes * rows));
      i += 8 + rowBytes * rows;
    } else i += 1;
  }
  return { width, height, data: new Uint8Array(Buffer.concat(bands)), cut };
}
