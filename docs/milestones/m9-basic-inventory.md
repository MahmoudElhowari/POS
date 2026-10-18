# Milestone 9: Basic inventory

Status: **built**. Approved on 2026-10-18 ("lets go with the defaults for now"), with no stock warnings for now.

This is the third Phase 2 milestone, after the delivery board (Milestone 7) and wallets and coupons (Milestone 8, merged on 2026-10-18).

The goal is to know what is in the store, what came in, and what was thrown away. It should not slow down the order screen (rule 8) or need the internet (rule 7). **No low-stock warnings in this milestone** (Mahmoud, 2026-10-18: set them up later).

## Done means

1. **Stock items.** The admin keeps a list of what the restaurant buys, under a new **القائمة › المخزون** tab. Examples are flour, mozzarella, pepperoni, cola cans, water bottles and pizza boxes. Each stock item has:
   - an Arabic name;
   - a unit: kg, litre or piece;
   - an on/off switch.
2. **Deliveries in.** A manager records what arrived: the stock item, the quantity, and optionally the price paid and the supplier's name. The stock goes up.
3. **Counts.** A manager types what is actually on the shelf. The system saves the difference from what it expected, and the count becomes the new level.
4. **Waste.** A manager records what was thrown away or spoiled, with a reason. The stock goes down.
5. **Sales use stock automatically** for ready-made goods linked to a menu item: selling a can of cola takes one can off, and each pickup or delivery pizza or calzone takes one box off, by size. Voiding the order puts it back. Ingredients are tracked by deliveries, counts and waste only.
6. **History.** Every change is a new row: delivery, count, waste, sale or void. Nothing is edited in place, so the level is always worked out from the history (rule 3, as with orders). Every change shows who made it and when (rule 11).
7. **Report.** One screen shows each stock item with:
   - the current level;
   - what came in, was used and was wasted today and this week;
   - the last count's difference.
8. `pnpm check`, CI and the end-to-end tests pass. A test records a delivery, sells linked items, records waste and a count, and checks the levels.

## Steps

### 1. Database (new migration)
- `stock_items`, holding the name, unit and on/off switch, with `tenant_id`.
- `stock_moves`, holding the kind (delivery, count, waste, sale or void), the quantity, the cost, the note, the staff member, the order (for sales) and the time. Rows are only ever added.
- Quantities are stored as whole **grams, millilitres or pieces**, so there are no floats (as with money in cents). The screen shows kg and litres.
- A link from a menu item and size to a stock item and quantity (question 1).

### 2. Maths (`@pos/shared`)
- Work out the level from the moves.
- Turn a sold order into stock moves.
- Add up the report.

### 3. API
- Routes for the admin (`/admin/stock-items`) and for managers (`/inventory/...` for deliveries, counts, waste and the report).
- Stock is taken off in the same transaction that sends an order, and put back when it is voided.

### 4. Screens
- An **المخزون** tab for the admin, to add and edit stock items and their links to the menu.
- An **المخزون** section for managers, to record deliveries, counts and waste, and to see the report.
- All text is Arabic RTL through i18next. Buttons are solid red with white text and no hover effects.

### 5. Tests
- Unit tests for the level maths and sale moves.
- API tests against Postgres, including tenant isolation.
- One Playwright test covering the whole flow.

## Not in Milestone 9

- Purchase orders, or sending orders to suppliers.
- A supplier list with contacts and balances.
- Profit per pizza, or food-cost percentages. These belong to the reports dashboard (Milestone 10).
- Several stores or warehouses.

## Answers (Mahmoud, 2026-10-18: "lets go with the defaults for now")

1. **Recipes:** no. Only ready-made goods (cans, bottles, boxes) come off automatically for now.
2. **Boxes:** yes. Each pickup or delivery pizza or calzone takes one box, by size.
3. **At zero, and warnings:** no warnings at all for now. Nothing hides and nothing warns.
4. **Prices paid:** optional on each delivery.
5. **Who:** the admin sets up stock items. Managers and admins record deliveries, counts and waste. Cashiers don't.
6. **Starting list:** the drinks and boxes from the menu. Mahmoud adds the rest in the app.

## Questions asked

1. **Pizzas and recipes:** should sales take ingredients off automatically, which means typing a recipe for every pizza and size (for example, Sultan Large uses 180 g of mozzarella)? Or should only ready-made goods (cans, bottles, boxes) come off automatically, with ingredients tracked by deliveries, counts and waste? *Default: ready-made goods only for now. Recipes can come later without redoing anything.*
2. **Pizza boxes:** should each pizza and calzone sold for pickup or delivery take one box off, by size? *Default: yes, small box for Regular and big box for Large.*
3. **At zero:** when a ready-made item like cola reaches zero, should it hide from the order screen automatically, like 86? Or should it only warn? *Default: warn only. Counts can be off, and a cashier holding a can should still be able to sell it.*
4. **Prices paid:** should a delivery record the price paid, so the stock has a value? *Default: optional. The cost is kept for the reports dashboard later.*
5. **Who does what:** the admin sets up stock items, and managers record deliveries, counts and waste. Should cashiers be allowed to record deliveries too? *Default: no, managers and admins only.*
6. **Starting point:** can you send the list of what you buy, with units? *Default: I start the list with the drinks and boxes from the menu, and you add the rest in the inventory tab.*

## How the build differs from the plan

- **Setup lives on the inventory page, not under القائمة.** Everyone who handles stock opens **المخزون** in the top bar. The admin sees two extra things there: a form to add a stock item, and a setup section inside each item (on/off switch and links to the menu). Managers see the levels and record deliveries, counts and waste. Cashiers don't see the tab.
- **A link can point at every pizza or every calzone**, not only one menu item, so a new pizza on the menu uses a box with no extra setup. Each link can be limited to one size and to pickup and delivery only.
- **The starter list is made when the API starts**, only for a restaurant with no stock items yet. It has one item per drink and size (for example "كولا · علبة") linked to the menu, plus "علبة بيتزا وسط" (Regular pizzas and every calzone, takeaway only) and "علبة بيتزا كبير" (Large pizzas, takeaway only). Every level starts at 0, so a first count sets the real numbers.
- **Levels can go below zero.** A sale is never refused for stock, since the count may be off. A negative level is a sign a delivery or count is missing.
- **"This week" is the last 7 days**, and "today" is since the business day opened.
- **Removing a link deletes it** (it is setup, not history, and it is audited). Stock moves themselves are never edited or deleted.
