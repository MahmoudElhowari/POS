# 0007: Phase 2 before the pilot, and the delivery board (Milestone 7)

Date: 2026-10-18

- **Phase 2 before the pilot** (Mahmoud): build the Phase 2 features first and test everything in the store afterwards, to save time. This replaces the earlier rule that Phase 2 waits for a clean live week. The trade-off is that problems from real use show up later. Every milestone is still tested end to end with the fake printers.
- **Phase 2 scope** (Mahmoud): the delivery board, mobile wallets and coupons, basic inventory, and the reports dashboard, in that order. The kitchen screen, cash drawer, shifts and time clock are left out for now.
- **Drivers are a list of names, not staff.** They never sign in, so they need no PIN (Mahmoud). A separate `drivers` table keeps them off the PIN screen and out of roles.
- **Where a delivery is comes from its events** (`out_for_delivery`, `delivered`, `returned`), worked out by `deliveryStatus` in `@pos/shared`, like the balance. Orders are never changed (rule 3).
- **The delivery fee belongs to the driver** (Mahmoud). The `delivered` event carries the fee, and the X and Z take it out of the expected cash on the day it is paid out. Net sales are the food only.
- **Tax is charged on the food only** (Mahmoud, 2026-10-18), because the fee is not the restaurant's money. `orderTotals` works it out from the subtotal after the discount.
- **A cash payment the driver brings back** is recorded in the same transaction as `delivered`, through the Milestone 4 payment code, so receipts and the Z stay correct. The payment event names the driver, which gives each driver's cash for the summary.
