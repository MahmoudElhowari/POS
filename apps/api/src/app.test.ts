import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type AppDeps, createApp } from "./app.js";
import { createLoginLimiter } from "./auth/limiter.js";
import type { AuthStore, SessionStaff } from "./auth/store.js";
import { StaffRefused, type StaffStore } from "./auth/staff.js";
import type { MenuStore } from "./menu/store.js";
import { OrderRefused, type OrderStore } from "./orders/store.js";
import type { PrintJobView, PrintStore } from "./prints.js";

let close: (() => void) | undefined;
afterEach(() => close?.());

function fakePrints(jobs: Record<string, PrintJobView> = {}): PrintStore {
  return {
    queueTestTicket: async () => "job-1",
    getJob: async (id) => jobs[id] ?? null,
    retryJob: async (id) => jobs[id]?.status === "failed",
  };
}

const people: Record<string, SessionStaff> = {
  "1111": { staffId: "s-admin", name: "المدير", role: "admin" },
  "2222": { staffId: "s-cash", name: "كاشير", role: "cashier" },
};

function fakeAuth(): AuthStore {
  return {
    ensureInitialAdmin: async () => false,
    login: async (pin) => (people[pin] ? { token: `t-${pin}`, staff: people[pin] } : null),
    session: async (token) => people[token.replace("t-", "")] ?? null,
    logout: async () => {},
  };
}

const calls: unknown[][] = [];
function fakeMenu(): MenuStore {
  return {
    publicMenu: async () => ({ categories: [], addons: [] }),
    adminMenu: async () => ({ categories: [], addons: [] }),
    updateSize: async (...args: unknown[]) => void calls.push(["updateSize", ...args]),
    bulkPreview: async () => [],
    bulkApply: async () => 3,
  } as unknown as MenuStore;
}

function fakeStaff(): StaffStore {
  return {
    list: async () => [],
    create: async (input) => {
      if (input.pin === "1111") throw new StaffRefused("pin_taken");
      return "new-staff";
    },
    update: async (id) => id === "00000000-0000-4000-8000-000000000001",
  };
}

function fakeOrders(): OrderStore {
  return {
    hold: async () => "held-1",
    held: async () => [],
    discardHeld: async () => true,
    send: async (_draft, _staff, expected) => {
      if (expected !== 1500) throw new OrderRefused("price_changed", { totalCents: 1500 });
      return { id: "o-1", number: 7, businessDate: "2026-10-17", totalCents: 1500 };
    },
    get: async () => null,
    findCustomers: async () => [],
  };
}

let menuChanges = 0;

async function call(method: string, path: string, opts: { deps?: Partial<AppDeps>; token?: string; body?: unknown } = {}) {
  const app = createApp({
    checkDatabase: async () => true,
    prints: fakePrints(),
    printerStatus: async () => ({ host: "192.168.1.50", port: 9100, online: true }),
    menu: fakeMenu(),
    auth: fakeAuth(),
    limiter: createLoginLimiter(),
    staff: fakeStaff(),
    orders: fakeOrders(),
    menuChanged: () => menuChanges++,
    ...opts.deps,
  });
  const server = app.listen(0);
  close = () => server.close();
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
}

const failedJob: PrintJobView = {
  id: "job-9",
  status: "failed",
  attempts: 20,
  lastError: "paper out",
  createdAt: new Date(),
  printedAt: null,
};

describe("GET /health", () => {
  it("is 200 when the database answers", async () => {
    expect((await call("GET", "/health")).status).toBe(200);
  });

  it("is 503 when the database is down", async () => {
    const res = await call("GET", "/health", {
      deps: {
        checkDatabase: async () => {
          throw new Error("down");
        },
      },
    });
    expect(res.status).toBe(503);
  });
});

describe("printing", () => {
  it("queues a test ticket", async () => {
    const res = await call("POST", "/print/test");
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ jobId: "job-1" });
  });

  it("returns a job's status, or 404", async () => {
    const prints = fakePrints({ "job-9": failedJob });
    expect(await (await call("GET", "/print/jobs/job-9", { deps: { prints } })).json()).toMatchObject({ status: "failed" });
    expect((await call("GET", "/print/jobs/nope", { deps: { prints } })).status).toBe(404);
  });

  it("retries only failed jobs", async () => {
    const prints = fakePrints({ "job-9": failedJob });
    expect((await call("POST", "/print/jobs/job-9/retry", { deps: { prints } })).status).toBe(202);
    expect((await call("POST", "/print/jobs/nope/retry", { deps: { prints } })).status).toBe(409);
  });

  it("reports the printer status", async () => {
    expect(await (await call("GET", "/printer/status")).json()).toEqual({ host: "192.168.1.50", port: 9100, online: true });
  });
});

