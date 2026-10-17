import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, api, type Staff } from "../api";

export function PinPad({ onSignedIn }: { onSignedIn: (token: string, staff: Staff) => void }) {
  const { t } = useTranslation();
  const [pin, setPin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { token, staff } = await api.login(pin);
      if (staff.role !== "admin") {
        setMessage(t("pin.forbidden"));
      } else {
        onSignedIn(token, staff);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setMessage(t("pin.locked", { seconds: Math.ceil((err.body.retryAfterMs ?? 60_000) / 1000) }));
      } else if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setMessage(t("pin.wrong"));
      } else {
        setMessage(t("pin.error"));
      }
    } finally {
      setPin("");
      setBusy(false);
    }
  }

  const key = (label: string, onClick: () => void, extra = "") => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`min-h-16 rounded-2xl bg-white text-2xl font-bold shadow-sm active:bg-neutral-200 ${extra}`}
    >
      {label}
    </button>
  );

  return (
    <section className="mx-auto flex max-w-xs flex-col gap-4" aria-label={t("pin.title")}>
      <h2 className="text-center text-2xl font-bold">{t("pin.title")}</h2>
      <div className="flex h-12 items-center justify-center gap-3" data-testid="pin-dots" dir="ltr">
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={`size-4 rounded-full ${i < pin.length ? "bg-neutral-900" : "bg-neutral-300"}`} />
        ))}
      </div>
      {message && <p className="rounded-xl bg-red-100 p-3 text-center text-red-900">{message}</p>}
      <div className="grid grid-cols-3 gap-3" dir="ltr">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => key(d, () => setPin((p) => (p.length < 6 ? p + d : p))))}
        {key(t("pin.clear"), () => setPin(""), "text-lg")}
        {key("0", () => setPin((p) => (p.length < 6 ? `${p}0` : p)))}
        {key(t("pin.enter"), submit, "bg-red-700 text-lg text-white active:bg-red-800")}
      </div>
    </section>
  );
}
