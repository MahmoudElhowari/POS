# Web POS — Project Plan

Oct 17, 2026 · @Mahmoud

## Summary and verdict

Yes, you can build this with Claude Code, as long as you act as the product owner and tester and keep card payments with a certified provider. Claude Code can write nearly all of the software: the order screen, menu engine, kitchen tickets, reports, and the print service. What it cannot do for you is stand at the counter on a Friday rush and find out what breaks.

**What changes for Syria:** Arabic-first, right-to-left screens and receipts; prices in the new Syrian pound; cash and mobile wallets instead of cards; a server that survives power cuts and internet outages; and remote support across a 9-hour time difference (Calgary is 9 hours behind Damascus).

The plan builds one pizza-first POS for a pizza restaurant in Syria, developed by you from Calgary, but structures the code so it can later be sold to other restaurants without a rewrite. That means every table carries a `tenant_id` (restaurant ID) from day one, menu logic is data-driven rather than hard-coded to pizza, and the printer layer is a separate service.

**Realistic effort:** an in-store MVP (take orders, print receipts and kitchen tickets, close the day) is roughly 4 to 8 weeks of steady part-time Claude Code sessions. A version you could sell to other restaurants is a further 3 to 6 months, mostly for payments, onboarding, support and reliability work. These are planning estimates, not quotes.

**What you need to bring:**

- Basic comfort with a terminal, Git and GitHub (Claude Code will do the typing; you approve and test).
- A test printer on your desk from week 1, not week 6.
- Real menu data and a list of how your staff actually take orders today.
- A trusted person on site in Syria to test each milestone, install hardware and train staff.

## Architecture decision: local-first, cloud-ready

Recommended: run V1 on a small server inside the restaurant, and write the code so the same app can later run in the cloud for other clients. In Syria this is not optional: with frequent power cuts and unreliable internet, a cloud-only POS would stop during every outage.

**Decided:** hybrid from the start. The in-store server always runs the POS and syncs to a cloud service for reports, menu management and future clients; no manual switchover.

| Option | How it works | Works offline | Easy to sell to others | Verdict |
| --- | --- | --- | --- | --- |
| Local server | Mini PC in the store runs app + database (Docker); tablets use it over Wi-Fi; Tailscale for remote access | Yes | Harder: one box per client to install and maintain | **V1 for your restaurant** |
| Cloud SaaS | App hosted online; a small print agent in each store relays jobs to printers | No | Easiest: sign up, log in | Phase 4, for selling |
| Hybrid | Local hub per store syncs to a cloud account for reports and menus | Yes | Good, but most complex | Long-term target |

This matches the earlier blueprint (React, Node.js/Express, PostgreSQL, Docker on a mini server, Tailscale). The design keeps the door open to Hybrid: a local hub that queues changes and syncs them up when online.

How the pieces connect (drawn below): order tablets and a kitchen screen talk to the local API; the API saves to PostgreSQL and sends print jobs to a print service, which talks to network printers; the cash drawer is triggered through the receipt printer.

&#91;embedded content: in-store architecture · V1\]

Tablets reach the server over staff Wi-Fi; the print service sends jobs to the printers over the wired network (TCP port 9100).

## Full scope by phase

Phase 1 is the smallest thing your staff can run a full shift on; everything else waits until that is solid.

### Phase 1 — MVP: take orders and print (in-store)

- **Arabic first:** every screen and printout right-to-left in Arabic, with English as an optional second language; menu names stored in both.

