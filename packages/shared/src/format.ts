import type { Cents } from "./money.js";

/** "12,500 ل.س" — Western digits for now (numeral style becomes a setting later). */
export function formatSyp(amount: Cents): string {
  const whole = Math.trunc(amount / 100);
  const frac = Math.abs(amount % 100);
  const digits = whole.toLocaleString("en-US") + (frac ? `.${String(frac).padStart(2, "0")}` : "");
  return `${digits} ل.س`;
}
