# Milestone 4: Pay and print

Status: **approved 2026-10-17 and built** on branch `milestone-4-pay-and-print`.

## Done means

1. A **today's orders** screen lists every order sent today, newest first. Each row shows the number, the type and table, the customer, the total, and whether the order is paid or voided. Tapping an order shows its lines.
2. Sending an order **prints a kitchen ticket on the kitchen printer** automatically through the print queue, so nothing is lost if the printer is off. The ticket uses large Arabic type and groups half-and-half, crust and "بدون" (without) under each pizza.
3. The cashier **records payment**:
   - cash in Syrian pounds, with the change due.
   Payment is recorded, not processed, and there is no USD (decided 2026-10-17). It is **cash only for now**, and the design leaves room for mobile wallets and split payments later.
4. Paying **prints the customer receipt on the receipt printer** in Arabic with smaller English names (Milestone 2 decision). It shows the order number, the lines, any discount and delivery fee, the total, the payment and the change.
5. **Reprint** of the kitchen ticket or the receipt from today's orders.
6. **Discounts** (% or a fixed amount) need a manager PIN. A **delivery fee** is typed in for each delivery order, because it depends on the area. Both change the order total.
7. A cashier can **void** a whole order, or **refund** a paid one, choosing a reason. Each is a new event row; the order itself is never changed (rule 3).
8. Every money action (payment, discount, void, refund) is in the audit trail with who, what and when (rule 11).
9. `pnpm check`, CI and end-to-end tests pass. The tests check the printed kitchen ticket and receipt images from the fake printer.

## Steps

