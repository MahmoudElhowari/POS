# Milestone 5: Close the day

Status: **approved by Mahmoud on 2026-10-17 and built** on branch `milestone-5-close-the-day`. See "How the build differs from the plan" at the end.

Phase 1 in `docs/PLAN.md` ends with this: "X report (mid-shift) and Z report (end of day): sales by type, tax, tenders, voids, discounts, cash expected vs counted", plus an audit log of every money action.

## Done means

1. A manager can print an **X report** at any time. It shows the sales so far and closes nothing.
2. At the end of the night a manager counts the drawer, types in the cash, and runs the **Z report**. It shows what the cash should be, what was counted, and the difference (over or short). It prints on the receipt printer and closes the day.
3. After the Z, new orders belong to the **next business day**, and order numbers start again at 1. If nobody runs a Z, the day ends by itself at **4 AM**, as a safety net.
4. Every Z is kept for good, numbered in order (Z 1, Z 2 …), and can be reopened and reprinted from a **reports history**. A Z is never changed after it is made (rule 3).
5. An **audit log** screen lists every money action (payments, discounts, fees, voids, refunds, day closes) and every price, staff and settings change, with who and when (rule 11).
6. `pnpm check`, CI and the end-to-end tests pass. The tests check the printed X and Z report images from the fake receipt printer.

## What the reports show

Both reports show the same sections. The Z adds the cash count and closes the day.

- **Header:** the restaurant name, X or Z with its number, the business day, the time it was opened and printed, and who printed it.
- **Sales:**
  - the number of orders;
  - sales before discounts;
  - discounts;
  - delivery fees;
  - the net total;
  - the tax included in it (5%, shown and never added).
- **By order type:** dine-in, pickup and delivery, each with its order count and total.
- **Payments:** cash (wallets later), and refunds given back.
- **Voids:** the count and the value of what was voided. Each one is listed with its number, its reason and who did it.
- **Discounts:** the count, plus who approved each one.
- **Still unpaid:** every order not yet paid, with its number and balance. The Z splits these into delivery orders carried to tomorrow and orders the manager left unpaid.
- **Items sold:** quantity per item, so you can see what sells (half-and-half counts half for each side).
- **Cash in the drawer (Z only):**
  - the opening float, typed in by the manager;
  - plus cash taken;
  - minus cash refunds;
  - gives the expected cash;
  - then the counted cash, entered as a count of each note, and the difference.

## Steps

### 1. Business day (new migration)
- A `business_days` table: one row per day per restaurant, with its date, when it opened, and when and by whom it was closed.
- Orders take the open day's date, not the calendar date, so a night that runs past midnight stays one day until the Z.
- **Safety net at 4 AM:** if the day is still open at 4 AM (a setting), the next order starts a new day. The old day is closed automatically, marked "closed without a count" with no cash difference. A manager can still print its report later.
- Order numbers restart at 1 when a new day opens.

### 2. Day close (new migration)
- A `day_closes` table, insert-only:
  - the Z number;
  - the day;
  - the opening float, the count of each note, the counted cash, the expected cash and the difference;
  - a frozen copy of the whole report;
  - who closed it, and when.
- Running a Z is one transaction:
  1. lock the day;
  2. work out the totals from the order events;
  3. save the Z;
  4. close the day and open the next one;
  5. queue the print job.
- A second tablet pressing Z at the same moment gets "already closed".

### 3. Report maths (`@pos/shared`)
- `dayReport(orders, events)` reuses `orderTotals` from Milestone 4, so the report always matches today's orders.
- Worked-example tests cover:
  - discounts;
  - fees;
  - part payments;
  - a void;
  - a refund;
  - a half-and-half pizza in the items list;
  - the cash difference.

### 4. Screens
- A new **التقارير** (Reports) tab, for managers and the admin (question 2), containing:
  - **X report**: shows it on screen, with a Print button.
  - **Opening float**: the manager types the cash left in the drawer for change. It can be changed until the Z.
  - **Close the day**:
    1. First it lists the unpaid orders. **Unpaid delivery orders carry over** to the next day, still unpaid, and their payment counts on the day it is taken. Every other unpaid order needs the manager to pay it, void it, or mark it "left unpaid" (recorded in the Z with who decided). The Z won't run until each one is handled.
    2. Then the manager counts the drawer **note by note**. Each note value has a box for how many, plus a box for coins and anything else. The screen adds them up.
    3. Then it shows the Z with the difference in large type before it is printed.
  - **History**: every past Z, which you can open and reprint.
- An **audit log** under القائمة (admin), filterable by day and by kind.
- Arabic RTL; every string is in `ar.json` and `en.json`.

### 5. Printing
- X and Z reports are drawn as one image (rule 6) and printed on the receipt printer through the queue (rule 4).

### 6. Tests
- **API against Postgres:**
  - the Z totals match the orders;
  - a closed day takes no more payments;
  - orders after the Z go to the next day, numbered from 1;
  - a Z can't be run twice;
  - restaurants never see each other's data.
- **Playwright:** take and pay some orders, print an X, close the day with a counted amount, check the Z image on the fake printer, and check that the next order is number 1.

## Not in Milestone 5

- Opening the cash drawer, shift open/close with handovers, and paid-outs (cash taken out for supplies). These are Phase 2.
- Off-site backups and the go-live checklist come in Milestone 6 (pilot).

## Answers (Mahmoud, 2026-10-17)

1. **End of day:** run by hand with the Z when the night is done. 4 AM is the automatic fallback.
2. **Who runs reports:** managers and admins.
3. **Opening float:** typed in by hand.
4. **Unpaid orders at close:** unpaid delivery orders carry over to the next day. The manager settles the rest, voids them, or leaves them unpaid.
5. **Counting cash:** count each note.
6. **Old POS check:** yes, compare the Z with the current POS for two weeks during the pilot.

7. **Note values:** 10, 25, 50, 100, 200 and 500 pounds, plus a box for coins and anything else. The list is a setting, so it can change without code.

## How the build differs from the plan

- **The 4 AM fallback runs on the next action, not on a timer.** The first order, payment or report after 4 AM closes the old day with the close time set to 4 AM, then opens the new day. Nothing runs in the background, so a PC that was off overnight still gets it right.
- **A Z needs the day the screen was showing.** If two tablets press Z, or someone presses twice, the second one gets "already closed" instead of closing the new, empty day.
- **After a Z, payments go to the new day.** The plan said "a closed day takes no more payments"; in practice there is always an open day, so a late payment simply counts on the next one.
- **Carried deliveries** look back up to 31 days. Their sale stays on the day they were sent, and their cash counts on the day it is taken.
- **The opening float** is on the X report tab and can be changed until the Z. Each change is in the audit log.
- **The audit log is filtered by day only.** Each row shows its kind, so a kind filter can come later if the list gets long. Staff and settings changes are logged from this milestone on; price changes were already kept since Milestone 2.
- **Leaving an order unpaid** takes an optional note and is an order event, so the order history shows it too.
- **On printed reports, amounts and counts** (like −210 or 2½) are drawn left to right so the minus sign and the half sit in the right place.
- **Times on screen** use the tablet's clock. On the store tablet that is Damascus time; the printed Z always uses Damascus time.
