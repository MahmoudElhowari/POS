import { Socket } from "node:net";

export interface SendOptions {
  connectTimeoutMs?: number;
  totalTimeoutMs?: number;
}

/**
 * Sends raw bytes to a printer on TCP 9100. Resolves only after the bytes are
 * flushed and the socket closed cleanly; every other outcome rejects.
 */
export function sendToPrinter(host: string, port: number, bytes: Buffer, opts: SendOptions = {}): Promise<void> {
  const { connectTimeoutMs = 5_000, totalTimeoutMs = 15_000 } = opts;
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    };

    const connectTimer = setTimeout(
      () => finish(new Error(`connect timeout after ${connectTimeoutMs} ms to ${host}:${port}`)),
      connectTimeoutMs,
    );
    const totalTimer = setTimeout(
      () => finish(new Error(`printer did not finish within ${totalTimeoutMs} ms`)),
      totalTimeoutMs,
    );

    socket.once("error", (err: NodeJS.ErrnoException) => finish(new Error(describe(err, host, port))));
    socket.connect(port, host, () => {
      clearTimeout(connectTimer);
      socket.end(bytes);
    });
    // "finish" fires once our side has flushed everything and sent FIN.
    socket.once("finish", () => finish());
  });
}

/** Quick reachability check for the status dot on screen. */
export function probePrinter(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host, () => done(true));
  });
}

function describe(err: NodeJS.ErrnoException, host: string, port: number) {
  switch (err.code) {
    case "ECONNREFUSED":
      return `printer refused the connection at ${host}:${port}`;
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return `printer unreachable at ${host}:${port}`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `printer address not found: ${host}`;
    case "ECONNRESET":
      return `printer closed the connection at ${host}:${port}`;
    default:
      return `${err.code ?? "error"}: ${err.message}`;
  }
}
