# 0003: Menu and pricing (Milestone 2)

Date: 2026-10-17

- **Prices live per size** in `item_sizes.price_cents` and per add-on size in `addon_prices.price_cents`. A null price means "not priced yet", and that size is hidden from the order screen.
- **One pure pricing function** (`priceLine` in `@pos/shared`) prices every line, so the order screen, the API and receipts can never disagree.
- **Half-and-half** takes two menu pizzas (not calzones) and charges the more expensive half in the chosen size.
- **Crust stuffing**: at most two per pizza, each charged at its own per-size price. Built-in stuffings (Sultan, Friends, Caesar's, Milano) are included and can't be changed; Double Cheese can still be added. Removing an ingredient is free.
- **Bulk % changes** use basis points (700 = 7%) and integer half-up rounding to whole pounds. Every price change writes `price_changes` + `price_history` rows (who, when, old, new).
- **No USD anywhere** (Mahmoud, 2026-10-17). Prices are whole new Syrian pounds, stored as cents.
- **Admin PIN**: 4–6 digits hashed with scrypt; 5 wrong PINs lock that client for 1 minute; sessions are stored as sha256 token hashes and expire after 10 minutes idle. The first admin comes from `ADMIN_INITIAL_PIN` and should be changed after setup.
- **Combos** have a `type` value reserved on `menu_items` so they can be added later without a schema rewrite.
