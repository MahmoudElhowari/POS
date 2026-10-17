import { describe, expect, it } from "vitest";
import { type DraftLine, headerProblems, type OrderDraft, priceDraft, type SellableMenu } from "./order.js";

const syp = (pounds: number) => pounds * 100;

const menu: SellableMenu = {
  categories: [
    {
      kind: "pizza",
      items: [
        {
          id: "margherita",
          halfAndHalf: true,
          removable: [{ ar: "صوص", en: "Sauce" }],
          includedAddons: [],
          sizes: [
            { sizeKey: "regular", priceCents: syp(900) },
            { sizeKey: "large", priceCents: syp(1800) },
          ],
        },
        {
          id: "sultan",
          halfAndHalf: true,
          removable: [{ ar: "بصل", en: "Onion" }],
          includedAddons: ["sujuq"],
          sizes: [
            { sizeKey: "regular", priceCents: syp(1100) },
            { sizeKey: "large", priceCents: syp(2200) },
          ],
        },
      ],
    },
    {
      kind: "other",
      items: [{ id: "soda", halfAndHalf: false, removable: [], includedAddons: [], sizes: [{ sizeKey: "can", priceCents: syp(150) }] }],
    },
  ],
  addons: [
    { key: "cheese", group: "crust_stuffing", prices: { regular: syp(200), large: syp(400) } },
    { key: "sujuq", group: "crust_stuffing", prices: { regular: syp(250), large: syp(500) } },
  ],
};

const line = (l: Partial<DraftLine> & Pick<DraftLine, "itemId" | "sizeKey">): DraftLine => ({ addons: [], removals: [], qty: 1, ...l });
const draft = (d: Partial<OrderDraft> = {}): OrderDraft => ({
  type: "pickup",
  customer: { name: "أبو أحمد" },
  lines: [line({ itemId: "soda", sizeKey: "can" })],
  ...d,
});

describe("headerProblems", () => {
  it("accepts a pickup order with a name only", () => {
    expect(headerProblems(draft())).toEqual([]);
  });

  it("needs a customer name on every order", () => {
    expect(headerProblems(draft({ customer: { name: "  " } }))).toEqual([{ code: "no_customer_name" }]);
  });

  it("needs a table from 1 to 6 for dine-in", () => {
    expect(headerProblems(draft({ type: "dine_in" }))).toEqual([{ code: "no_table" }]);
    expect(headerProblems(draft({ type: "dine_in", tableNo: 7 }))).toEqual([{ code: "bad_table" }]);
    expect(headerProblems(draft({ type: "dine_in", tableNo: 6 }))).toEqual([]);
  });

  it("does not need a phone or address for delivery", () => {
    expect(headerProblems(draft({ type: "delivery" }))).toEqual([]);
  });

  it("refuses an empty order", () => {
    expect(headerProblems(draft({ lines: [] }))).toEqual([{ code: "no_lines" }]);
  });
});

describe("priceDraft", () => {
  it("adds up the lines", () => {
    const { priced } = priceDraft(
      draft({
        lines: [
          line({ itemId: "margherita", sizeKey: "large", otherHalfId: "sultan", removals: ["بصل"] }),
          line({ itemId: "soda", sizeKey: "can", qty: 2 }),
        ],
      }),
      menu,
    );
    // ½ Margherita + ½ Sultan Large = Sultan Large (2200), plus 2 × soda (150).
    expect(priced?.lines.map((l) => l.totalCents)).toEqual([syp(2200), syp(300)]);
    expect(priced?.totalCents).toBe(syp(2500));
  });

  it("charges stuffings on a plain pizza", () => {
    const { priced } = priceDraft(draft({ lines: [line({ itemId: "margherita", sizeKey: "large", addons: ["cheese"] })] }), menu);
    expect(priced?.totalCents).toBe(syp(2200));
  });

  it("reports an item that is no longer sold", () => {
    const { priced, problems } = priceDraft(draft({ lines: [line({ itemId: "gone", sizeKey: "large" })] }), menu);
    expect(priced).toBeNull();
    expect(problems).toEqual([{ code: "item_unavailable", line: 0 }]);
  });

  it("reports a removal the item does not have", () => {
    const { problems } = priceDraft(draft({ lines: [line({ itemId: "margherita", sizeKey: "large", removals: ["بصل"] })] }), menu);
    expect(problems).toEqual([{ code: "bad_removal", line: 0 }]);
  });

  it("reports pricing errors per line", () => {
    const { problems } = priceDraft(
      draft({ lines: [line({ itemId: "soda", sizeKey: "can" }), line({ itemId: "sultan", sizeKey: "large", addons: ["cheese"] })] }),
      menu,
    );
    expect(problems).toEqual([{ code: "pricing", line: 1, detail: expect.stringContaining("crust_built_in") }]);
  });
});
