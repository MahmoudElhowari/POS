import express from "express";
import type { PrintStore } from "./prints.js";

export interface PrinterStatus {
  host: string | null;
  port: number | null;
  online: boolean;
}

export interface AppDeps {
  checkDatabase: () => Promise<boolean>;
  prints: PrintStore;
  printerStatus: () => Promise<PrinterStatus>;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const database = await deps.checkDatabase().catch(() => false);
    res.status(database ? 200 : 503).json({ service: "api", ok: database, database });
  });

  app.post("/print/test", async (_req, res) => {
    const jobId = await deps.prints.queueTestTicket();
    res.status(202).json({ jobId });
  });

  app.get("/print/jobs/:id", async (req, res) => {
    const job = await deps.prints.getJob(req.params.id);
    if (!job) return void res.status(404).json({ error: "not_found" });
    res.json(job);
  });

  app.post("/print/jobs/:id/retry", async (req, res) => {
    const ok = await deps.prints.retryJob(req.params.id);
    if (!ok) return void res.status(409).json({ error: "not_failed" });
    res.status(202).json({ jobId: req.params.id });
  });

  app.get("/printer/status", async (_req, res) => {
    res.json(await deps.printerStatus());
  });

  return app;
}
