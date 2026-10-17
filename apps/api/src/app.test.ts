import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

let close: (() => void) | undefined;
afterEach(() => close?.());

async function get(path: string, checkDatabase: () => Promise<boolean>) {
  const server = createApp({ checkDatabase }).listen(0);
  close = () => server.close();
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  return fetch(`http://127.0.0.1:${port}${path}`);
}

describe("GET /health", () => {
  it("is 200 when the database answers", async () => {
    const res = await get("/health", async () => true);
    expect(res.status).toBe(200);
  });

  it("is 503 when the database is down", async () => {
    const res = await get("/health", async () => {
      throw new Error("down");
    });
    expect(res.status).toBe(503);
  });
});
