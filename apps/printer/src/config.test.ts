import { describe, expect, it } from "vitest";
import { readPrinterConfig } from "./config.js";

describe("readPrinterConfig", () => {
  it("defaults to an 80 mm printer on port 9100", () => {
    expect(readPrinterConfig({})).toEqual({ host: "127.0.0.1", port: 9100, widthDots: 576 });
  });

  it("reads the fixed IP from the environment", () => {
    expect(readPrinterConfig({ RECEIPT_PRINTER_HOST: "192.168.1.50" }).host).toBe("192.168.1.50");
  });
});
