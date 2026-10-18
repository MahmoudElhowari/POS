# 0010: Reports dashboard (Milestone 10)

Date: 2026-10-18

- **Worked out from the order history, with no new tables.** The dashboard reads orders, events and stock moves for the period, so it can never disagree with them. For a single day it counts exactly like the Z: sales on the day an order was sent, voided orders left out; payments, refunds and voids on the day they happened. If long periods get slow on the store PC, a daily summary table can be added later.
- **Managers and admins only**, like the X and Z (Mahmoud, 2026-10-18). It is read-only.
- **Weeks start on Sunday** (Mahmoud, 2026-10-18). Periods are business days, so sales after midnight count in the day before.
- **Each number is compared with the previous period of the same length.** No comparison with last year for now.
- **No labour % and no RestaurantOps export** (Mahmoud, 2026-10-18). Labour % needs a time clock, which isn't built. A plain CSV export (days and items) opens in Excel with Arabic intact.
- **Item sales are line prices before order discounts**, and a half-and-half gives half its price (in whole pounds) and half a unit to each side.
- **Stock bought** is the total of delivery costs typed in inventory over the period. There is no food-cost % yet, since inventory has no recipes.
- **Charts are plain boxes drawn by the app**, not a chart library, so they follow the right-to-left layout and work offline.
