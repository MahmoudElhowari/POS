import { describe, expect, it } from "vitest";
import { readPrinterConfig, readPrinters } from "./config.js";

describe("readPrinterConfig", () => {
  it("defaults to an 80 mm printer on port 9100", () => {
    expect(readPrinterConfig({})).toEqual({ host: "127.0.0.1", port: 9100, widthDots: 576, bandRows: 255 });
  });

  it("reads the fixed IP from the environment", () => {
    expect(readPrinterConfig({ RECEIPT_PRINTER_HOST: "192.168.1.50" }).host).toBe("192.168.1.50");
  });
});

describe("readPrinters", () => {
  it("sends kitchen tickets to the receipt printer when no kitchen printer is set", () => {
    expect(readPrinters({ RECEIPT_PRINTER_HOST: "192.168.1.50" }).kitchen.host).toBe("192.168.1.50");
  });

  it("reads the kitchen printer on its own", () => {
    const { receipt, kitchen } = readPrinters({ RECEIPT_PRINTER_HOST: "192.168.1.50", KITCHEN_PRINTER_HOST: "192.168.1.51", KITCHEN_PRINTER_WIDTH_DOTS: "384" });
    expect(receipt).toMatchObject({ host: "192.168.1.50", widthDots: 576 });
    expect(kitchen).toMatchObject({ host: "192.168.1.51", port: 9100, widthDots: 384 });
  });
});
