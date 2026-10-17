# Milestone 1: First ticket

Status: **steps 1–9 built** (approved 2026-10-17). Steps 10–11 wait for a real printer.

## Done means

1. Pressing one button on an Arabic, right-to-left screen prints a test ticket on a network receipt printer at a fixed IP over raw TCP port 9100.
2. The ticket includes Arabic drawn as an image, with joined letters in the right order, plus English and a price in new Syrian pounds.
3. If the printer is off, unplugged or out of paper, the job waits in the queue, retries with backoff, and prints by itself once the printer is back. A restart or power cut does not lose it.
4. `pnpm check` and CI pass, including an end-to-end test against a fake printer.
5. The ticket has been printed once on a real printer in Calgary and once in the store.

## Test ticket layout (80 mm, 576 dots wide)

```
            رومانتيكا بيتزا             (large, bold, centered)
             Romantica Pizza
        ─────────────────────────
   تذكرة اختبار — أهلاً بكم في رومانتيكا بيتزا
      Test ticket — printer is working
   التاريخ: 2026-10-17   الوقت: 21:15
                 12,500 ل.س   :السعر
        ─────────────────────────
   الطابعة: 192.168.1.50:9100 · المحاولة 1
```
The whole ticket is rendered as one bitmap, then the paper is fed and cut.

## Steps

Each step ends green (`pnpm check`) and is one commit.

### 1. Print job table
- Add a Drizzle schema plus migration for `print_jobs` with these columns: `id` (uuid), `tenant_id`, `printer` (`receipt`), `kind` (`test`), `payload` (jsonb), `status` (`queued | printing | done | failed`), `attempts`, `next_attempt_at`, `last_error`, `created_at` and `printed_at`.
- Add an index on `(tenant_id, status, next_attempt_at)`.
- The API runs pending migrations on start, so the store PC needs no manual step.
- Jobs are not orders, so updating a job's status is allowed. Order history stays append-only.

### 2. ESC/POS byte builder (`apps/printer/src/escpos.ts`)
- Write pure functions that return a `Buffer`:
  - `init()` sends `ESC @`.
  - `raster(bitmap)` sends `GS v 0` in bands of at most 255 rows.
  - `feed(n)` feeds paper.
  - `cut()` sends `GS V 66 0`.
- Unit tests check exact bytes for a tiny known bitmap.

### 3. Arabic ticket renderer (`apps/printer/src/render.ts`)
- Add `@napi-rs/canvas`. Bundle `Cairo-Regular.ttf` and `Cairo-Bold.ttf` with their OFL licence in `apps/printer/assets/fonts`, and register them at start-up. No internet is needed.
- Draw the layout above with `ctx.direction = "rtl"` for Arabic lines and `"ltr"` for English lines. Skia's text shaping joins the Arabic letters.
- Convert the canvas to 1 bit per pixel with a threshold, at width `RECEIPT_PRINTER_WIDTH_DOTS`.
- Tests:
  - The width is 576 and the height is greater than 0.
  - The output is written to `printer-output/test-ticket.png` so a person can check it visually. **I will send you this PNG before moving on.**

### 4. TCP sender (`apps/printer/src/send.ts`)
- `send(host, port, bytes)` opens a socket with a 5 s connect timeout and a 15 s total timeout, then writes the bytes and closes the socket.
- A send counts as success only when the socket closes cleanly. Every other outcome throws with a clear reason (refused, timeout, unreachable).
- Tests run against a local `net.Server`: success, connection refused, and a server that hangs.

### 5. Queue worker (inside `apps/printer`)
- The worker claims the next due job with `SELECT … FOR UPDATE SKIP LOCKED`, marks it `printing`, renders it, sends it, and marks it `done`.
- On error, it increments `attempts`, sets `next_attempt_at` with backoff (2 s, 4 s, 8 s … capped at 60 s), stores `last_error`, and puts the job back to `queued`.
- After 20 attempts the job becomes `failed`. It stays visible and can be retried from the screen, and it is never deleted.
- Postgres `LISTEN/NOTIFY` wakes the worker instantly on a new job, with a 2 s poll as a safety net.
- On start-up, jobs stuck in `printing` (after a power cut) go back to `queued`.
  - Trade-off: if power is lost right after the printer printed, that ticket can print twice. A duplicate is better than a lost kitchen ticket.
- Tests (against Postgres in Docker): a job prints; a job retries while the fake printer is down and then prints; a stuck job recovers on restart.

### 6. API endpoints (`apps/api`)
- `POST /print/test` queues a test job for the tenant in `.env` and returns `{ jobId }`.
- `GET /print/jobs/:id` returns the job's status, attempts and last error.
- `POST /print/jobs/:id/retry` re-queues a `failed` job.
- `GET /printer/status` asks the printer service, which makes a short TCP connect to the printer and reports `online | offline` with the IP.
- Every query filters by `tenant_id`.

### 7. Fake printer (`tools/fake-printer`)
- A small service listens on 9100, decodes `GS v 0` raster data, and saves each job as a timestamped PNG in `printer-output/`.
- It runs in Compose under a `dev` profile (`docker compose --profile dev up`) and in CI. Development and tests work without hardware.

### 8. Test print screen (`apps/web`)
- A single Arabic RTL page shows:
  - the restaurant name;
  - the printer IP with a green or red dot for online or offline;
  - a large **«اطبع تذكرة تجريبية»** (print test ticket) button;
  - the live job status: في الانتظار (waiting) → تتم الطباعة (printing) → تمت الطباعة ✓ (printed), or فشلت (failed) with the reason and a «أعد المحاولة» (retry) button.
- All text comes from `locales/ar.json`, with English in `en.json`.
- Use logical CSS only.
- Touch targets are at least 48 px.

### 9. End-to-end test (Playwright)
- With Compose running and the fake printer in place, the test opens the page, presses the button, waits for "تمت الطباعة", and checks that a new PNG exists in `printer-output/`.
- Runs in CI.

### 10. Real printer in Calgary
- `docs/runbooks/printer-setup.md` covers:
  - giving the printer a fixed IP (from its self-test page or utility);
  - checking it with `ping` and `nc -vz <ip> 9100`;
  - setting `RECEIPT_PRINTER_HOST` in `.env`.
- Manual checks on your desk printer:
  1. The ticket prints and the Arabic looks right.
  2. Unplug the network cable, press print, then plug it back in. The ticket prints by itself.
  3. Open the paper cover mid-job. The job retries and prints after the cover is closed.
  4. Restart the containers while a job is queued. The ticket still prints.

### 11. Store test (on-site helper)
- Load the images on the store mini PC, set the store printer's IP, and press print from a store tablet.
- Repeat checks 1–2 from step 10.
- Send a photo of the ticket.

## Not in Milestone 1

These are not in this milestone: kitchen tickets, real orders, cash drawer, multiple printers, printer settings in the UI (the IP stays in `.env`), staff login, and English UI switching (the strings exist, but there is no toggle yet).

## Open points

- **No printer yet (as of 2026-10-17).** Steps 1–9 are built and tested against the fake printer. Steps 10–11 wait until a printer arrives; follow `docs/runbooks/printer-setup.md` then.
- **Changes from the plan while building:**
  - The schema lives in `packages/db`, not `apps/api`, because both services need it.
  - A send counts as success once all bytes are flushed; port 9100 gives no print confirmation.
- **Which printer to buy:** an 80 mm Ethernet ESC/POS model, ideally the same model the store will use, so the Calgary test printer matches the one in Syria. Raster output works on any ESC/POS model, but some cheap models need smaller raster bands, which I'll tune once we know the model.
