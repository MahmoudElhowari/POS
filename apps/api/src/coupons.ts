import { and, asc, eq, sql } from "drizzle-orm";
import { type Coupon, coupons, type Db } from "@pos/db";
import { couponCode } from "@pos/shared";
import type { AuditLog } from "./audit.js";

/** Why a coupon change was refused. */
export class CouponRefused extends Error {
  constructor(readonly code: "duplicate" | "bad_amount") {
    super(code);
  }
}

/** What the admin types for a coupon: exactly one of a % off or an amount off. */
export interface CouponInput {
  code: string;
  percentBp?: number | null | undefined;
  amountPounds?: number | null | undefined;
  endsOn?: string | null | undefined;
  maxUses?: number | null | undefined;
  active?: boolean | undefined;
}

export interface CouponView extends Omit<Coupon, "tenantId" | "createdAt"> {
  createdAt: string;
  /** Orders using it now, not counting voided ones. */
  uses: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Coupon codes, made by the admin (docs/milestones/m8-wallets-coupons.md). */
export function createCouponStore(db: Db, tenantId: string, audit: AuditLog) {
  function amounts(input: Pick<CouponInput, "percentBp" | "amountPounds">) {
    const percentBp = input.percentBp ?? null;
    const amountCents = input.amountPounds != null ? input.amountPounds * 100 : null;
    if ((percentBp === null) === (amountCents === null)) throw new CouponRefused("bad_amount");
    return { percentBp, amountCents };
  }

  return {
    async list(): Promise<CouponView[]> {
      const rows = await db
        .select()
        .from(coupons)
        .where(eq(coupons.tenantId, tenantId))
        .orderBy(sql`${coupons.active} desc`, asc(coupons.code));
      // Uses: orders whose latest discount is the coupon, and that are not voided.
      const { rows: counts } = await db.execute<{ coupon_id: string; n: number }>(sql`
        select last.coupon_id, count(*)::int as n from (
          select distinct on (order_id) order_id, data->>'couponId' as coupon_id
          from order_events
          where tenant_id = ${tenantId} and kind = 'discount'
          order by order_id, created_at desc, id desc
        ) last
        where last.coupon_id is not null
          and not exists (select 1 from order_events v where v.tenant_id = ${tenantId} and v.order_id = last.order_id and v.kind = 'void')
        group by last.coupon_id`);
      const uses = new Map(counts.map((c) => [c.coupon_id, c.n]));
      return rows.map(({ tenantId: _t, createdAt, ...c }) => ({ ...c, createdAt: createdAt.toISOString(), uses: uses.get(c.id) ?? 0 }));
    },

    async add(input: CouponInput, staffId: string) {
      const code = couponCode(input.code);
      const values = { ...amounts(input), endsOn: input.endsOn ?? null, maxUses: input.maxUses ?? null, active: input.active ?? true };
      const [row] = await db
        .insert(coupons)
        .values({ tenantId, code, ...values, createdBy: staffId })
        .onConflictDoNothing()
        .returning();
      if (!row) throw new CouponRefused("duplicate");
      await audit.record(staffId, "coupon_added", { id: row.id, code, ...values });
      return row.id;
    },

    /** Changes a coupon. Orders that already used it keep the discount they got. */
    async update(id: string, patch: Partial<CouponInput>, staffId: string) {
      if (!UUID.test(id)) return false;
      const [current] = await db
        .select()
        .from(coupons)
        .where(and(eq(coupons.id, id), eq(coupons.tenantId, tenantId)));
      if (!current) return false;
      const set: Partial<typeof coupons.$inferInsert> = {};
      if (patch.code !== undefined) {
        set.code = couponCode(patch.code);
        const [same] = await db
          .select({ id: coupons.id })
          .from(coupons)
          .where(and(eq(coupons.tenantId, tenantId), eq(coupons.code, set.code)));
        if (same && same.id !== id) throw new CouponRefused("duplicate");
      }
      if (patch.percentBp !== undefined || patch.amountPounds !== undefined) Object.assign(set, amounts(patch));
      if (patch.endsOn !== undefined) set.endsOn = patch.endsOn;
      if (patch.maxUses !== undefined) set.maxUses = patch.maxUses;
      if (patch.active !== undefined) set.active = patch.active;
      if (!Object.keys(set).length) return true;
      await db
        .update(coupons)
        .set(set)
        .where(and(eq(coupons.id, id), eq(coupons.tenantId, tenantId)));
      await audit.record(staffId, "coupon_changed", { id, code: set.code ?? current.code, ...set });
      return true;
    },
  };
}

export type CouponStore = ReturnType<typeof createCouponStore>;
