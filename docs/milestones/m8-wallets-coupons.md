# Milestone 8: Mobile wallet payments and coupons

Status: **built**. Approved on 2026-10-18 ("go ahead"); answers given on 2026-10-18 ("defaults").

This is the second Phase 2 milestone, after the delivery board (Milestone 7, merged on 2026-10-18).

## Answers (Mahmoud, 2026-10-18: "defaults")

1. **Wallets:** the cashier records which wallet was used and types the transfer reference. There is no link to the wallet company, so it works offline (rule 7).
2. **Split payments:** one order can be paid partly in cash and partly by wallet.
3. **Coupons:** a code the cashier types in. Each coupon takes off a percentage or a fixed amount, and can have an end date and a use limit.
4. **Who makes coupons:** the admin only.

## Done means

### Wallet payments
1. The pay dialog has two choices, **نقداً** (cash) and **محفظة** (wallet).
2. For a wallet payment, the cashier:
   - picks the wallet from a list;
   - types the amount (it starts at the full amount due);
   - types the transfer reference the customer shows on their phone.
3. A wallet payment never gives change. It cannot be more than what is still due.
4. **Split:** the cashier can take part by wallet, then the rest in cash, or the other way round. The order is paid when the two add up to the total.
5. The receipt shows each payment, for example "سيريتل كاش 1,000" and "نقداً 500", plus the cash change.
6. **Delivery board:** when marking an order delivered, the cashier can choose "paid by wallet" for a customer who paid the driver by wallet.
7. **X and Z reports:**
   - A new **by payment method** section shows cash and each wallet, with counts and amounts.
   - The **expected cash** in the drawer counts cash only. Wallet money never goes into the drawer.
8. **Refunds:** a refund goes back the way the order was paid. The cash part comes out of the drawer. The wallet part is recorded as "returned by wallet", and the cashier sends it back by hand from the restaurant's phone. Refunds still need a manager PIN (rule 11).
9. **The wallet list is a setting** (rule 9). It starts with Syriatel Cash (سيريتل كاش), MTN Cash (MTN كاش) and Sham Cash (شام كاش). The admin can add, rename or turn off wallets under **القائمة › الإعدادات**.

### Coupons
10. The admin manages coupons under a new **القائمة › الكوبونات** tab. Each coupon has:
    - a code, such as `PIZZA10`, typed in any case;
    - a percentage off or a fixed amount off;
    - an optional end date;
    - an optional use limit (for example, the first 50 orders);
    - an on/off switch.
11. In today's orders, the discount button gets a **كوبون** (coupon) field. The cashier types the code and the screen shows the amount off at once, or why the code was refused: unknown, expired, used up or turned off.
12. **A coupon needs no manager PIN**, because the admin already approved it when making it. A hand-typed discount still needs one, as now.
13. **One discount per order.** A coupon replaces a hand-typed discount, and the other way round, as a new discount replaces the old one today.
14. The discount is taken off the food, never the delivery fee, and the tax is worked out after it, as now.
15. The receipt shows the coupon code next to the discount.
16. The X and Z show how many orders used each coupon and how much it took off.
17. Every coupon created, changed or used is in the audit log (rule 11).

### Checks
18. `pnpm check`, CI and the end-to-end tests pass. A test pays one order by wallet and cash split, applies a coupon to another, and checks the receipt and the X report.

## Steps

### 1. Database (one new migration)
- `payments.method` already allows `wallet`. Each wallet payment row gets the wallet's key and the transfer reference.
- A new `coupons` table: tenant, code (unique per restaurant), percentage or fixed amount, end date, use limit, on/off, created by.
- A coupon used on an order is a `discount` event that names the coupon. Uses are counted from those events, so nothing is updated in place (rule 3). A voided order gives its coupon use back.

### 2. Money maths (`@pos/shared`)
- The order totals already add up payments of any kind. The report splits them by method, and only cash goes into the expected drawer.
- A coupon check works out whether a code is usable on a given date and use count, and how much it takes off.

### 3. API
- `POST /orders/:id/pay` takes `method: "cash" | "wallet"`, plus the wallet and reference for a wallet payment.
- `POST /orders/:id/coupon` takes a code.
- `POST /delivery/orders/:id/delivered` takes the same payment choice.
- `GET/POST/PATCH /admin/coupons`, for the admin only.
- The wallet list is part of the settings.

### 4. Screens
- Pay dialog: cash or wallet, the wallet buttons, a reference field and a "still due" line for split payments.
- Discount dialog: the coupon field.
- Admin: the coupons tab, and the wallet list in settings.
- Reports: the by payment method and coupons sections, on screen and on the printed X and Z.
- All text is Arabic RTL through i18next. Buttons are solid red with white text and no hover effects.

### 5. Tests
- Unit tests for split payments, the coupon rules and the report's method split.
- API tests against Postgres, including tenant isolation and two tablets using a coupon's last use at the same moment.
- One Playwright test for the whole flow.

## Not in Milestone 8

- Checking a transfer with the wallet company, or a QR code to pay. Both need the internet and an agreement with each company.
- Coupons limited to some items, "buy one get one", or a minimum order. These can come later.
- Customer accounts or loyalty points.
- Tips.

## How the build differs from the plan

- **Routes:** `POST /orders/:id/pay` takes `method: "cash"` with `tenderedPounds`, or `method: "wallet"` with `wallet`, `amountPounds` and `reference`; a body with only `tenderedPounds` still means cash. `POST /delivery/orders/:id/delivered` takes `tender` the same way, or `null`. Cashiers read the wallets that are turned on from `GET /orders/wallets`.
- **The discount button** now reads **خصم أو كوبون** and opens on the coupon tab. The % and fixed tabs still need a manager PIN.
- **The receipt** lists every payment: each wallet with its transfer number, then the cash handed over and the change.
- **The X and Z** show cash, each wallet and the refunds under the payments, with a line splitting the refunds into cash and wallet when there were wallet refunds. The drawer subtracts only cash refunds. A **الكوبونات** section shows each coupon's orders and amount, and the discount list says which coupon or which manager.
- **A driver's hand-in** counts only the cash they collected. A customer who paid by wallet leaves the driver nothing to hand in, so the drawer pays their fee.
- **A wallet the admin turns off** disappears from the pay screen and is refused by the API. A renamed wallet keeps its old name on past payments.
- **Coupons:** using the same coupon again on the same order is not a second use, and a voided order gives its use back. Changing a coupon never changes orders that already used it.
