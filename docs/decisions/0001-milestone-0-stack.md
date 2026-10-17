# 0001: Milestone 0 stack choices

Date: 2026-10-17 · Decided by: Mahmoud (accepted proposed defaults)

- **Express 5** over Fastify, to match the earlier blueprint.
- **Drizzle** over Prisma: SQL-first, no extra engine binary, and migrations are plain SQL in `db/migrations`.
- **pnpm workspaces, Node 22 LTS, Postgres 16.**
- **Run TypeScript with `tsx`** in api and printer, in dev and production, so there is no compile step to drift. Only `web` is built (by Vite).
- **80 mm receipt printer (576 dots)**, with the IP in `.env`. A 58 mm printer is a one-line change (`RECEIPT_PRINTER_WIDTH_DOTS=384`).
- **Arabic tickets are rendered server-side** with @napi-rs/canvas and the bundled Cairo font, then sent as ESC/POS raster images.
- **Western numerals** for now. The numeral style becomes a setting later.
- **No cloud sync service yet.** The skeleton has only api, web, printer and postgres. `tenant_id` is in place from the first table so hybrid sync can come later.
