import { createDb, runMigrations } from "@pos/db";
import { createApp, type PrinterStatus } from "./app.js";
import { createPrintStore } from "./prints.js";

const port = Number(process.env.API_PORT ?? 3000);
const tenantId = process.env.TENANT_ID ?? "romantica";
const printerServiceUrl = process.env.PRINTER_SERVICE_URL ?? "http://localhost:3100";

const { pool, db } = createDb(process.env.DATABASE_URL);

for (;;) {
  try {
    await runMigrations(pool, db);
    break;
  } catch (err) {
    console.log(`waiting for database: ${(err as Error).message}`);
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

async function printerStatus(): Promise<PrinterStatus> {
  try {
    const res = await fetch(`${printerServiceUrl}/status`, { signal: AbortSignal.timeout(3_000) });
    return (await res.json()) as PrinterStatus;
  } catch {
    return { host: null, port: null, online: false };
  }
}

const app = createApp({
  checkDatabase: async () => {
    await pool.query("select 1");
    return true;
  },
  prints: createPrintStore(db, tenantId),
  printerStatus,
});

app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