describe("PIN login", () => {
  it("signs in with a right PIN and refuses a wrong one", async () => {
    const ok = await call("POST", "/auth/pin", { body: { pin: "1111" } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ token: "t-1111", staff: { role: "admin" } });
    expect((await call("POST", "/auth/pin", { body: { pin: "9999" } })).status).toBe(401);
  });

  it("rejects a PIN that is not 4–6 digits", async () => {
    expect((await call("POST", "/auth/pin", { body: { pin: "12a4" } })).status).toBe(400);
  });

  it("locks after 5 wrong PINs, even for the right one", async () => {
    const limiter = createLoginLimiter();
    for (let i = 0; i < 5; i++) await call("POST", "/auth/pin", { deps: { limiter }, body: { pin: "9999" } });
    const res = await call("POST", "/auth/pin", { deps: { limiter }, body: { pin: "1111" } });
    expect(res.status).toBe(429);
  });
});

describe("menu", () => {
  it("serves the public menu without signing in", async () => {
    expect((await call("GET", "/menu")).status).toBe(200);
  });

  it("keeps admin routes for admins", async () => {
    expect((await call("GET", "/admin/menu")).status).toBe(401);
    expect((await call("GET", "/admin/menu", { token: "t-2222" })).status).toBe(403);
    expect((await call("GET", "/admin/menu", { token: "t-1111" })).status).toBe(200);
  });

  it("passes the admin's id with a price change", async () => {
    const id = "6f1c2c1e-2b1a-4c55-9a9e-0b1f9b6c1d11";
    const res = await call("PATCH", `/admin/sizes/${id}`, { token: "t-1111", body: { pricePounds: 1900 } });
    expect(res.status).toBe(204);
    expect(calls.at(-1)).toEqual(["updateSize", id, { pricePounds: 1900 }, "s-admin"]);
  });

  it("rejects fractional pounds and unknown ids", async () => {
    const id = "6f1c2c1e-2b1a-4c55-9a9e-0b1f9b6c1d11";
    expect((await call("PATCH", `/admin/sizes/${id}`, { token: "t-1111", body: { pricePounds: 19.5 } })).status).toBe(400);
    expect((await call("PATCH", "/admin/sizes/not-a-uuid", { token: "t-1111", body: { pricePounds: 1 } })).status).toBe(404);
  });

  it("refuses a bulk change of -100%", async () => {
    expect((await call("POST", "/admin/prices/bulk/preview", { token: "t-1111", body: { percentBp: -10_000 } })).status).toBe(400);
  });
});

describe("live menu updates", () => {
  it("announces a successful menu change but not a preview", async () => {
    const before = menuChanges;
    const id = "6f1c2c1e-2b1a-4c55-9a9e-0b1f9b6c1d11";
    await call("PATCH", `/admin/sizes/${id}`, { token: "t-1111", body: { pricePounds: 1900 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(menuChanges).toBe(before + 1);
    await call("POST", "/admin/prices/bulk/preview", { token: "t-1111", body: { percentBp: 500 } });
    await call("PATCH", `/admin/sizes/${id}`, { token: "t-1111", body: { pricePounds: 1.5 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(menuChanges).toBe(before + 1);
  });
});

describe("staff", () => {
  it("is admin-only", async () => {
    expect((await call("GET", "/admin/staff", { token: "t-2222" })).status).toBe(403);
  });

  it("adds a cashier and refuses a PIN someone else has", async () => {
    const body = { name: "سامر", role: "cashier", pin: "4321" };
    expect((await call("POST", "/admin/staff", { token: "t-1111", body })).status).toBe(201);
    const taken = await call("POST", "/admin/staff", { token: "t-1111", body: { ...body, pin: "1111" } });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "pin_taken" });
  });

  it("rejects a bad role or PIN", async () => {
    expect((await call("POST", "/admin/staff", { token: "t-1111", body: { name: "x", role: "owner", pin: "4321" } })).status).toBe(400);
    expect((await call("POST", "/admin/staff", { token: "t-1111", body: { name: "x", role: "cashier", pin: "12" } })).status).toBe(400);
  });
});

describe("orders", () => {
  const draft = {
    type: "pickup",
    customer: { name: "أبو أحمد" },
    lines: [{ itemId: "6f1c2c1e-2b1a-4c55-9a9e-0b1f9b6c1d11", sizeKey: "can", addons: [], removals: [], qty: 1 }],
  };

  it("needs a signed-in staff member", async () => {
    expect((await call("POST", "/orders/send", { body: { draft, expectedTotalCents: 1500 } })).status).toBe(401);
  });

  it("lets a cashier send an order", async () => {
    const res = await call("POST", "/orders/send", { token: "t-2222", body: { draft, expectedTotalCents: 1500 } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ number: 7 });
  });

  it("refuses a send when the price moved, with the new total", async () => {
    const res = await call("POST", "/orders/send", { token: "t-2222", body: { draft, expectedTotalCents: 1400 } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "price_changed", totalCents: 1500 });
  });

  it("rejects a malformed order", async () => {
    const bad = { ...draft, type: "drive_through" };
    expect((await call("POST", "/orders/send", { token: "t-2222", body: { draft: bad, expectedTotalCents: 1500 } })).status).toBe(400);
  });

  it("looks customers up by phone", async () => {
    expect((await call("GET", "/customers?phone=0944", { token: "t-2222" })).status).toBe(200);
  });
});
