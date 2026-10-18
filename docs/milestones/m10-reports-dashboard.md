# Milestone 10: Reports dashboard

Status: **built**. Approved on 2026-10-18 (Mahmoud answered the questions below).

This is the fourth and last Phase 2 milestone, after the delivery board (M7), wallets and coupons (M8) and basic inventory (M9, merged on 2026-10-18).

The goal is to see how the restaurant is doing over days and weeks, not just today. The X and Z already cover one day and the drawer. The dashboard answers questions such as "which hours are busiest?", "what sells?" and "is this week better than last week?". It works offline (rule 7) and reads only this restaurant's data (rule 2).

## Done means

1. **A new dashboard** under **التقارير**, next to the X and Z, for the people chosen in question 3.
2. **Pick a period:** today, yesterday, this week, last week, this month, last month, or two dates. Days are business days, so an order at 1 AM counts in the day before, as on the Z.
3. **Headline numbers** for the period:
   - sales (food after discounts, without delivery fees);
   - number of orders;
   - average order;
   - discounts and coupons;
   - refunds;
   - voided orders.

   Each number shows its change from the previous period of the same length (for example, this week against last week).
4. **Breakdowns:**
   - by order type (dine-in, pickup, delivery);
   - by payment method (cash and each wallet).
5. **Sales by hour:** a bar chart of orders and sales for each hour of the day across the period, showing the busy hours.
6. **Sales by day:** a chart of each day in the period, plus an average for each day of the week (Sunday to Saturday) when the period is a week or longer.
7. **Item mix:**
   - every item and size sold, with quantity, sales and share of total sales;
   - totals for each category (pizza, calzone, drinks and so on);
   - sorted by sales, with a switch to sort by quantity.
8. **Stock bought:** the total cost of deliveries recorded in inventory over the period, and the cost for each stock item (only where a price was typed).
9. **Export:** download the period as CSV files that open in Excel with Arabic intact: one row per day, one per item. (No RestaurantOps layout.)
10. Charts are drawn by the app itself with no internet and no new chart library. All text is Arabic RTL through i18next. Buttons are solid red with white text.
11. `pnpm check`, CI and the end-to-end tests pass.

## Steps

### 1. Maths (`@pos/shared`)
- One function turns a period's orders and events into the dashboard numbers. It uses the same order totals as the X and Z, so the two always agree for a single day.
- A half-and-half pizza puts half its price and half a unit on each side (as the Z already does for quantity).
- Unit tests check that the dashboard for one closed day matches that day's Z exactly.

### 2. API
- `GET /reports/dashboard?from=…&to=…` returns the numbers above for the period and the previous period.
- `GET /reports/export?from=…&to=…&kind=…` returns a CSV file.
- No new tables and no migration. Everything is worked out from the orders, events and stock moves that already exist. If a long period is too slow on the store PC, I'll add a daily summary table in a follow-up.

### 3. Screens
- A **لوحة** tab inside **التقارير**, with the period picker, headline cards, the two charts, the breakdowns and the item table.
- Export buttons.
- It works on the landscape tablet, and the screen stays fast (rule 8) because the numbers are worked out on the server.

### 4. Tests
- Shared unit tests for the maths, including hours after midnight and half-and-half.
- API tests against Postgres, including tenant isolation and that cashiers cannot see the dashboard.
- One Playwright test that sells a few orders, opens the dashboard and checks the totals, the hour chart and the export.

## Not in Milestone 10

- **Labour %.** It needs staff hours, and you chose no time clock for now. It can be added once there is one.
- **Food-cost % or profit per pizza.** Inventory tracks no recipes, so the cost of each pizza isn't known yet.
- **Sending reports by email or WhatsApp,** or viewing them from Calgary through a cloud service. That belongs to the cloud sync later. Over Tailscale you can already open the dashboard from Calgary.
- **Forecasts or suggestions.**
- **A RestaurantOps export** (Mahmoud, 2026-10-18: not needed).
- **Comparison with the same period last year.**

## Answers (Mahmoud, 2026-10-18)

1. **Labour %:** left out.
2. **RestaurantOps:** not needed. A plain CSV export stays.
3. **Who:** managers and admins.
4. **Week start:** Sunday.
5. **Comparison:** the previous period of the same length only.
6. **Stock bought:** shown.

## Questions asked

1. **Labour %:** the original plan lists it, but it needs a time clock, which you said not to build yet. Should I leave it out? *Default: leave it out.*
2. **RestaurantOps export:** the plan says the export should feed RestaurantOps. What is it, and what does it import (CSV, Excel, a particular layout)? *Default: three CSV files that open in Excel with Arabic intact: one row per day, one per item, and one per order. I'll match the RestaurantOps layout once you send an example or its import page.*
3. **Who sees the dashboard:** managers and admins, as with the X and Z, or admins only? *Default: managers and admins.*
4. **Week start:** does the week start on Saturday? *Default: Saturday, as in most of Syria.*
5. **Comparison:** is it enough to compare with the previous period of the same length, or do you also want the same period last year? *Default: the previous period only. Last year can come once there is a year of data.*
6. **Stock bought:** should the dashboard show what was spent on deliveries (from inventory)? *Default: yes, the total and each stock item, where a price was typed.*

## How the build differs from the plan

- **The tab is called لوحة المبيعات** and opens on this week so far.
- **The hour chart starts at the cut-off hour** (the business day's start, a setting) and shows only the hours from the first sale to the last.
- **Day bars** show the weekday and date for up to 10 days, and only the date for longer periods. With no sales the charts say so instead of drawing empty bars.
- **Item sales split a half-and-half in whole pounds**: the odd pound, if any, goes to the first half.
- **Two CSV files**: days (date, orders, sales) and items (item, size, category, quantity, sales, share). Text a cell would treat as a formula is kept as plain text.
- **The longest period is one year** per request, so a single request can't read everything on the store PC.
