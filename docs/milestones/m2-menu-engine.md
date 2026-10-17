# Milestone 2: Menu engine

Status: **approved 2026-10-17 and built** on branch `milestone-2-menu-engine`.

The menu comes from `Romantica a1.pdf`, which has 13 classics, 18 specialties, 4 calzones, 7 sides, 2 salads, 4 pizza add-ons and 2 drinks. The menu has no prices, so they come from `romantica-price-sheet.xlsx` once Mahmoud fills it in.

## Done means

1. The whole Romantica menu is in the database in Arabic and English, with Regular and Large prices in whole SYP.
2. A pure, fully tested pricing function prices any pizza line, including half-and-half, add-ons and removed ingredients.
3. An admin can sign in with a PIN on an Arabic RTL screen and do the following:
   - edit names, descriptions, sizes and prices;
   - mark items, sizes or add-ons out of stock;
   - reorder items;
   - apply a bulk price change by % with a preview, rounded to whole pounds.
4. `GET /menu` returns the available menu, ready for the order screen in Milestone 3.
5. `pnpm check` and CI pass, including an end-to-end test of the admin changing a price.

## Pricing rules (agreed 2026-10-17)

| Case | Rule | Example (made-up prices) |
| --- | --- | --- |
| Pizza, one size | Price of that size | Margherita Large = 60,000 |
| Half-and-half | Two menu pizzas (classics or specialties, not calzones). Price of the more expensive half, in the chosen size | ½ Margherita L (60,000) + ½ Sultan L (85,000) = **85,000** |
| Stuffed crust | Up to **two stuffings** per pizza (cheese, hot dog, sujuq), each at its per-size price | Large + cheese (8,000) + sujuq (10,000) = 78,000 |
| Specialty with a built-in crust | Sultan (sujuq), Friends (cheese + sujuq), Caesar's (cheese + sujuq) and Milano (hot dog) include their stuffing in the price and can't be changed. Double Cheese can still be added | Friends L = Friends L price |
| Double Cheese | Per-size price, whole pizza | Large + Double Cheese = 60,000 + its price |
| Removing an ingredient ("no onion") | Free; printed on the kitchen ticket | Chico without onion = Chico price |
| Topping on one half *(future)* | 50% of that topping's size price | Kept in the engine for when single toppings are sold |
| Extra of a topping *(future)* | 2× the topping price | Double Cheese is the only "extra" on today's menu |
| Bulk change | `round(price × (1 + %), whole pound)` | +7% on 60,000 = 64,200 |
| Past orders | Never repriced. Order lines store their price at the time of sale | — |

All money is integer cents. Prices are entered and shown in whole pounds. **There is no USD anywhere in the system** (decided 2026-10-17).

## Steps

### 1. Schema (packages/db)
Every table below has `tenant_id`.
- **`menu_categories`** stores the key, the Arabic and English names, the sort order and a `kind` (`pizza | calzone | other`).
- **`menu_items`** stores:
  - the category, the Arabic and English names and descriptions;
  - the sort order and an `available` flag;
  - `half_and_half` (true for pizzas);
  - `removable_ingredients` (Arabic and English pairs);
  - `included_addons` (for example Friends comes with cheese and sujuq stuffing);
  - a `type` of `single | combo`. Combo is reserved and not built, so combos can be added later without a schema rewrite.
- **`item_sizes`** stores the item, the size key (`regular | large | one | can | 1l | …`), the Arabic and English names, `price_cents` and `available`.
- **`addons`** and **`addon_prices`** hold per-size prices for the stuffed crusts and double cheese, and say which categories each add-on applies to. Crust stuffings form a group with a maximum of 2.
- **`price_changes`** and **`price_history`** record every price edit and bulk change: who, when, the % and the old and new price. Prices are only changed through this path.
- **`settings`** holds per-tenant key/value pairs, for later use.
- **`staff`** holds the name, role (`admin | manager | cashier`) and `pin_hash` (scrypt). **`sessions`** holds hashed tokens with an expiry.

