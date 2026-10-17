import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, sql } from "drizzle-orm";
import { type Db, sessions, staff } from "@pos/db";
import { hashPin, verifyPin } from "./pin.js";

export type Role = "admin" | "manager" | "cashier";
export interface SessionStaff {
  staffId: string;
  name: string;
  role: Role;
}

/** Sessions end after this long without activity (the admin screen also locks itself). */
export const IDLE_TIMEOUT_MS = 10 * 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function createAuthStore(db: Db, tenantId: string) {
  return {
    /** First start: creates the admin from ADMIN_INITIAL_PIN if the restaurant has no staff yet. */
    async ensureInitialAdmin(pin: string | undefined) {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(staff).where(eq(staff.tenantId, tenantId));
      if ((row?.n ?? 0) > 0 || !pin) return false;
      await db.insert(staff).values({ tenantId, name: "المدير", role: "admin", pinHash: await hashPin(pin) });
      return true;
    },

    /** Returns a session token for the staff member with this PIN, or null. */
    async login(pin: string): Promise<{ token: string; staff: SessionStaff } | null> {
      const people = await db.select().from(staff).where(and(eq(staff.tenantId, tenantId), eq(staff.active, true)));
      for (const person of people) {
        if (await verifyPin(pin, person.pinHash)) {
          const token = randomBytes(32).toString("base64url");
          await db.insert(sessions).values({ tenantId, staffId: person.id, tokenHash: sha256(token) });
          return { token, staff: { staffId: person.id, name: person.name, role: person.role } };
        }
      }
      return null;
    },

    /** Looks up a live session and slides its idle timer forward. */
    async session(token: string): Promise<SessionStaff | null> {
      const cutoff = new Date(Date.now() - IDLE_TIMEOUT_MS);
      const [row] = await db
        .update(sessions)
        .set({ lastSeenAt: sql`now()` })
        .where(and(eq(sessions.tokenHash, sha256(token)), eq(sessions.tenantId, tenantId), gt(sessions.lastSeenAt, cutoff)))
        .returning({ staffId: sessions.staffId });
      if (!row) return null;
      const [person] = await db
        .select()
        .from(staff)
        .where(and(eq(staff.id, row.staffId), eq(staff.tenantId, tenantId), eq(staff.active, true)));
      return person ? { staffId: person.id, name: person.name, role: person.role } : null;
    },

    async logout(token: string) {
      await db.delete(sessions).where(and(eq(sessions.tokenHash, sha256(token)), eq(sessions.tenantId, tenantId)));
    },
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;