### 1. Today's orders (first, as you asked)
- `GET /orders?day=today` returns the store day's orders with their status, worked out from their events.
- The screen is a new **الطلبات اليوم** (Today's orders) tab next to the order screen, for every role.
- It has filters for all, unpaid and voided.
- Tapping an order opens it read-only, with Pay, Reprint and Void buttons.

### 2. Settings (new `settings` table, per tenant)
- **Restaurant details** for the receipt: phone, address and the footer text.
- **Tax:** the name and the rate. The rate is **5% included in the price** (tax = total × 5 / 105, rounded to whole pounds), and it can be changed later without code (rule 9).
- **Printers:** two of them, the receipt printer and the kitchen printer, each with its own IP in `.env` (`RECEIPT_PRINTER_HOST`, `KITCHEN_PRINTER_HOST`). In development and CI both point at fake printers, so the tests pass without hardware.
- All of these are edited in a new **الإعدادات** (Settings) tab in the admin screen.

### 3. Money events (new migration)
- **`order_events`** gains the kinds `discount`, `delivery_fee`, `payment`, `void` and `refund`. Each event carries the amount, the staff member, the approving manager where one is needed, the reason, and a JSON detail such as tenders and the wallet reference.
- **`payments`**: one row per tender with the method (`cash` for now; `wallet` is reserved for later), the amount given, the change and an optional reference.
- **Coupons**: a `discount_source` field (`manual` now; `coupon` reserved), so coupon codes can be added later without a schema rewrite. No coupon screen is built now.
- An order's balance is worked out from its events. It is never stored, so it can never drift.

### 4. Pricing totals (`@pos/shared`)
- `orderTotals(lines, events)` returns the subtotal, the discount, the delivery fee, the tax included in the total, the total, the amount paid and the balance.
- Rounding is to whole pounds at defined points.
- Worked-example tests cover each rule.

### 5. Kitchen ticket and receipt renderers (apps/printer)
- Print jobs name their printer (`receipt` or `kitchen`). Compose's `dev` profile runs two fake printers, which save PNGs to `printer-output/receipt/` and `printer-output/kitchen/`.
- **Kitchen ticket:** the order number very large, plus the type and table, or "توصيل" (delivery) with the area. Each line shows the quantity × the Arabic name and size, then the half, crust, "بدون …" and the note on indented lines, followed by the order note. No prices.
- **Customer receipt:** the restaurant name, the order number, date and time, and the cashier. Each line shows the Arabic name, the English name in small type, the quantity and the price. Then the subtotal, discount, delivery fee and total, a line for the 5% tax already included, and the cash given and change. The phone, address and footer are added later.
- Both are drawn as one image (rule 6) and checked as PNGs from the fake printer.

### 6. Payment screen
- A large keypad shows the amount due, with quick buttons for common notes (for example 1,000, 2,000 and 5,000 SYP).
- The cashier enters the cash given, and the screen shows the change in large type.
- **"Pay now" on send:** pay straight after sending (pickup, delivery), or leave the order unpaid and pay later from today's orders (dine-in).

### 7. Manager approval
- A discount opens a PIN pad for a manager or admin. The cashier stays signed in.
- The approving manager is recorded on the event.
- Voids and refunds need no manager. The cashier picks a reason (customer cancelled, wrong order, other with a note), and their name is recorded.

### 8. Tests
- **Unit:** totals, change, split payments, and rounding.
- **API against Postgres:** an order can't be overpaid; a voided order can't be paid; a refund needs a payment; a discount needs a manager PIN; tenant isolation.
- **Playwright:** send an order and check that a kitchen ticket PNG appears on the kitchen fake printer; pay cash with change and check that a receipt PNG appears on the receipt fake printer; void an order and check that it shows as voided.

## Not in Milestone 4

These come later: the X/Z reports and close of day (Milestone 5), and opening the cash drawer and shift float (Phase 2). Mobile wallets and split payments come later, and automatic wallet confirmation is Phase 3.

## Answers (Mahmoud, 2026-10-17)

1. **Tax:** 5% is included in the price and shown on the receipt, never added on top. The rate is a setting.
2. **Delivery fee:** it depends on the location, so it is typed in for each delivery order.
3. **Discounts:** % or a fixed amount, approved with a manager PIN. Coupon codes are not used now, but the design leaves room for them.
4. **When customers pay:** undecided, so the order can be paid when it is sent or later from today's orders.
5. **Payment methods:** cash only for now, with room for mobile wallets later.
6. **Printers:** there are two, receipt and kitchen. Both are fake printers for now, so the tests pass.
7. **Receipt phone, address and footer:** added later.
8. **Voids and refunds:** cashiers can do them, picking a reason from a short list.

## How the build differs from the plan

- **Add item.** Mahmoud asked whether he could add menu items, so the menu admin gained a **+ إضافة صنف** (Add item) button in each category. A new item has two sizes (وسط and كبير) or one size, and it opens in the item editor once added. An item with no price stays hidden from the order screen.
- **Today's orders** is `GET /orders/today` and `GET /orders/:id`. The filters are all, unpaid, paid, and voided or refunded.
- **The restaurant name stays in `.env`** (`RESTAURANT_NAME_AR`, `RESTAURANT_NAME_EN`), as in Milestone 1. Settings hold the tax and the receipt phone, address and footer.
- **The tax rate is frozen on the order when it is sent** (`orders.tax_rate_bp`), so changing the rate never changes an old receipt (rule 9).
- **Coupons:** the discount event stores `source: "manual"` in its JSON detail instead of a separate column; `coupon` is reserved.
- **Split payments** are part payments in cash: pay some now and the rest later. Each payment is its own event and `payments` row. Mixed methods wait for wallets.
- **Discounts and delivery fees** can only change before any money is taken. A new one replaces the earlier one, and the discount can't be more than the subtotal.
- **Void or refund:** an order with no payment is voided; a paid order is refunded in full. Partial refunds are not built.
- **Manager approval** is a PIN field (the tablet shows a number keyboard) and shares the sign-in lockout after wrong PINs.
- **Quick cash buttons** offer the exact amount and the amount rounded up to the next 500, 1,000 and 5,000, instead of fixed notes.
- **The payment screen opens after sending pickup and delivery orders.** Dine-in orders are paid later from today's orders.
- **Each printer has its own queue worker**, so a jammed kitchen printer never holds up receipts. Without `KITCHEN_PRINTER_HOST`, kitchen tickets print on the receipt printer.
- **`.env.example` now points at the two fake printers**, with a note to put the real IPs in when the printers arrive.
- **A reprinted receipt for an unpaid order** shows what is still due and "غير مدفوع" (not paid).
- The order entry tab is now called **طلب جديد** (New order), next to **طلبات اليوم** (Today's orders).

