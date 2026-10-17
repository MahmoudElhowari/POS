import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDb, runMigrations } from "@pos/db";
import { createApp, type PrinterStatus } from "./app.js";
import { createLoginLimiter } from "./auth/limiter.js";
import { PIN_PATTERN } from "./auth/pin.js";
import { createAuthStore } from "./auth/store.js";
import { createMenuStore } from "./menu/store.js";
import { menuSeed } from "./menu/types.js";
import { createPrintStore } from "./prints.js";

const port = Number(process.env.API_PORT ?? 3000);
const tenantId = process.env.TENANT_ID ?? "romantica";
const printerServiceUrl = process.env.PRINTER_SERVICE_URL ?? "http://localhost:3100";
const seedFile = process.env.MENU_SEED_FILE ?? fileURLToPath(new URL("../../../db/seed/romantica-menu.json", import.meta.url));

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

const menu = createMenuStore(db, tenantId);
const auth = createAuthStore(db, tenantId);

// First start in a new store: load the menu file and create the admin.
if (await menu.isEmpty()) {
  const { pricesChanged } = await menu.importSeed(menuSeed.parse(JSON.parse(await readFile(seedFile, "utf8"))));
  console.log(`loaded menu from ${seedFile} (${pricesChanged} prices)`);
}
const initialPin = process.env.ADMIN_INITIAL_PIN;
if (initialPin && !PIN_PATTERN.test(initialPin)) throw new Error("ADMIN_INITIAL_PIN must be 4–6 digits");
if (await auth.ensureInitialAdmin(initialPin)) console.log("created the admin from ADMIN_INITIAL_PIN");

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
  menu,
  auth,
  limiter: createLoginLimiter(),
});

app.listen(port, () => {
  console.log(`api listening on :${port}`);
});
