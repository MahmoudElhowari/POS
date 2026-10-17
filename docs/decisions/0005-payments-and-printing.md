# 0005: Payments and printing (Milestone 4)

Date: 2026-10-17

- **Money is events, never edits.** Discounts, delivery fees, payments, voids and refunds are rows in `order_events` (rule 3). Cash payments also get a `payments` row with the amount given and the change. What an order owes is worked out from its events by `orderTotals` in `@pos/shared`, never stored, so it cannot drift.
- **Tax is inside the price** (Mahmoud: 5%, shown, never added). Included tax = total × rate / (100% + rate), rounded half up to whole pounds. The rate and its name are settings, and each order keeps the rate it was sent with.
- **Settings live in a per-restaurant `settings` table** (one JSON value per key, each with a default), edited by the admin under **الإعدادات**.
- **Discounts need a manager or admin PIN**, checked on the server, and the approver is recorded on the event. Voids and refunds need only a reason, as Mahmoud asked, and the cashier is recorded.
- **Rows are locked while money changes** (`select … for update`), so two tablets paying the same order take turns and an order can't be overpaid.
- **Two printers, two queues.** Every job names its printer (`receipt` or `kitchen`), and the printer service runs one worker per printer. The kitchen ticket is queued in the same transaction as the send, and the receipt in the same transaction as the payment that settles the order.
- **Tickets carry everything they print.** The job payload holds the names, prices and totals, so a reprint shows the order as it was. The printer service draws them as images (rule 6).
- **Both printers are fake for now** (Mahmoud). `.env.example` points at two fake printer containers in Compose's `dev` profile, which save PNGs to `printer-output/receipt/` and `printer-output/kitchen/`.