* **Staff login:** 4–6 digit PIN per employee; roles: cashier, manager, owner.
* **Menu engine:** categories, items, sizes (S/M/L/XL), crusts, toppings with per-size prices, **half-and-half toppings**, required vs optional modifiers, combos/specials, item availability toggle (86'd), bulk price change by % when the exchange rate moves.
* **Order entry:** touch-first screen; order types pickup, delivery, dine-in, phone; notes per item; hold and recall orders.
* **Customers:** look up by mobile number; save name, area, landmark-style directions (street addresses are often informal), delivery notes, order history.
* **Totals:** tax name and rate stored as settings, not code (Syria's tax rules are changing; see Payments section); discounts (%, fixed amount, coupon) and delivery fee.
* **Payments (recorded, not processed):** cash in Syrian pounds with change due, optional US-dollar cash at a manager-set rate, mobile wallet with its reference number, split payments.
* **Printing:** customer receipt, kitchen ticket (large type, modifiers grouped), reprint, auto-print on order send.
* **Voids and refunds:** manager PIN required; reason captured.
* **Close of day:** X report (mid-shift) and Z report (end of day): sales by type, tax, tenders, voids, discounts, cash expected vs counted.
* **Audit log:** who did what and when, for every money-touching action.

### Phase 2 — Run the store better

- Kitchen display screen (KDS) with order timers and bump-to-complete.
- Cash drawer open on cash sale; shift open/close with float and cash count.
- Time clock (clock in/out, breaks) with a payroll **export**, not payroll calculation; export hours to a spreadsheet for whoever runs payroll.
- Delivery board: assign drivers, out-for-delivery and delivered times.
- Basic inventory: ingredient list, recipe usage per item, low-stock alerts.
- Reports dashboard: hourly sales, item mix, labour %, and an export that feeds **RestaurantOps**.

### Phase 3 — Integrated payments and online orders

- Automatic mobile-wallet confirmation, if a wallet provider offers a merchant API; card terminals only if local card acceptance becomes practical.
- Online ordering page feeding straight into the POS queue.
- Orders from local delivery apps or WhatsApp, if the restaurant uses them.
- Loyalty/points and gift cards (optional).

### Phase 4 — Productize for other restaurants

- Multi-tenant cloud hosting, tenant sign-up and onboarding wizard (menu import, printers, taxes).
- Configurable menus beyond pizza (café, shawarma, burgers).
- Subscription billing, admin console for you, support tools (remote logs, backups, updates).
- Terms of service, privacy policy, data-retention policy, uptime commitments.

## Technical requirements and stack

Use TypeScript end to end, one repository, Docker Compose to run it; this keeps Claude Code effective because the whole system is in one place with one language.

| Layer | Choice | Why |
| --- | --- | --- |
| Front end | React + Vite, installable PWA, Tailwind | Runs on any tablet or touchscreen browser; works full-screen like an app |
| Back end | Node.js + Express (or Fastify), TypeScript | Matches earlier blueprint; same language as front end |
| Database | PostgreSQL + Drizzle or Prisma migrations | Reliable for money data; migrations tracked in Git |
| Real-time | WebSockets (Socket.IO) | New orders appear on KDS and other tablets instantly |
| Printing | Separate print service: ESC/POS over raw TCP port 9100 | Any device can print; Arabic receipts sent as images (see hardware) |
| Testing | Vitest (unit), Playwright (end-to-end) | Claude Code can run these itself to check its work |
| Deploy | Docker Compose on mini PC; Tailscale for remote access; nightly encrypted DB backup offsite | Same containers later move to the cloud |

**Arabic and right-to-left:** use an i18n library (such as i18next) with Arabic as the default, CSS logical properties so layouts flip automatically, and an Arabic font (such as Cairo or Noto Kufi Arabic) bundled with the app rather than loaded from the internet. Make Western (123) or Eastern Arabic (١٢٣) numerals a setting.

**Repository layout (monorepo):**

```
pos/
  apps/web        # React POS screens, KDS, back office
  apps/api        # REST + WebSocket API
  apps/printer    # print queue + ESC/POS drivers
  packages/shared # types, money math, tax rules, validation
  db/migrations
  docs/           # this plan, decisions, runbooks
  CLAUDE.md
```

**Non-negotiable rules for the code:**

- Money stored as integer cents, never floating point.
- Every table has `tenant_id`; every query filters by it.
- Orders are append-only: changes create events (void, refund, edit) instead of overwriting.
- Print jobs go through a queue with retry, so a jammed printer never loses a ticket.
- Order screen must respond in under 200 ms on a mid-range tablet.
- Works through a full day without internet, and recovers cleanly from sudden power loss (UPS, safe shutdown, database integrity check on start).

**Installs and updates must not depend on downloads in the store:** build the Docker images in Calgary, then load them on the mini PC over the VPN or from a USB drive.

## Printer and register hardware

Buy Ethernet (network) thermal printers that speak ESC/POS; avoid USB-only printers, because a web app can only reach USB reliably through Chrome-only browser APIs or extra drivers.

| Device | Recommended type | Notes |
| --- | --- | --- |
| Receipt printer | 80 mm thermal, Ethernet, ESC/POS (e.g. Epson TM-m30 or TM-T88 series, Star TSP100/TSP143 LAN) | Give it a fixed IP; has the cash drawer port; low-cost local brands (e.g. Xprinter) also work |
| Kitchen printer | Same, or an impact printer (e.g. Epson TM-U220) near the ovens | Thermal paper can darken near heat; impact prints on plain paper |
| Cash drawer | Standard drawer with RJ11/RJ12 cable to the receipt printer | Opened by a printer command (ESC p), so no extra driver |
| Order stations | Touchscreen tablets or an all-in-one touch PC, Chrome | Install the POS as a full-screen web app |
| Server | Small fanless mini PC (8 GB+ RAM, SSD) on a UPS, fed from the restaurant's battery/inverter or generator line | Put the router, switch and receipt printer on the UPS too |
| Network | Wired switch for printers and server; separate staff Wi-Fi | Keep POS off the guest Wi-Fi |
| Card terminal | Not needed for V1 — wallet QR code on a stand | Revisit only if card acceptance becomes common |

**Arabic on thermal printers:** most ESC/POS printers handle Arabic text poorly (letters don't join, order isn't right-to-left). The reliable method is to draw each receipt as an image on the server using a proper Arabic font, then send it as a raster bitmap. This works on any ESC/POS printer, so test one model before buying several.

**"Register later" means:** cash drawer (Phase 2); card terminals are unlikely to matter soon. Optional extras: customer-facing display and a barcode scanner, neither needed for pizza.

**Do this first:** buy one network receipt printer before writing code, so the very first milestone is a real ticket coming out of a real printer. Buy the store's hardware locally where possible so repairs and spare parts are available in Syria, and keep an identical test printer with you in Calgary for development.

## Payments, compliance and security

Syria is a cash-first market, so V1 records cash and mobile-wallet payments; the POS never handles card numbers or wallet passwords.

**Currency:** the new Syrian pound replaced the old one at 100 old = 1 new from January 1, 2026 ([source](https://www.intellinews.com/syria-rolls-out-new-currency-in-redenomination-push-418039/)). Price everything in new pounds. Because prices still follow the exchange rate, the bulk price tool matters more than usual.

**Payments:** cash in Syrian pounds; mobile wallets such as Syriatel Cash, Sham Cash and MTN Cash (show the restaurant's QR code, record the wallet reference, manager confirms at close of day); US-dollar cash only at a manager-set rate, recorded per payment. Automatic wallet confirmation comes in Phase 3, only if a provider offers a merchant API.

**Syrian requirements (confirm with a local accountant):**

- **Tax:** the consumer spending tax (Law 11 of 2015) is being replaced by a general sales tax; the Finance Ministry proposed 5% in late 2025 ([source](https://english.enabbaladi.net/archives/2025/10/syrian-finance-minister-controls-tax-rates-with-presidential-approval/)). Confirm what applies to restaurants today and store it as a setting.
- **Receipts:** restaurant name, date, items, tax and total in Arabic, plus any registration details the tax office requires.
- **Record keeping:** keep sales data and Z reports for years, backed up off-site; confirm the legal retention period locally.
- **Future changes:** currency label and tax rules can change without editing past orders.
- **Tools access from Syria:** GitHub reopened for Syrian developers in September 2025 as sanctions eased ([source](https://github.blog/company/github-is-enabling-broader-access-for-developers-in-syria-following-new-government-trade-rules/)); still test that the VPN and any cloud backup service work from the store before relying on them.

**Security baseline:**

- Staff PINs hashed; manager actions require a second PIN; auto-lock after inactivity.
- HTTPS on the local network (Tailscale or a local certificate); no POS on guest Wi-Fi.
- Secrets in environment files never committed to Git.
- Encrypted nightly backups stored off-site; restore tested monthly.
- Run a security review before Phase 3 and again before selling to anyone.

## Claude Code setup: skills, plugins, MCP, agents, hooks

Keep it lean: one main Claude Code session does most of the work, a handful of specialist subagents handle focused jobs, and a CLAUDE.md file keeps the rules in front of Claude every session. Run Claude Code in the desktop app or terminal, on a GitHub repository.

### Foundation files (create in step 0)

- **CLAUDE.md** — project rules: Arabic-first RTL UI, Syrian pound, stack, folder layout, the non-negotiable rules above (cents, tenant\_id, append-only orders), how to run tests, "never commit secrets".
- **docs/PLAN.md** — this document exported as Markdown.
- **docs/decisions/** — one short note per big decision (why Postgres, why network printers).
- **.claude/rules/** — path-specific rules, e.g. one for `apps/printer/` about ESC/POS formatting.

### Skills to activate or create

| Skill | Where it comes from | Use |
| --- | --- | --- |
| Frontend design | Anthropic's plugin marketplace (frontend-design) | Touch-first, high-contrast, right-to-left POS screens that don't look templated |
| Run and verify app / pre-commit checks | Bundled with Claude Code | Claude starts the app and runs checks before committing |
| `escpos-tickets` (custom) | You create in `.claude/skills/` | Arabic tickets drawn as raster images, 58/80 mm widths, large kitchen text, cut and drawer commands |
| `menu-modifiers` (custom) | You create | How sizes, half-and-half and modifier pricing must work, with worked examples |
| `db-migration` (custom) | You create | Steps for safe schema changes: migration, seed update, tests |
| `release` (custom) | You create | Build, tag, back up DB, deploy to mini PC, smoke test |

Ask Claude Code to draft each custom skill with the skill-creator skill once the matching code exists.

### Plugins

- **TypeScript code intelligence** — gives Claude type errors as it edits.
- **security-guidance** — checks each edit and commit for security issues.
- **claude-security** — full scan of the codebase before Phase 3 and before selling.

### MCP servers to connect

- **GitHub** — issues per milestone, pull requests, reviews.
- **PostgreSQL** — lets Claude inspect the dev database (read-only user).
- **Browser testing** — Claude in Chrome or Playwright, so Claude can click through the order screen and see bugs.

### Subagents (in `.claude/agents/`)

| Agent | Model / effort | Job | Tools |
| --- | --- | --- | --- |
| Plan (built-in) | Strong model | Turn each milestone into a step plan before coding | Read-only |
| Explore (built-in) | Fast model | Find code across the repo | Read-only |
| `db-architect` | Strong | Schema, migrations, indexes, tenant isolation | Read, edit `db/`, Postgres MCP |
| `pos-ui` | Default | React screens, touch targets, KDS | Read, edit `apps/web/` |
| `print-engineer` | Default | Print queue, ESC/POS drivers, printer status | Read, edit `apps/printer/`; preload `escpos-tickets` |
| `test-writer` | Default | Unit + Playwright tests for each feature | Read, edit tests, run tests |
| `money-reviewer` | Strong | Reviews totals, tax, discounts, refunds, Z report math | Read-only |
| `security-reviewer` | Strong | Auth, PINs, secrets, tenant leaks | Read-only |

Use plan mode before every milestone, `/code-review` before every merge, and worktrees only when two features truly run in parallel. Agent teams are optional; start without them.

### Hooks

- After each file edit: run the formatter and type-check.
- Before stopping: run the test suite; block finishing if tests fail.
- Block edits to `.env` files and to applied migrations.

## Build roadmap

Build in this order, testing each milestone in the restaurant before starting the next; each milestone is one or more plan-mode sessions in Claude Code ending in a reviewed pull request.

&#91;embedded content: build roadmap · 7 milestones, 3 later phases\]

Printing comes second on purpose: it is the riskiest hardware piece, so proving it early avoids a late surprise. Phases 2 to 4 each get their own milestone breakdown once Phase 1 is live.

## Risks, open decisions and first prompt

### Biggest risks

| Risk | Fallback |
| --- | --- |
| Staff find it slower than the current system | Time a real order on paper first; test every screen with staff before go-live |
| Bugs in totals, tax or refunds | `money-reviewer` agent + tests with known answers; reconcile Z report against old POS for 2 weeks |
| Power cut, server or printer failure mid-rush | UPS on server, router and printer; paper tickets ready; print retry queue |
| Scope creep (inventory, loyalty) delays launch | Nothing from Phase 2+ starts until Phase 1 has run a full week live |
| Selling to others brings support and liability | Decide Phase 4 only after 3 months of stable use in the first store; remote support across 9 hours needs a local helper |

### Open decisions

- [ ] Confirm a local mini PC for V1 (strongly recommended for Syria's power and internet).
- [ ] Which current POS does the restaurant use, and what must be imported (menu, customers)?
- [ ] Order stations: how many tablets, and is there a separate kitchen screen or printer only?
- [ ] Which mobile wallets the restaurant already accepts, and is US-dollar cash taken?
- [ ] Arabic only, or Arabic + English screens? Western or Eastern Arabic numerals?

### First prompt to paste into Claude Code (plan mode)

```
Read docs/PLAN.md. We are starting Milestone 0 and 1 only.
Do not write code yet. Interview me with questions about anything
unclear in the plan, then produce:
1. CLAUDE.md with the stack, folder layout and non-negotiable rules
2. The monorepo skeleton with Docker Compose (api, web, printer, postgres)
3. A step-by-step plan for Milestone 1 (print a test ticket to a
   network printer at a fixed IP over TCP 9100, including an
   Arabic line drawn as an image; all UI Arabic and right-to-left)
Wait for my approval before building.
```

## Sources

- [Syria rolls out new currency in redenomination push](https://www.intellinews.com/syria-rolls-out-new-currency-in-redenomination-push-418039/) (intellinews, Jan 2026)
- [Syrian Finance Minister Controls Tax Rates with Presidential Approval](https://english.enabbaladi.net/archives/2025/10/syrian-finance-minister-controls-tax-rates-with-presidential-approval/) (Enab Baladi, Oct 2025)
- [GitHub is enabling broader access for developers in Syria](https://github.blog/company/github-is-enabling-broader-access-for-developers-in-syria-following-new-government-trade-rules/) (GitHub blog, Sep 2025)
- [Syrian Payment Gateways for WooCommerce](https://ug.wordpress.org/plugins/syrian-payment-gateways-for-woocommerce/) (lists Syriatel Cash, Sham Cash, MTN Cash as common wallets)
