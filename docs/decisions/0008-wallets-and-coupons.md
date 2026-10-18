# 0008: Mobile wallets and coupons (Milestone 8)

Date: 2026-10-18

- **Wallet payments are recorded by hand** (Mahmoud: "defaults"). The cashier picks the wallet and types the transfer reference from the customer's phone. Nothing talks to a wallet company, so payments still work offline (rule 7).
- **The wallet list is a setting** (rule 9), with a fixed key per wallet and a name the admin can change. Each payment stores the wallet's name at the time, so a rename never rewrites past orders.
- **A wallet payment gives no change** and cannot be more than what is due. Cash and wallets can split one bill. `orderTotals` already adds up any number of payments, so the balance needed no change.
- **Only cash is in the drawer.** The X and Z split payments by method, and the expected cash counts cash payments and cash refunds only. Older frozen reports count every refund as cash, as they did then.
- **A refund goes back the way the order was paid**: one refund event for the cash and one for each wallet. The wallet part is sent back by hand from the restaurant's phone.
- **A driver whose customer paid by wallet** has nothing to hand in for that order, but still keeps the fee, so the drawer pays it.
- **A coupon is a `discount` event naming the coupon** (rule 3). Its uses are counted from those events: orders whose latest discount is the coupon, not counting voided ones. Nothing is updated in place. The day lock that every money action already takes makes two tablets take turns over a coupon's last use.
- **A coupon needs no manager PIN** (the admin approved it when making it), and only the admin makes them. One discount per order: a coupon replaces a hand-typed discount, and the other way round.
- **Coupon codes are kept in capitals**, unique per restaurant, so the cashier can type them in any case.
