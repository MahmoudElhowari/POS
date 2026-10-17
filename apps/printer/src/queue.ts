import type pg from "pg";
import type { PrintJob } from "@pos/db";

export const NOTIFY_CHANNEL = "print_jobs";
export const MAX_ATTEMPTS = 20;

/** 2 s, 4 s, 8 s … capped at 60 s. */
export function backoffMs(attempts: number) {
  return Math.min(60_000, 1_000 * 2 ** Math.max(1, attempts));
}

const columns = `id, tenant_id as "tenantId", printer, kind, payload, status, attempts,
  next_attempt_at as "nextAttemptAt", last_error as "lastError", created_at as "createdAt", printed_at as "printedAt"`;

/** Claims the oldest due job for this tenant (and printer, when given), or returns null. */
export async function claimNextJob(pool: pg.Pool, tenantId: string, printer?: string): Promise<PrintJob | null> {
  const { rows } = await pool.query<PrintJob>(
    `update print_jobs set status = 'printing', attempts = attempts + 1
     where id = (
       select id from print_jobs
       where tenant_id = $1 and status = 'queued' and next_attempt_at <= now()
         and ($2::text is null or printer = $2)
       order by created_at
       limit 1
       for update skip locked
     )
     returning ${columns}`,
    [tenantId, printer ?? null],
  );
  return rows[0] ?? null;
}

export async function markDone(pool: pg.Pool, job: PrintJob) {
  await pool.query(
    `update print_jobs set status = 'done', printed_at = now(), last_error = null
     where id = $1 and tenant_id = $2`,
    [job.id, job.tenantId],
  );
}

/** Puts the job back in the queue with backoff, or marks it failed after MAX_ATTEMPTS. Never deletes it. */
export async function markFailed(pool: pg.Pool, job: PrintJob, error: string, backoff = backoffMs) {
  const giveUp = job.attempts >= MAX_ATTEMPTS;
  await pool.query(
    `update print_jobs
     set status = $3, last_error = $4, next_attempt_at = now() + ($5 || ' milliseconds')::interval
     where id = $1 and tenant_id = $2`,
    [job.id, job.tenantId, giveUp ? "failed" : "queued", error, String(backoff(job.attempts))],
  );
}

/**
 * After a power cut, jobs left in 'printing' go back to the queue. If the
 * printer had already printed one, it prints twice: a duplicate ticket is
 * better than a lost one.
 */
export async function recoverStuckJobs(pool: pg.Pool, tenantId: string, printer?: string) {
  const { rowCount } = await pool.query(
    `update print_jobs set status = 'queued', next_attempt_at = now()
     where tenant_id = $1 and status = 'printing' and ($2::text is null or printer = $2)`,
    [tenantId, printer ?? null],
  );
  return rowCount ?? 0;
}
