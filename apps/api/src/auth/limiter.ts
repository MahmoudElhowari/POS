/** Locks PIN login for a client after too many wrong PINs in a row. */
export function createLoginLimiter({ maxFailures = 5, lockMs = 60_000, now = () => Date.now() } = {}) {
  const state = new Map<string, { failures: number; lockedUntil: number }>();
  return {
    /** Milliseconds until this client may try again, or 0. */
    lockedFor(client: string) {
      const s = state.get(client);
      return s ? Math.max(0, s.lockedUntil - now()) : 0;
    },
    fail(client: string) {
      const s = state.get(client) ?? { failures: 0, lockedUntil: 0 };
      s.failures += 1;
      if (s.failures >= maxFailures) {
        s.failures = 0;
        s.lockedUntil = now() + lockMs;
      }
      state.set(client, s);
    },
    succeed(client: string) {
      state.delete(client);
    },
  };
}
export type LoginLimiter = ReturnType<typeof createLoginLimiter>;
