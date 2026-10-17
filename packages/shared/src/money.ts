/**
 * Money is always an integer number of the smallest unit (cents of the
 * new Syrian pound). Never store or add money as a floating-point number.
 */
export type Cents = number & { readonly __brand: "Cents" };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be an integer number of cents, got ${value}`);
  }
  return value as Cents;
}

export function addCents(...values: Cents[]): Cents {
  return cents(values.reduce((sum, v) => sum + v, 0));
}
