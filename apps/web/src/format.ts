/** Whole Syrian pounds with Western digits: 1,800 */
export function pounds(priceCents: number) {
  return Math.round(priceCents / 100).toLocaleString("en-US");
}

/** Reads a whole-pound price typed by staff; null when empty, NaN when invalid. */
export function parsePounds(text: string): number | null {
  const clean = text.replace(/[,\s]/g, "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  if (!clean) return null;
  return /^\d+$/.test(clean) ? Number(clean) : Number.NaN;
}
