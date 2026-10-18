# Milestone 7: Delivery board

Status: **approved by Mahmoud on 2026-10-18 ("tax on the food only, go ahead"); building** on branch `milestone-7-delivery-board`.

This is the first Phase 2 milestone. On 2026-10-18 Mahmoud decided to build Phase 2 before the pilot (Milestone 6) and then test everything in the store. Phase 2 is now, in this order:

1. delivery board;
2. mobile wallet payments and coupons;
3. basic inventory;
4. reports dashboard.

The kitchen screen, cash drawer, shifts and time clock are dropped for now.

## Done means

1. A new **التوصيل** (Delivery) tab shows today's delivery orders in three columns:
   - **waiting** (sent, no driver yet);
   - **out** (with a driver);
   - **delivered**.
2. Each card shows:
   - the order number and customer name;
   - the phone and address, when given;
   - the amount to collect (the total still due);
   - the driver;
   - the time since the order was sent, and since it went out.
3. The cashier picks a driver for one or more waiting orders and taps **خرج للتوصيل** (Out for delivery). One driver can take several orders in one trip.
4. When the driver comes back, the cashier marks each order **delivered**. If the driver collected cash, the order is marked **paid in cash** in the same step, using the Milestone 4 payment flow, so the receipt and the Z stay correct.
5. A **driver summary** shows, for each driver today:
   - how many orders they took;
   - the delivery fees they keep;
   - the cash they should hand in (what they collected minus their fees).
   It also lists any order still out, so nothing is forgotten at the end of the night.
6. The X and Z reports gain a **by driver** section. Delivery fees are shown as **paid to drivers**: they are not restaurant sales and are not expected in the drawer. An order still out when the Z runs counts as unpaid, and an unpaid delivery carries over to the next day as it does now.
7. Drivers are managed by the admin under **القائمة › الموظفون**. Every change is in the audit log (rule 11).
8. `pnpm check`, CI and the end-to-end tests pass. A test assigns a driver to two orders, marks them delivered and paid, and checks the driver summary and the Z.

## Steps

### 1. Drivers and delivery events (new migration)
- A **driver** is a staff member with a new role, `driver`. Drivers do not sign in to the tablet, so they need no PIN.
- Three new order event kinds:
  - `out_for_delivery` (with the driver);
  - `delivered`;
  - `returned` (for an order the driver brings back).
- These are new rows. The order itself is never changed (rule 3).

### 2. Report maths (`@pos/shared`)
- A delivery status is worked out from the events, like the order total.
- The driver summary and the by-driver section of the X and Z use the same events, so they always agree.

### 3. API
- `GET /delivery/today` returns the board.
- `POST /delivery/out` takes a driver and a list of order ids.
- `POST /delivery/orders/:id/delivered` takes an optional cash payment.
- `POST /delivery/orders/:id/returned`.
- `GET /delivery/drivers/summary`.
- The board updates live on every tablet through Socket.IO.

### 4. Screens
- The **التوصيل** tab, for every role, with large cards in Arabic RTL. Buttons are solid red with white text and no hover effects.
- The admin can add, rename and deactivate drivers in the staff list.

### 5. Tests
- Unit tests for delivery status and the driver summary.
- API tests against Postgres, including tenant isolation.
- One Playwright test covering the whole flow.

## Not in Milestone 7

- A driver app, live location or maps.
- Delivery areas with fixed fees. The fee stays typed in by hand, as in Milestone 4.
- Paying drivers or tracking their pay.

## Answers (Mahmoud, 2026-10-18)

1. **Drivers:** a list of names the cashier picks from, with no sign-in.
2. **Cash:** the driver collects the cash at the door and hands it in on return. The cashier records it as paid when marking the order delivered.
3. **Delivery fee:** it goes to the driver, not the restaurant. The driver keeps the fee from the cash collected, so the expected cash in the drawer leaves it out, and reports show fees as paid to drivers.
4. **Several orders per trip:** yes.
5. **Who uses the board:** cashiers can assign drivers and mark orders delivered.

## One follow-up from answer 3

Today the 5% tax is worked out on the whole total, delivery fee included. If the fee belongs to the driver, it is not the restaurant's sale, so the plan changes the tax to cover **the food only** (after any discount). The receipt still shows the fee and the full amount to pay. No real orders exist yet, so no past receipt changes. *Default: tax on food only.*

## How the build differs from the plan

- **Drivers are their own list**, not a staff role. They never sign in, so they have no PIN and cannot appear on the PIN screen. The admin adds them, and turns them off when they leave, under **القائمة › الموظفون**, below the staff list.
- **The fee is paid to the driver when the order is marked delivered.** The `delivered` event carries the fee, and the X and Z take it out of the expected cash on that day. A delivery order that never goes through the board (for example, paid at the counter in today's orders) keeps its fee in the drawer.
- **Delivered without cash** is allowed, for a customer who will pay later. The order stays unpaid and carries over at the Z. The driver still keeps the fee, so their "hands in" can be negative, which means the drawer pays the driver.
- **Change for the driver:** when the driver hands over more than is due, the screen shows the change to give back.
- **Tax on food only** (Mahmoud's follow-up answer). Receipts, today's orders and the reports all use it. No real orders existed, so no past receipt changes.
- **The X and Z** show the food as الصافي, delivery fees as "for the drivers", a drivers section, and "− أجرة السائقين" in the drawer. Z reports saved before this milestone still open; they simply have no drivers section.
- **Live updates:** every change to an order tells the other tablets through Socket.IO, so the delivery board and today's orders refresh at once. They also reload every 10 to 15 seconds in case a message is missed.
- **Routes:** `GET /delivery/board`, `POST /delivery/out`, `POST /delivery/orders/:id/delivered`, `POST /delivery/orders/:id/returned`, and `GET/POST/PATCH /admin/drivers`. The driver summary comes with the board.

