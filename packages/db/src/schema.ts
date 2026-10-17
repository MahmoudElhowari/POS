import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Every table has tenant_id and every query filters by it (CLAUDE.md rule 2).

export const printJobStatus = pgEnum("print_job_status", ["queued", "printing", "done", "failed"]);

export const printJobs = pgTable(
  "print_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull(),
    printer: text("printer").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    status: printJobStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    printedAt: timestamp("printed_at", { withTimezone: true }),
  },
  (t) => [index("print_jobs_due_idx").on(t.tenantId, t.status, t.nextAttemptAt)],
);

export type PrintJob = typeof printJobs.$inferSelect;
