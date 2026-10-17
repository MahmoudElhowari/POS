import { and, eq, sql } from "drizzle-orm";
import { type Db, printJobs } from "@pos/db";

export interface PrintJobView {
  id: string;
  status: "queued" | "printing" | "done" | "failed";
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  printedAt: Date | null;
}

/** All print-job access for one restaurant; every query filters by tenant. */
export interface PrintStore {
  queueTestTicket(): Promise<string>;
  getJob(id: string): Promise<PrintJobView | null>;
  /** Re-queues a failed job; returns false if it is not failed (or not ours). */
  retryJob(id: string): Promise<boolean>;
}

const view = {
  id: printJobs.id,
  status: printJobs.status,
  attempts: printJobs.attempts,
  lastError: printJobs.lastError,
  createdAt: printJobs.createdAt,
  printedAt: printJobs.printedAt,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPrintStore(db: Db, tenantId: string): PrintStore {
  const notify = () => db.execute(sql`select pg_notify('print_jobs', ${tenantId})`);
  const mine = (id: string) => and(eq(printJobs.id, id), eq(printJobs.tenantId, tenantId));

  return {
    async queueTestTicket() {
      const [row] = await db
        .insert(printJobs)
        .values({ tenantId, printer: "receipt", kind: "test" })
        .returning({ id: printJobs.id });
      await notify();
      return row!.id;
    },

    async getJob(id) {
      if (!UUID.test(id)) return null;
      const [row] = await db.select(view).from(printJobs).where(mine(id));
      return row ?? null;
    },

    async retryJob(id) {
      if (!UUID.test(id)) return false;
      const rows = await db
        .update(printJobs)
        .set({ status: "queued", attempts: 0, nextAttemptAt: sql`now()` })
        .where(and(mine(id), eq(printJobs.status, "failed")))
        .returning({ id: printJobs.id });
      if (rows.length) await notify();
      return rows.length > 0;
    },
  };
}
