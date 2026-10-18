import type { DayReport } from "@pos/shared";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { pounds } from "../format";

/** Half-and-half counts ½ for each side: 5 halves → "2½". */
export function halvesText(halves: number) {
  const whole = Math.trunc(halves / 2);
  if (halves % 2 === 0) return String(whole);
  return whole ? `${whole}½` : "½";
}

function Row({ label, value, strong }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1 ${strong ? "text-lg font-bold" : ""}`}>
      <span>{label}</span>
      <bdi dir="ltr">{value}</bdi>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-2xl bg-white p-4 shadow-sm">
      <h3 className="mb-1 font-bold">{title}</h3>
      {children}
    </section>
  );
}

export interface DrawerCount {
  notes: { pounds: number; count: number }[];
  otherCents: number;
  countedCents: number;
  differenceCents: number;
}

/** One day's figures, as on the printed X or Z report. */
export function ReportView({ report: r, count }: { report: DayReport; count?: DrawerCount | null }) {
  const { t } = useTranslation();
  const money = (c: number) => `${pounds(c)} ${t("admin.currency")}`;
  const minus = (c: number) => (c ? `-${pounds(c)}` : "0");
  // Reports frozen before Milestone 8 count every refund as cash.
  const cashRefundCents = r.cashRefundCents ?? r.refundCents;
  const unpaid = (title: string, list: { number: number; customerName: string; balanceCents: number }[]) =>
    list.length > 0 && (
      <Section title={`${title} (${list.length})`}>
        {list.map((u) => (
          <Row key={u.number} label={`${t("reports.order", { n: u.number })} · ${u.customerName}`} value={pounds(u.balanceCents)} />
        ))}
      </Section>
    );

  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="report">
      <Section title={t("reports.sales")}>
        <Row label={t("reports.orders")} value={r.ordersCount} />
        <Row label={t("reports.gross")} value={pounds(r.grossCents)} />
        <Row label={t("reports.discounts")} value={minus(r.discountCents)} />
        <Row label={t("reports.net")} value={money(r.netCents)} strong />
        <Row label={t("reports.tax")} value={money(r.taxIncludedCents)} />
        <Row label={t("reports.fees")} value={pounds(r.deliveryFeeCents)} />
      </Section>

      <Section title={t("reports.drawer")}>
        <Row label={t("reports.floatRow")} value={pounds(r.floatCents)} />
        <Row label={t("reports.cashIn")} value={pounds(r.cashCents)} />
        <Row label={t("reports.refundsOut")} value={pounds(cashRefundCents)} />
        <Row label={t("reports.driverFeesOut")} value={pounds(r.driverFeesCents ?? 0)} />
        <Row label={t("reports.expected")} value={money(r.expectedCashCents)} strong />
        {count && (
          <>
            {count.notes.map((n) => (
              <Row key={n.pounds} label={`${pounds(n.pounds * 100)} × ${n.count}`} value={pounds(n.pounds * n.count * 100)} />
            ))}
            {count.otherCents > 0 && <Row label={t("reports.close.other")} value={pounds(count.otherCents)} />}
            <Row label={t("reports.counted")} value={money(count.countedCents)} strong />
            <DifferenceRow cents={count.differenceCents} />
          </>
        )}
      </Section>

      <Section title={t("reports.byType")}>
        {r.byType.map((b) => (
          <Row key={b.type} label={`${t(`order.types.${b.type}`)} (${b.count})`} value={pounds(b.netCents)} />
        ))}
      </Section>

      <Section title={t("reports.payments")}>
        <Row label={t("reports.cash", { n: r.cashCount })} value={pounds(r.cashCents)} />
        {(r.wallets ?? []).map((w) => (
          <Row key={w.name} label={`${w.name} (${w.count})`} value={pounds(w.amountCents)} />
        ))}
        <Row label={t("reports.refunds", { n: r.refundCount })} value={minus(r.refundCents)} />
        {cashRefundCents !== r.refundCents && (
          <span className="text-sm text-neutral-600">
            {t("reports.refundSplit", { cash: pounds(cashRefundCents), wallet: pounds(r.refundCents - cashRefundCents) })}
          </span>
        )}
      </Section>

      {/* Reports frozen before Milestone 7 have no drivers. */}
      {(r.drivers ?? []).length > 0 && (
        <Section title={t("reports.drivers")}>
          {r.drivers.map((d) => (
            <div key={d.name} className="flex flex-col py-1">
              <Row label={t("reports.driverRow", { name: d.name, n: d.orders })} value={d.handInCents < 0 ? `-${pounds(-d.handInCents)}` : pounds(d.handInCents)} strong />
              <span className="text-sm text-neutral-600">{t("reports.driverDetail", { collected: pounds(d.collectedCents), fees: pounds(d.feesCents) })}</span>
            </div>
          ))}
        </Section>
      )}

      {r.voids.length > 0 && (
        <Section title={`${t("reports.voids")} (${r.voids.length})`}>
          {r.voids.map((v) => (
            <Row key={v.number} label={`${t("reports.order", { n: v.number })} · ${v.reason ? t(`reason.reasons.${v.reason}`) : ""} · ${v.staffName}`} value={pounds(v.totalCents)} />
          ))}
        </Section>
      )}
      {r.discounts.length > 0 && (
        <Section title={`${t("reports.discountList")} (${r.discounts.length})`}>
          {r.discounts.map((d) => (
            <Row
              key={d.number}
              label={`${t("reports.order", { n: d.number })}${
                d.coupon ? ` · ${t("reports.byCoupon", { code: d.coupon })}` : d.approvedBy ? ` · ${t("reports.approvedBy", { name: d.approvedBy })}` : ""
              }`}
              value={pounds(d.amountCents)}
            />
          ))}
        </Section>
      )}
      {(r.coupons ?? []).length > 0 && (
        <Section title={t("reports.coupons")}>
          {r.coupons!.map((c) => (
            <Row key={c.code} label={t("reports.couponRow", { code: c.code, n: c.orders })} value={pounds(c.amountCents)} />
          ))}
        </Section>
      )}
      {unpaid(t("reports.carried"), r.carried)}
      {unpaid(t("reports.leftUnpaid"), r.leftUnpaid)}
      {unpaid(t("reports.unresolved"), r.unresolved)}

      {r.items.length > 0 && (
        <Section title={t("reports.items")}>
          {r.items.map((i) => (
            <Row key={`${i.nameAr}-${i.sizeAr}`} label={`${i.nameAr}${i.sizeAr ? ` · ${i.sizeAr}` : ""}`} value={halvesText(i.halves)} />
          ))}
        </Section>
      )}
    </div>
  );
}

export function DifferenceRow({ cents }: { cents: number }) {
  const { t } = useTranslation();
  const word = cents > 0 ? t("reports.over") : cents < 0 ? t("reports.short") : t("reports.even");
  const tone = cents === 0 ? "text-emerald-700" : "text-red-700";
  return (
    <div className={`flex justify-between gap-4 py-1 text-2xl font-bold ${tone}`} data-testid="difference">
      <span>
        {t("reports.difference")} ({word})
      </span>
      <bdi dir="ltr">{cents > 0 ? `+${pounds(cents)}` : cents < 0 ? `-${pounds(-cents)}` : "0"}</bdi>
    </div>
  );
}
