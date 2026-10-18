# 0009: Basic inventory (Milestone 9)

Date: 2026-10-18

- **Only ready-made goods come off with a sale** (Mahmoud: "defaults"). Cans, bottles and pizza boxes are linked to the menu. Ingredients are tracked by deliveries, counts and waste. Recipes can be added later as more links, without changing the stock history.
- **Quantities are whole grams, millilitres or pieces**, like money in cents (rule 1). The screen shows kg and litres and reads up to three decimals as text, never through floats.
- **Stock is a list of moves** (delivery, count, waste, sale, void) that are only ever added (rule 3). The level is their sum. A count stores the difference from the expected level, plus what was counted and expected.
- **A sale takes stock in the same transaction that sends the order**, and a void adds moves that cancel it. A sale is never refused for stock, so levels can go below zero.
- **No stock warnings and no automatic 86** for now (Mahmoud, 2026-10-18). They can be added later from the same levels.
- **Links target one menu item or a whole kind** (every pizza, every calzone), optionally one size and takeaway only. That is how one box per pickup or delivery pizza works without setting up each pizza.
- **The admin sets up stock items and links. Managers and admins record moves. Cashiers do not see inventory.** Every move stores who made it; setup changes go in the audit log (rule 11).
- **The starter list (drinks and boxes) is made once**, when the restaurant has no stock items, so the admin's later changes are never overwritten.