### 2. Pricing engine (`packages/shared/pricing.ts`)
- Write `priceLine({ item, size, otherHalf?, addons, removals, qty })`, which returns the unit price, the line total and a breakdown for the receipt.
- Write `bulkChange(prices, percent)` with whole-pound rounding.
- Add worked-example tests for every row of the table above, plus edge cases:
  - a half-and-half across categories;
  - a size missing on one half;
  - quantity × add-ons;
  - a 0% change;
  - a negative % change;
  - rounding at .5.

### 3. Menu import
- `pnpm menu:import <menu.json> <price-sheet.xlsx>` loads the categories, items, sizes and add-ons, together with the prices from the sheet.
- It is idempotent: re-running it updates the menu in place and logs a price change for each price that moved.
- A seed with fake prices is used for development and tests until the real sheet comes back.

### 4. Admin PIN login
- On first start, the system creates an admin from `ADMIN_INITIAL_PIN` in `.env`.
- `POST /auth/pin` returns a session token.
- After 5 wrong PINs, login locks for 1 minute.
- The admin screen auto-locks after 10 minutes without activity.
- Menu-editing routes require the `admin` role. Cashier and manager logins come in Milestone 3.

### 5. Menu API (apps/api)
- `GET /menu` returns available categories, items, sizes and add-ons, with prices. It is public on the store network, because the order screen needs it.
- `/admin/menu/*` provides CRUD for items, sizes and add-ons, the availability toggles and sort order.
- `POST /admin/prices/bulk/preview` and `/apply` handle the bulk change. Apply runs in one transaction and writes history.

### 6. Admin screen (apps/web, Arabic RTL)
- **PIN pad:** large keys, made for touch.
- **Menu:** categories down the side and items as cards. Each card shows the Arabic name, the small English name, the prices per size and an out-of-stock switch.
- **Item editor:** Arabic and English names and descriptions, sizes and prices (whole pounds), removable ingredients and the built-in crust stuffing.
- **Add-ons:** an editor for add-ons and their prices.
- **Bulk price change:** enter a %, review a before/after table of every price, then confirm.

### 7. Tests
- Unit tests: pricing and bulk change.
- API integration tests against Postgres:
  - tenant isolation;
  - an admin-only route rejected without a PIN session;
  - history written on every price change.
- Playwright end-to-end: sign in with the PIN, change Margherita Large, check that `/menu` shows the new price, then run a +10% preview.

## Not in Milestone 2

These are not part of this milestone: order entry and the order screen (Milestone 3), cashier logins (Milestone 3), receipts with English names (Milestone 4), combos (the model is ready but nothing is built), and selling single toppings.

## How the build differs from the plan

- **The menu has 46 items**, not 48: 13 classics, 18 specialties, 4 calzones, 7 sides, 2 salads and 2 drinks.
- **Prices are merged into `db/seed/romantica-menu.json`** instead of being read from the spreadsheet at import time. They were transcribed from the old printed menu. `pnpm --filter @pos/api menu:import <file.json>` re-imports a file of the same shape.
- **The API seeds the menu on first start** when the menu is empty (`MENU_SEED_FILE`, default `db/seed/romantica-menu.json`), so the store PC needs no manual step.
- **Unpriced sizes are hidden** from `GET /menu` until an admin sets a price. On 2026-10-17 these were still unpriced: Margherita, Margherita Sauté, Four Seasons, Romantica, Pepperoni, Salami, Mortadella, Hot Dog, Smoked Turkey and Meat Lovers, plus the Double Cheese, Hot Dog and Sujuq crust add-ons.
- **No `settings` table yet.** Its only planned use was the USD rate, which was dropped. It will be added when a real setting needs it.
- **Reordering items** is stored (`sort`) and editable through the API, but the admin screen has no drag-to-reorder yet.
