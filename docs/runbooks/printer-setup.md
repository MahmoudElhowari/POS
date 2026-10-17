# Receipt printer setup

How to connect a network (Ethernet) ESC/POS receipt printer to the POS. The same steps apply to the test printer in Calgary and the printer in the store.

## 1. Give the printer a fixed IP

1. Connect the printer to the wired switch and turn it on.
2. Print its self-test page. On most models, you hold the FEED button while switching the printer on. The page shows its current IP address.
3. Set a fixed IP in the same range as the store network, for example `192.168.1.50`. Use the printer's web page (open its current IP in a browser) or the maker's utility (Epson TM Utility, Star Quick Setup, or the Xprinter tool).
4. Reserve that address in the router too, so no other device takes it.

## 2. Check the POS server can reach it

From the server (the mini PC):

```sh
ping 192.168.1.50
nc -vz 192.168.1.50 9100     # should say "succeeded" / "open"
```

If `ping` works but port 9100 is closed, turn on "RAW / port 9100" printing in the printer's network settings.

## 3. Point the POS at it

In `.env` on the server:

```
RECEIPT_PRINTER_HOST=192.168.1.50
RECEIPT_PRINTER_PORT=9100
RECEIPT_PRINTER_WIDTH_DOTS=576   # 80 mm paper; use 384 for 58 mm

KITCHEN_PRINTER_HOST=192.168.1.51
KITCHEN_PRINTER_PORT=9100
```

Each printer has its own queue, so a jammed kitchen printer never holds up receipts. With only one printer, delete the `KITCHEN_PRINTER_HOST` line and kitchen tickets print on the receipt printer.

Then restart the stack: `docker compose up -d`.

## 4. Print a test ticket

Open the POS in a browser (`http://<server-ip>:8080`). The printer dot should be green. Press **«اطبع تذكرة تجريبية»** (print test ticket).

## Checks before calling it done

1. The ticket prints, and the Arabic letters are joined and read right to left.
2. Unplug the printer's network cable and press print. The screen shows «في الانتظار» (waiting) with the attempt count rising. Plug the cable back in, and the ticket prints by itself.
3. Open the paper cover in the middle of a print. The job retries and prints once the cover is closed.
4. Queue a ticket while the printer is off, then run `docker compose restart`. Turn the printer on, and the ticket still prints.

## If the ticket prints garbage or stops halfway

Some low-cost printers have small buffers. Set `RECEIPT_PRINTER_BAND_ROWS=24` in `.env` and restart.

## Working without a printer

This is how the store runs until the printers are bought. `.env.example` already has `RECEIPT_PRINTER_HOST=fake-printer` and `KITCHEN_PRINTER_HOST=fake-kitchen-printer`. Start with `docker compose --profile dev up -d`, and every ticket is saved as a PNG in `printer-output/receipt/` or `printer-output/kitchen/`.
