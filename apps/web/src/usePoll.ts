import { useEffect, useRef } from "react";

/** Calls fn now and every intervalMs while enabled. */
export function usePoll(fn: () => void | Promise<void>, intervalMs: number, enabled = true) {
  const latest = useRef(fn);
  latest.current = fn;
  useEffect(() => {
    if (!enabled) return;
    void latest.current();
    const id = setInterval(() => void latest.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
