import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, runMigrations } from "@pos/db";
import { backoffMs, MAX_ATTEMPTS, NOTIFY_CHANNEL } from "./queue.js";
import { startWorker } from "./worker.js";

describe("backoffMs", () => {
  it("doubles from 2 s and caps at 60 s", () => {
    expect([1, 2, 3, 5, 6, 20].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 32_000, 60_000, 60_000]);
  });
});

// Needs Postgres: set TEST_DATABASE_URL (CI and `docker compose up postgres` do).
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("print queue worker (Postgres)", () => {
  const { pool, db } = createDb(url);
  beforeAll(() => runMigrations(pool, db));
  afterAll(() => pool.end());

  async function addJob(tenantId: string, status = "queued") {
    const { rows } = await pool.query<{ id: string }>(
      `insert into print_jobs (tenant_id, printer, kind, status) values ($1, 'receipt', 'test', $2) returning id`,
      [tenantId, status],
    );
    await pool.query(`select pg_notify('${NOTIFY_CHANNEL}', $1)`, [tenantId]);
    return rows[0]!.id;
  }

  async function waitForStatus(id: string, status: string, timeoutMs = 5_000) {
    const start = Date.now();
    for (;;) {
      const { rows } = await pool.query(`select status, attempts, last_error from print_jobs where id = $1`, [id]);
      if (rows[0]?.status === status) return rows[0];
      if (Date.now() - start > timeoutMs) throw new Error(`job stayed ${rows[0]?.status}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const quiet = () => {};

  it("prints a queued job", async () => {
    const tenantId = `t-${randomUUID()}`;
    const printed: string[] = [];
    const worker = startWorker({ pool, tenantId, pollMs: 100, log: quiet, print: async (job) => void printed.push(job.id) });
    const id = await addJob(tenantId);
    await waitForStatus(id, "done");
    await worker.stop();
    expect(printed).toEqual([id]);
  });

  it("retries while the printer is down, then prints", async () => {
    const tenantId = `t-${randomUUID()}`;
    let calls = 0;
    const worker = startWorker({
      pool, tenantId, pollMs: 50, backoff: () => 0, log: quiet,
      print: async () => {
        if (++calls < 3) throw new Error("printer refused the connection");
      },
    });
    const id = await addJob(tenantId);
    const row = await waitForStatus(id, "done");
    await worker.stop();
    expect(row.attempts).toBe(3);
  });

  it("re-queues a job interrupted by a power cut", async () => {
    const tenantId = `t-${randomUUID()}`;
    const id = await addJob(tenantId, "printing");
    const worker = startWorker({ pool, tenantId, pollMs: 100, log: quiet, print: async () => {} });
    await waitForStatus(id, "done");
    await worker.stop();
  });

  it(`marks a job failed after ${MAX_ATTEMPTS} attempts but keeps it`, async () => {
    const tenantId = `t-${randomUUID()}`;
    const worker = startWorker({
      pool, tenantId, pollMs: 20, backoff: () => 0, log: quiet,
      print: async () => {
        throw new Error("paper out");
      },
    });
    const id = await addJob(tenantId);
    const row = await waitForStatus(id, "failed", 10_000);
    await worker.stop();
    expect(row).toMatchObject({ attempts: MAX_ATTEMPTS, last_error: "paper out" });
  });

  it("never touches another restaurant's jobs", async () => {
    const other = await addJob(`t-${randomUUID()}`);
    const worker = startWorker({ pool, tenantId: `t-${randomUUID()}`, pollMs: 50, log: quiet, print: async () => {} });
    await new Promise((r) => setTimeout(r, 300));
    await worker.stop();
    await waitForStatus(other, "queued", 100);
  });
});
