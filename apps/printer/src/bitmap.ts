/** 1 bit per pixel, rows packed MSB first, 1 = black dot. Width is a multiple of 8. */
export interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export function bytesPerRow(width: number) {
  return width / 8;
}
