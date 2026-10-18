import { describe, expect, it } from "vitest";
import { deliveryStatus } from "./delivery.js";

const driver = { driverId: "d-1", driverName: "أبو علي" };

describe("deliveryStatus", () => {
  it("waits for a driver until it goes out", () => {
    expect(deliveryStatus([{ kind: "sent", data: {}, createdAt: "2026-10-18T18:00:00Z" }])).toMatchObject({ state: "waiting", driverName: null });
  });

  it("follows the order out and back in delivered", () => {
    const s = deliveryStatus([
      { kind: "sent", data: {}, createdAt: "2026-10-18T18:00:00Z" },
      { kind: "out_for_delivery", data: driver, createdAt: "2026-10-18T18:20:00Z" },
      { kind: "payment", data: { method: "cash", ...driver }, createdAt: "2026-10-18T18:45:00Z" },
      { kind: "delivered", data: driver, createdAt: "2026-10-18T18:45:00Z" },
    ]);
    expect(s).toEqual({ state: "delivered", driverId: "d-1", driverName: "أبو علي", outAt: "2026-10-18T18:20:00Z", deliveredAt: "2026-10-18T18:45:00Z" });
  });

  it("waits again when the driver brings it back", () => {
    const s = deliveryStatus([
      { kind: "out_for_delivery", data: driver, createdAt: "2026-10-18T18:20:00Z" },
      { kind: "returned", data: driver, createdAt: "2026-10-18T18:50:00Z" },
    ]);
    expect(s).toMatchObject({ state: "waiting", driverId: null, outAt: null });
  });
});
