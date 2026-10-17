# Milestone 3: Order entry

Status: **approved 2026-10-17 and built** on branch `milestone-3-order-entry`.

## Done means

1. A cashier signs in with their own PIN and opens a touch-first Arabic RTL order screen.
2. They build an order by tapping items. Each item can have:
   - a size;
   - half-and-half with another pizza;
   - up to two crust stuffings and Double Cheese;
   - removed ingredients ("بدون بصل");
   - a note.
   Prices come from the Milestone 2 pricing engine.
3. Each order has a type: **dine-in (tables 1–6), pickup or delivery**. A phone order is simply a pickup or delivery order. **Every order needs a customer name.** The phone number and the delivery address are optional. When a phone number is entered, a returning customer is found by it.
4. The cashier can **hold** an order and **recall** it later, and **send** it. Sending saves it for good with its prices at that moment and gives it a daily order number.
5. Orders are append-only: after sending, any change is an event row (Rule 3). Voids and edits after sending come in Milestone 4 with the manager PIN.
6. A new item or an 86 made in the admin screen shows up on the order screen without a reload.
7. Tapping an item responds in under 200 ms on a mid-range tablet (Rule 8).
8. `pnpm check`, CI and an end-to-end test of a full order (with half-and-half and a stuffing) pass.

## Steps

### 1. Staff and roles
- The admin screen gets a **Staff** tab to add a cashier or manager, set their PIN and deactivate them.
- PIN sign-in already exists from Milestone 2. Cashiers land on the order screen, admins keep the menu screen.
- The order screen locks after inactivity, and the next person signs in with their PIN.

### 2. Schema (new migration)
Every table has `tenant_id`.
- **`customers`**: name (required), mobile number (optional, unique per tenant when given), area, directions (landmarks), delivery notes.
- **`orders`**: daily number (restarts at 1 each day), type (`dine_in | pickup | delivery`), table number (1–6, dine-in only), customer name, optional customer link and phone, status (`held | sent`), staff, created and sent times.
- **`order_lines`**: the item, size, other half, add-ons and removals, note, quantity, and the **unit and line price saved at the time of sale** with the pricing breakdown.
- **`order_events`**: `created`, `held`, `recalled`, `sent`. Voids and refunds are added in Milestone 4.
- Held orders can still be edited. Once an order is sent, its lines are never updated or deleted.

### 3. Order API
- `POST /orders` creates a held order, and the endpoints that follow edit its lines while it is held.
- `POST /orders/:id/send` re-prices every line on the server with `priceLine` and rejects the send if a price changed or an item went out of stock. It then saves the order and assigns its number.
- `GET /orders?status=held` lists held orders for recall.
- `GET /customers?phone=` looks a customer up. `POST /customers` and `PATCH /customers/:id` save them.

### 4. Order screen (apps/web)
- **Layout for a tablet held landscape:**
  - category tabs along the top;
  - item buttons in a grid in the middle;
  - the order on the side, with lines, the total and the Hold / Send buttons.
- **Tapping a pizza** opens a sheet to pick:
  - the size;
  - "half and half", which shows a picker for the other pizza;
  - the stuffings;
  - the removable ingredients as toggles;
  - a note.
- Other items are added in one tap, and tapping again increases the quantity.
- **Order type buttons** at the top: داخل المطعم (dine-in), استلام (pickup), توصيل (delivery). Dine-in shows table buttons 1–6.
- **Customer box** on every order: name (required) and phone (optional). Typing a phone number suggests a saved customer. Delivery adds optional area and directions.
- An order can't be sent without a customer name, or without a table for dine-in.
- **Held orders** appear in a list. Tapping one recalls it.
- Everything is RTL with logical CSS, and every string goes through i18next.

### 5. Live menu updates
- Socket.IO (already planned in CLAUDE.md) pushes `menu.changed`, and the order screen refetches `/menu`.

### 6. Tests
- **Unit tests:** the order totals and the send-time price check.
- **API tests against Postgres:**
  - tenant isolation;
  - a sent order cannot be changed;
  - daily numbering restarts each day;
  - the price is frozen at send time.
- **Playwright:** a cashier signs in, starts a delivery order for a named customer, adds ½ Margherita + ½ Sultan Large with a cheese crust and no onion, adds a soda, holds the order, recalls it and sends it.

## Not in Milestone 3

Payment, change due, discounts, tax, the delivery fee, receipts and kitchen tickets are in **Milestone 4**. Voids and refunds with the manager PIN are also in Milestone 4. X/Z reports are in Milestone 5. The kitchen screen and the delivery board are in Phase 2.

## Answers (Mahmoud, 2026-10-17)

1. Order numbers restart at 1 every day.
2. Dine-in uses tables numbered 1–6.
3. There is no separate "phone" type. A phone order is a pickup or a delivery order, and the phone number can be entered for it.
4. Every order needs a customer name. The phone number is optional, and the address is optional even for delivery.
5. Cashiers can hold and send orders, but can't use the admin screen.
6. There is one order tablet for now, in landscape. More can be added later.

## How the build differs from the plan

- **Held orders live in their own table (`held_orders`)** as editable drafts. `orders`, `order_lines` and `order_events` are only ever inserted, when an order is sent, so sent orders stay append-only (rule 3). `order_events` has one kind (`sent`) for now; voids and refunds add more in Milestone 4.
- **Customers are saved automatically** when an order with a phone number is sent, so there are no separate customer endpoints. Typing 3 or more digits of a phone number suggests saved customers.
- **The daily number uses the store's day** in `TIME_ZONE` (default `Asia/Damascus`), so it restarts at midnight in the store, not in Calgary.
- **The whole app shares one sign-in.** Admins see the order screen and the menu admin. Cashiers and managers see only the order screen. The printer test page needs no sign-in.
- **Every add-on is listed in `GET /menu`**, including ones without a price, so a built-in crust (Sultan's sujuq) is recognised even though sujuq is not yet sold on its own.
