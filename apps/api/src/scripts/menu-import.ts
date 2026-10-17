// Usage: pnpm --filter @pos/api menu:import [file.json]
// Loads a menu file into the database for TENANT_ID. Safe to re-run: it
// updates items in place and logs every price that moved.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDb, runMigrations } from "@pos/db";
import { createMenuStore } from "../menu/store.js";
import { menuSeed } from "../menu/types.js";

const file = process.argv[2] ?? fileURLToPath(new URL("../../../../db/seed/romantica-menu.json", import.meta.url));
const tenantId = process.env.TENANT_ID ?? "romantica";
const { pool, db } = createDb(process.env.DATABASE_URL);
await runMigrations(pool, db);
const seed = menuSeed.parse(JSON.parse(await readFile(file, "utf8")));
const { pricesChanged } = await createMenuStore(db, tenantId).importSeed(seed);
console.log(`imported ${file}: ${seed.categories.length} categories, ${pricesChanged} price changes`);
await pool.end();
