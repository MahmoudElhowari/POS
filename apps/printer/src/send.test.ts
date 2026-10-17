import { createServer, type Server } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { probePrinter, sendToPrinter } from "./send.js";

let server: Server | undefined;
afterEach(() => server?.close());

function listen(onData: (chunks: Buffer[]) => void, hang = false): Promise<number> {
  server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (c) => chunks.push(c));
    socket.on("end", () => {
      onData(chunks);
      if (!hang) socket.end();
    });
  });
  return new Promise((resolve) => server!.listen(0, "127.0.0.1", () => resolve((server!.address() as AddressInfo).port)));
}

async function freePort() {
  const port = await listen(() => {});
  await new Promise((r) => server!.close(r));
  server = undefined;
  return port;
}

describe("sendToPrinter", () => {
  it("delivers every byte", async () => {
    let received = Buffer.alloc(0);
    const port = await listen((chunks) => (received = Buffer.concat(chunks)));
    const bytes = Buffer.alloc(100_000, 7);
    await sendToPrinter("127.0.0.1", port, bytes);
    await new Promise((r) => setTimeout(r, 50));
    expect(received.equals(bytes)).toBe(true);
  });

  it("rejects with a clear reason when the printer refuses", async () => {
    const port = await freePort();
    await expect(sendToPrinter("127.0.0.1", port, Buffer.from([1]))).rejects.toThrow(/refused/);
  });

  it("times out on an unreachable address", async () => {
    // 10.255.255.1 is a non-routable test address: the connect never completes.
    await expect(
      sendToPrinter("10.255.255.1", 9100, Buffer.from([1]), { connectTimeoutMs: 200, totalTimeoutMs: 1_000 }),
    ).rejects.toThrow(/timeout|unreachable/);
  });
});

describe("probePrinter", () => {
  it("is true when something listens and false otherwise", async () => {
    const port = await listen(() => {});
    expect(await probePrinter("127.0.0.1", port)).toBe(true);
    expect(await probePrinter("127.0.0.1", await freePort())).toBe(false);
  });
});
