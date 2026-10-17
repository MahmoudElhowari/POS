---
paths: apps/printer/**
---

# Printer service rules

- Never send Arabic as printer text. Render the whole ticket (or each Arabic line) to a 1-bit bitmap with @napi-rs/canvas and the bundled Cairo font, then send it with `GS v 0` raster.
- The bitmap width equals `RECEIPT_PRINTER_WIDTH_DOTS` (576 for 80 mm, 384 for 58 mm). The height is a multiple of 8 when banding.
- Start every job with `ESC @` (initialize). End with a feed and `GS V` partial cut. The cash drawer is opened with `ESC p` (Phase 2).
- Every print goes through the job queue. A send counts as done only after the socket closes cleanly. On error, the job is retried with backoff and never dropped.
- Socket timeouts are always set (connect and write), so a powered-off printer cannot hang the service.
- Keep the ESC/POS byte builder pure (bytes in, bytes out) so it can be unit-tested without a printer.
