import { describe, expect, it } from "vitest";
import { hashPin, verifyPin } from "./pin.js";

describe("PIN hashing", () => {
  it("verifies the right PIN only and never stores it in plain text", async () => {
    const stored = await hashPin("4821");
    expect(stored).not.toContain("4821");
    expect(await verifyPin("4821", stored)).toBe(true);
    expect(await verifyPin("4822", stored)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPin("1234")).not.toBe(await hashPin("1234"));
  });
});
