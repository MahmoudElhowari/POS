import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string | undefined) {
  const pool = new pg.Pool({ connectionString });
  return { pool, db: drizzle(pool, { schema }) };
}

export type Db = ReturnType<typeof createDb>["db"];
