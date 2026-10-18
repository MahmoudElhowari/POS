import { type Db, auditLog } from "@pos/db";

/** Who changed what outside order history (rule 11): staff, settings, the float, day closes. */
export function createAuditLog(db: Db, tenantId: string) {
  return {
    async record(staffId: string | null, action: string, details: object = {}) {
      await db.insert(auditLog).values({ tenantId, staffId, action, details });
    },
  };
}

export type AuditLog = ReturnType<typeof createAuditLog>;
