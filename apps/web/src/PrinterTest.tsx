import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type PrinterStatus, type PrintJob } from "./api";
import { usePoll } from "./usePoll";

const statusColor: Record<PrintJob["status"], string> = {
  queued: "bg-amber-100 text-amber-900",
  printing: "bg-sky-100 text-sky-900",
  done: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
};

export function PrinterTest() {
  const { t } = useTranslation();
  const [printer, setPrinter] = useState<PrinterStatus | null>(null);
  const [job, setJob] = useState<PrintJob | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  usePoll(async () => setPrinter(await api.printerStatus().catch(() => ({ host: null, port: null, online: false }))), 5_000);

  const active = job !== null && (job.status === "queued" || job.status === "printing");
  usePoll(
    async () => {
      if (job) setJob(await api.job(job.id));
    },
    1_000,
    active,
  );

  async function run(action: () => Promise<{ jobId: string }>) {
    setBusy(true);
    setError(false);
    try {
      const { jobId } = await action();
      setJob(await api.job(jobId));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto flex max-w-xl flex-col gap-6">
      <h2 className="text-2xl font-bold">{t("printerTest.title")}</h2>

      <div className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm" data-testid="printer-status">
        <span
          className={`size-4 rounded-full ${printer === null ? "bg-neutral-300" : printer.online ? "bg-emerald-500" : "bg-red-500"}`}
        />
        <div className="flex flex-col">
          <span className="font-semibold">{t("printerTest.printer")}</span>
          <span className="flex gap-2 text-sm text-neutral-600">
            <span>
              {printer === null
                ? t("printerTest.checking")
                : printer.online
                  ? t("printerTest.online")
                  : t("printerTest.offline")}
            </span>
            {printer?.host && <bdi dir="ltr">{`${printer.host}:${printer.port}`}</bdi>}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => run(api.printTest)}
        disabled={busy || active}
        className="min-h-16 rounded-2xl bg-red-700 px-6 text-xl font-bold text-white active:bg-red-800 disabled:opacity-50"
      >
        {t("printerTest.print")}
      </button>

      {error && <p className="rounded-xl bg-red-100 p-4 text-red-900">{t("printerTest.error")}</p>}

      {job && (
        <div className={`flex flex-col gap-2 rounded-xl p-4 ${statusColor[job.status]}`} data-testid="job-status">
          <span className="text-lg font-bold">{t(`printerTest.status.${job.status}`)}</span>
          {job.attempts > 0 && <span>{t("printerTest.attempt", { count: job.attempts })}</span>}
          {job.lastError && job.status !== "done" && (
            <bdi dir="ltr" className="text-sm">
              {job.lastError}
            </bdi>
          )}
          {job.status === "queued" && job.lastError && <span>{t("printerTest.willRetry")}</span>}
          {job.status === "failed" && (
            <button
              type="button"
              onClick={() => run(() => api.retry(job.id))}
              className="min-h-12 self-start rounded-xl bg-red-700 px-5 font-bold text-white"
            >
              {t("printerTest.retry")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
