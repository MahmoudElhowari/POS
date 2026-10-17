import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { type AppDeps, createApp } from "./app.js";
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

async function call(method: string, path: string, deps: Partial<AppDeps> = {}) {
  const app = createApp({
    checkDatabase: async () => true,
    prints: fakePrints(),
    printerStatus: async () => ({ host: "192.168.1.50", port: 9100, online: true }),
    ...deps,
  });
  const server = app.listen(0);
  close = () => server.close();
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`, { method });
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
      checkDatabase: async () => {
        throw new Error("down");
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
    expect(await (await call("GET", "/print/jobs/job-9", { prints })).json()).toMatchObject({ status: "failed" });
    expect((await call("GET", "/print/jobs/nope", { prints })).status).toBe(404);
  });

  it("retries only failed jobs", async () => {
    const prints = fakePrints({ "job-9": failedJob });
    expect((await call("POST", "/print/jobs/job-9/retry", { prints })).status).toBe(202);
    expect((await call("POST", "/print/jobs/nope/retry", { prints })).status).toBe(409);
  });

  it("reports the printer status", async () => {
    expect(await (await call("GET", "/printer/status")).json()).toEqual({ host: "192.168.1.50", port: 9100, online: true });
  });
});
