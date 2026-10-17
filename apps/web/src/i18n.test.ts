import { describe, expect, it } from "vitest";
import ar from "./locales/ar.json";
import en from "./locales/en.json";

describe("translations", () => {
  it("has the same keys in Arabic and English", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });
});
