import { useEffect } from "react";

/** Calls onIdle after ms without a touch, click or key press. */
export function useIdleLock(active: boolean, ms: number, onIdle: () => void) {
  useEffect(() => {
    if (!active) return;
    let timer = setTimeout(onIdle, ms);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(onIdle, ms);
    };
    const events = ["pointerdown", "keydown"] as const;
    for (const e of events) window.addEventListener(e, reset);
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, [active, ms, onIdle]);
}
