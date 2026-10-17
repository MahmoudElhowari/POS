import { ORDER_TYPES } from "@pos/shared";
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** An order from the order screen, held or about to be sent. */
export const orderDraft = z.object({
  type: z.enum(ORDER_TYPES),
  tableNo: z.number().int().optional(),
  customer: z.object({
    name: text(80),
    phone: optionalText(20).refine((v) => v === undefined || /^\+?[0-9 ]{4,20}$/.test(v), "bad phone"),
    area: optionalText(80),
    directions: optionalText(300),
  }),
  note: optionalText(300),
  lines: z
    .array(
      z.object({
        itemId: z.uuid(),
        sizeKey: text(20).min(1),
        otherHalfId: z.uuid().optional(),
        addons: z.array(text(40)).max(6),
        removals: z.array(text(80)).max(20),
        note: optionalText(200),
        qty: z.number().int().min(1).max(99),
      }),
    )
    .max(100),
});

export const sendRequest = z.object({
  draft: orderDraft,
  /** The held order this came from, if any; it is removed when the order is sent. */
  heldId: z.uuid().optional(),
  /** The total the cashier saw. If prices moved since, the send is refused. */
  expectedTotalCents: z.number().int().min(0),
});

export const holdRequest = z.object({
  draft: orderDraft,
  heldId: z.uuid().optional(),
});
