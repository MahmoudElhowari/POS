import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@pos/db";
import { createPrintStore } from "./prints.js";

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("print store (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  it("queues, reads and retries a job for its own restaurant only", async () => {
    const mine = createPrintStore(db, `t-${randomUUID()}`);
    const theirs = createPrintStore(db, `t-${randomUUID()}`);

    const id = await mine.queueTestTicket();
    expect(await mine.getJob(id)).toMatchObject({ status: "queued", attempts: 0 });
    expect(await theirs.getJob(id)).toBeNull();

    expect(await mine.retryJob(id)).toBe(false); // only failed jobs can be retried
    await pool.query(`update print_jobs set status = 'failed', attempts = 20 where id = $1`, [id]);
    expect(await theirs.retryJob(id)).toBe(false);
    expect(await mine.retryJob(id)).toBe(true);
    expect(await mine.getJob(id)).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("returns null for ids that are not uuids", async () => {
    expect(await createPrintStore(db, "t").getJob("abc")).toBeNull();
  });
});
