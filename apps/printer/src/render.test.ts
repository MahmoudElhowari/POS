import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderTestTicket } from "./render.js";

const ticket = {
  restaurantAr: "رومانتيكا بيتزا",
  restaurantEn: "Romantica Pizza",
  printedAt: new Date("2026-10-17T18:15:00Z"),
  timeZone: "Asia/Damascus",
  printer: "192.168.1.50:9100",
  attempt: 1,
};

describe("renderTestTicket", () => {
  it("renders an 80 mm ticket with ink on it", async () => {
    const { canvas, bitmap } = renderTestTicket(ticket, 576);
    expect(bitmap.width).toBe(576);
    expect(bitmap.height).toBeGreaterThan(200);
    expect(bitmap.data.some((b) => b !== 0)).toBe(true);

    // Saved for a human to check the Arabic by eye.
    const out = fileURLToPath(new URL("../../../printer-output/", import.meta.url));
    mkdirSync(out, { recursive: true });
    writeFileSync(`${out}test-ticket.png`, await canvas.encode("png"));
  });

  it("renders a 58 mm ticket", () => {
    expect(renderTestTicket(ticket, 384).bitmap.width).toBe(384);
  });
});
