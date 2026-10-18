// Where a delivery order is (docs/milestones/m7-delivery-board.md), worked out
// from its order events like the order's balance: the last delivery event wins.

export type DeliveryState = "waiting" | "out" | "delivered";

export interface DeliveryEvent {
  kind: string;
  data: unknown;
  createdAt: Date | string;
}

export interface DeliveryStatus {
  state: DeliveryState;
  driverId: string | null;
  driverName: string | null;
  outAt: string | null;
  deliveredAt: string | null;
}

/** What a delivery event carries in its `data`. */
export interface DriverRef {
  driverId: string;
  driverName: string;
}

const iso = (d: Date | string) => (typeof d === "string" ? d : d.toISOString());

export function driverOf(data: unknown): DriverRef | null {
  const d = data as Partial<DriverRef> | null;
  return d && typeof d.driverId === "string" ? { driverId: d.driverId, driverName: d.driverName ?? "" } : null;
}

export function deliveryStatus(events: DeliveryEvent[]): DeliveryStatus {
  let status: DeliveryStatus = { state: "waiting", driverId: null, driverName: null, outAt: null, deliveredAt: null };
  for (const e of events) {
    const driver = driverOf(e.data);
    if (e.kind === "out_for_delivery") {
      status = { state: "out", driverId: driver?.driverId ?? null, driverName: driver?.driverName ?? null, outAt: iso(e.createdAt), deliveredAt: null };
    } else if (e.kind === "delivered") {
      status = { ...status, state: "delivered", deliveredAt: iso(e.createdAt) };
    } else if (e.kind === "returned") {
      // The driver brought it back: it waits for a driver again.
      status = { state: "waiting", driverId: null, driverName: null, outAt: null, deliveredAt: null };
    }
  }
  return status;
}
