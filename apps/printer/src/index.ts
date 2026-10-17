import { createServer } from "node:http";
import { createDb, runMigrations } from "@pos/db";
import { PRINTERS, readPrinters } from "./config.js";
import { makePrinter } from "./jobs.js";
import { probePrinter } from "./send.js";
import { startWorker } from "./worker.js";

const port = Number(process.env.PRINTER_SERVICE_PORT ?? 3100);
const tenantId = process.env.TENANT_ID ?? "romantica";
const printers = readPrinters();
const store = {
  restaurantAr: process.env.RESTAURANT_NAME_AR ?? "رومانتيكا بيتزا",
  restaurantEn: process.env.RESTAURANT_NAME_EN ?? "Romantica Pizza",
  timeZone: process.env.TIME_ZONE ?? "Asia/Damascus",
};

const { pool, db } = createDb(process.env.DATABASE_URL);

async function migrateWhenReady() {
  for (;;) {
    try {
      await runMigrations(pool, db);
      return;
    } catch (err) {
      console.log(`waiting for database: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

await migrateWhenReady();
// One worker per printer, so a jammed kitchen printer never holds up receipts.
const workers = PRINTERS.map((name) => startWorker({ pool, tenantId, printer: name, print: makePrinter(printers[name], store) }));

const server = createServer(async (req, res) => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return json(200, { service: "printer", ok: true });
  if (req.method === "GET" && req.url === "/status") {
    const [receipt, kitchen] = await Promise.all(
      PRINTERS.map(async (name) => {
        const { host, port } = printers[name];
        return { host, port, online: await probePrinter(host, port) };
      }),
    );
    // The receipt printer stays at the top level for the printer test screen.
    return json(200, { ...receipt, kitchen });
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`printer service listening on :${port}, receipt ${printers.receipt.host}:${printers.receipt.port}, kitchen ${printers.kitchen.host}:${printers.kitchen.port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    server.close();
    await Promise.all(workers.map((w) => w.stop()));
    await pool.end();
    process.exit(0);
  });
}
