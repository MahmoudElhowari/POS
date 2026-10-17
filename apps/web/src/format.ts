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

/** Reads a percent typed by staff ("5", "12.5") as basis points without floats; null when empty, NaN when invalid. */
export function parsePercentBp(text: string): number | null {
  const clean = text.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace("٫", ".");
  if (!clean) return null;
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(clean);
  if (!m) return Number.NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Basis points back to a percent for display: 550 → "5.5". */
export function percentText(bp: number) {
  const frac = bp % 100;
  return frac ? `${Math.trunc(bp / 100)}.${String(frac).padStart(2, "0").replace(/0$/, "")}` : String(bp / 100);
}

/** What a customer might hand over: the exact amount, then rounded up to the next 500, 1,000 and 5,000. */
export function cashSuggestions(duePounds: number) {
  const ups = [500, 1_000, 5_000].map((step) => Math.ceil(duePounds / step) * step);
  return [...new Set([duePounds, ...ups])].filter((p) => p >= duePounds && p > 0);
}
