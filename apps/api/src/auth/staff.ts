import { and, asc, eq, ne } from "drizzle-orm";
import { type Db, sessions, staff } from "@pos/db";
import { hashPin, verifyPin } from "./pin.js";
import type { Role } from "./store.js";

export interface StaffRow {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}

/** Why a staff change was refused; the admin screen shows each one. */
export class StaffRefused extends Error {
  constructor(readonly code: "pin_taken" | "last_admin") {
    super(code);
  }
}

/** Adding and changing staff (admin only). PINs are unique so sign-in knows who it is. */
export function createStaffStore(db: Db, tenantId: string) {
  async function pinTaken(pin: string, exceptId?: string) {
    const others = await db
      .select({ pinHash: staff.pinHash })
      .from(staff)
      .where(and(eq(staff.tenantId, tenantId), eq(staff.active, true), ...(exceptId ? [ne(staff.id, exceptId)] : [])));
    for (const other of others) if (await verifyPin(pin, other.pinHash)) return true;
    return false;
  }

  async function activeAdmins(exceptId: string) {
    const rows = await db
      .select({ id: staff.id })
      .from(staff)
      .where(and(eq(staff.tenantId, tenantId), eq(staff.active, true), eq(staff.role, "admin"), ne(staff.id, exceptId)));
    return rows.length;
  }

  return {
    async list(): Promise<StaffRow[]> {
      return db
        .select({ id: staff.id, name: staff.name, role: staff.role, active: staff.active })
        .from(staff)
        .where(eq(staff.tenantId, tenantId))
        .orderBy(asc(staff.createdAt));
    },

    async create(input: { name: string; role: Role; pin: string }): Promise<string> {
      if (await pinTaken(input.pin)) throw new StaffRefused("pin_taken");
      const [row] = await db
        .insert(staff)
        .values({ tenantId, name: input.name, role: input.role, pinHash: await hashPin(input.pin) })
        .returning({ id: staff.id });
      return row!.id;
    },

    /** Returns false when no such staff member exists in this restaurant. */
    async update(id: string, patch: { name?: string; role?: Role; pin?: string; active?: boolean }): Promise<boolean> {
      const [current] = await db.select().from(staff).where(and(eq(staff.id, id), eq(staff.tenantId, tenantId)));
      if (!current) return false;
      const losesAdmin = current.role === "admin" && current.active && (patch.active === false || (patch.role && patch.role !== "admin"));
      if (losesAdmin && (await activeAdmins(id)) === 0) throw new StaffRefused("last_admin");
      if (patch.pin && (await pinTaken(patch.pin, id))) throw new StaffRefused("pin_taken");

      const { pin, ...rest } = patch;
      await db
        .update(staff)
        .set({ ...rest, ...(pin ? { pinHash: await hashPin(pin) } : {}) })
        .where(and(eq(staff.id, id), eq(staff.tenantId, tenantId)));
      // A new PIN, a new role or deactivation ends that person's open sessions.
      if (pin || patch.role || patch.active === false) {
        await db.delete(sessions).where(and(eq(sessions.staffId, id), eq(sessions.tenantId, tenantId)));
      }
      return true;
    },
  };
}

export type StaffStore = ReturnType<typeof createStaffStore>;
