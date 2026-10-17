import { createServer } from "node:http";
import { createDb, runMigrations } from "@pos/db";
import { readPrinterConfig } from "./config.js";
import { makePrinter } from "./jobs.js";
import { probePrinter } from "./send.js";
import { startWorker } from "./worker.js";

const port = Number(process.env.PRINTER_SERVICE_PORT ?? 3100);
const tenantId = process.env.TENANT_ID ?? "romantica";
const printer = readPrinterConfig();
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
const worker = startWorker({ pool, tenantId, print: makePrinter(printer, store) });

const server = createServer(async (req, res) => {
  const json = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return json(200, { service: "printer", ok: true });
  if (req.method === "GET" && req.url === "/status") {
    const online = await probePrinter(printer.host, printer.port);
    return json(200, { host: printer.host, port: printer.port, online });
  }
  res.writeHead(404).end();
}).listen(port, () => console.log(`printer service listening on :${port}, printer ${printer.host}:${printer.port}`));

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    server.close();
    await worker.stop();
    await pool.end();
    process.exit(0);
  });
}
