import { describe, expect, it } from "vitest";
import { createLoginLimiter } from "./limiter.js";

describe("login limiter", () => {
  it("locks for a minute after 5 failures, then lets the client try again", () => {
    let t = 0;
    const limiter = createLoginLimiter({ now: () => t });
    for (let i = 0; i < 4; i++) limiter.fail("tablet");
    expect(limiter.lockedFor("tablet")).toBe(0);
    limiter.fail("tablet");
    expect(limiter.lockedFor("tablet")).toBe(60_000);
    expect(limiter.lockedFor("other")).toBe(0);
    t = 60_000;
    expect(limiter.lockedFor("tablet")).toBe(0);
  });

  it("forgets failures after a successful login", () => {
    const limiter = createLoginLimiter();
    for (let i = 0; i < 4; i++) limiter.fail("tablet");
    limiter.succeed("tablet");
    limiter.fail("tablet");
    expect(limiter.lockedFor("tablet")).toBe(0);
  });
});
