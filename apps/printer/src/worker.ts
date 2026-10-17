import type pg from "pg";
import type { PrintJob } from "@pos/db";
import { backoffMs, claimNextJob, markDone, markFailed, NOTIFY_CHANNEL, recoverStuckJobs } from "./queue.js";

export interface WorkerOptions {
  pool: pg.Pool;
  tenantId: string;
  /** Renders and sends one job; throws if the printer did not take it. */
  print: (job: PrintJob) => Promise<void>;
  pollMs?: number;
  backoff?: (attempts: number) => number;
  log?: (msg: string) => void;
}

/** Runs until stop() is called. Wakes on NOTIFY, with a poll as safety net. */
export function startWorker({ pool, tenantId, print, pollMs = 2_000, backoff = backoffMs, log = console.log }: WorkerOptions) {
  let stopped = false;
  let wake: (() => void) | undefined;
  let listener: pg.PoolClient | undefined;

  const sleep = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, pollMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  async function listen() {
    try {
      listener = await pool.connect();
      listener.on("notification", () => wake?.());
      listener.on("error", () => {
        // Fall back to polling; reconnect on the next loop.
        const broken = listener;
        listener = undefined;
        broken?.release(true);
      });
      await listener.query(`listen ${NOTIFY_CHANNEL}`);
    } catch {
      listener?.release(true);
      listener = undefined;
    }
  }

  async function drain() {
    for (;;) {
      if (stopped) return;
      const job = await claimNextJob(pool, tenantId);
      if (!job) return;
      try {
        await print(job);
        await markDone(pool, job);
        log(`print job ${job.id} done (attempt ${job.attempts})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markFailed(pool, job, message, backoff);
        log(`print job ${job.id} attempt ${job.attempts} failed: ${message}`);
      }
    }
  }

  const done = (async () => {
    for (;;) {
      try {
        const recovered = await recoverStuckJobs(pool, tenantId);
        if (recovered) log(`re-queued ${recovered} print job(s) interrupted by a restart`);
        break;
      } catch (err) {
        if (stopped) return;
        log(`database not ready: ${(err as Error).message}`);
        await sleep();
      }
    }
    while (!stopped) {
      if (!listener) await listen();
      try {
        await drain();
      } catch (err) {
        log(`queue error: ${(err as Error).message}`);
      }
      if (!stopped) await sleep();
    }
  })();

  return {
    async stop() {
      stopped = true;
      wake?.();
      await done;
      listener?.release();
    },
  };
}
