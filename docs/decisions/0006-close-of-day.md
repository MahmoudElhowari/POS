# 0006: Close of day (Milestone 5)

Date: 2026-10-17

- **A business day is a row, not a date.** `business_days` holds one open day per restaurant (a partial unique index enforces it). Orders take the open day's date, so a night that runs past midnight stays one day until the Z. Order numbers restart at 1 with each new day.
- **Every order event says which day it counts on** (`order_events.day_id`). Sales count on the day the order was sent; payments, refunds and voids count on the day they happen. Older events with no day are placed by time.
- **The 4 AM fallback is lazy.** `ensureOpen` runs inside every order and money transaction under an advisory lock. If the open day is older than the store date, it is closed as "automatic" at the cutoff hour, with no count, and a new day opens. No timer or cron is needed, which keeps the API simple and power-safe (rule 7).
- **A Z is frozen.** `day_closes` is insert-only and stores the whole report as JSON, plus the note count, expected, counted and difference. History and reprints read the frozen copy, so later fixes to report maths never change an old Z.
- **Report maths lives in `@pos/shared`** (`dayReport`) and reuses `orderTotals`, so the report, today's orders and the receipts always agree. Items sold are counted in halves, so half-and-half pizzas count ½ for each side.
- **Unpaid orders at close** (Mahmoud): deliveries carry over; every other unpaid order must be paid, voided or marked `left_unpaid` (an order event with who decided) before the Z will run.
- **One `audit_log` table** records non-order actions (float set, day closed, staff added or changed, settings changed). The audit screen merges it with order events and price changes. PINs are never written to it, only that a PIN changed.
- **Reports print on the receipt printer through the queue** (rules 4 and 6), as `x_report` and `z_report` jobs.
- **Note values and the cutoff hour are settings** (`day.notesPounds`, `day.autoCloseHour`), not code (rule 9).
