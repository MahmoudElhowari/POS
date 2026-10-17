# 0002: Print queue design (Milestone 1)

Date: 2026-10-17

- **The queue is a Postgres table (`print_jobs`)**, not Redis or another service. That leaves one less thing to install and keep alive in the store, and jobs survive power cuts with the rest of the data.
- **The printer service owns the worker.** It claims jobs with `FOR UPDATE SKIP LOCKED`, is woken instantly by `NOTIFY print_jobs`, and polls every 2 s as a safety net.
- **Retry with backoff** of 2 s, 4 s, 8 s … capped at 60 s. After 20 attempts the job is marked `failed`, kept, and can be retried from the screen. Jobs are never deleted.
- **On start-up, jobs stuck in `printing` go back to the queue.** If power is lost right after the printer printed, the ticket prints twice. We accept duplicates over lost kitchen tickets.
- **A send counts as success** once every byte is flushed to the printer's socket. Raw port 9100 gives no print confirmation, so paper-out after the bytes are accepted is not detected (an ESC/POS status query is possible later).
- **The schema and migrations live in `packages/db`**, shared by api and printer. Both run migrations on start under a Postgres advisory lock, so the store PC needs no manual step after an update.
- **The whole ticket is one raster image** (Cairo font, @napi-rs/canvas), sent in bands of `RECEIPT_PRINTER_BAND_ROWS` rows. Number runs inside Arabic lines are wrapped in Unicode isolates so dates are not reversed.
