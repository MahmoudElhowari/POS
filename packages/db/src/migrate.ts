import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import type { Db } from "./client.js";

const migrationsFolder = fileURLToPath(new URL("../../../db/migrations", import.meta.url));
// Any fixed number; both api and printer may start at once after a power cut.
const MIGRATION_LOCK = 7_200_001;

/** Applies pending migrations. Safe to call from several services at once. */
export async function runMigrations(pool: pg.Pool, db: Db) {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK]);
    await migrate(db, { migrationsFolder });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
