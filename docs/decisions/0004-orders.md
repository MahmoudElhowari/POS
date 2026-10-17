# 0004: Orders (Milestone 3)

Date: 2026-10-17

- **Held orders are drafts, sent orders are history.** A held order is one editable row in `held_orders`. Sending writes `orders`, `order_lines` and a `sent` row in `order_events` in one transaction and deletes the held row. Nothing in `orders` or `order_lines` is ever updated or deleted.
- **The server re-prices every order at send time** with the same `priceDraft` code the order screen uses. If the total differs from what the cashier saw, the send is refused with the new total, so a price change mid-order is never charged silently.
- **Names and prices are frozen on each line** (Arabic and English item, size and add-on names, unit and line price), so receipts and reports never change when the menu does.
- **Order numbers restart at 1 each store day** (`TIME_ZONE`). A Postgres advisory lock per restaurant makes two tablets sending at once get different numbers, and a unique index backs it up.
- **Order types are dine-in (tables 1–6), pickup and delivery** (Mahmoud, 2026-10-17). A phone order is a pickup or delivery order. Every order needs a customer name; phone and address are optional.
- **Staff PINs are unique** among active staff, because sign-in finds the person by PIN alone. The last active admin cannot be removed or demoted.
- **Live menu updates use Socket.IO**, proxied by nginx at `/api/socket.io`. Any successful admin menu change emits `menu.changed`, and order screens reload `GET /menu`.
