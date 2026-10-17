import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { LoginLimiter } from "./auth/limiter.js";
import { PIN_PATTERN } from "./auth/pin.js";
import type { AuthStore, Role, SessionStaff } from "./auth/store.js";
import { NotFound, type MenuStore } from "./menu/store.js";
import { addonPatch, addonPricePatch, bulkRequest, itemPatch, newItem, sizePatch } from "./menu/types.js";
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
  menu: MenuStore;
  auth: AuthStore;
  limiter: LoginLimiter;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: SessionStaff;
    }
  }
}

/** Drops keys a client left out, so they are not written as undefined. */
function defined<T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

function bearer(req: Request) {
  const header = req.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json());

  app.get("/health", async (_req, res) => {
    const database = await deps.checkDatabase().catch(() => false);
    res.status(database ? 200 : 503).json({ service: "api", ok: database, database });
  });

  // ── Printing (Milestone 1) ──
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

  // ── Staff PIN login ──
  app.post("/auth/pin", async (req, res) => {
    const client = req.ip ?? "unknown";
    const wait = deps.limiter.lockedFor(client);
    if (wait > 0) return void res.status(429).json({ error: "locked", retryAfterMs: wait });
    const { pin } = z.object({ pin: z.string().regex(PIN_PATTERN) }).parse(req.body);
    const result = await deps.auth.login(pin);
    if (!result) {
      deps.limiter.fail(client);
      return void res.status(401).json({ error: "wrong_pin" });
    }
    deps.limiter.succeed(client);
    res.json(result);
  });

  app.post("/auth/logout", async (req, res) => {
    const token = bearer(req);
    if (token) await deps.auth.logout(token);
    res.status(204).end();
  });

  const requireRole =
    (...roles: Role[]) =>
    async (req: Request, res: Response, next: NextFunction) => {
      const token = bearer(req);
      const staff = token ? await deps.auth.session(token) : null;
      if (!staff) return void res.status(401).json({ error: "signed_out" });
      if (!roles.includes(staff.role)) return void res.status(403).json({ error: "forbidden" });
      req.staff = staff;
      next();
    };

  app.get("/auth/me", requireRole("admin", "manager", "cashier"), (req, res) => {
    res.json(req.staff);
  });

  // ── Menu (Milestone 2) ──
  app.get("/menu", async (_req, res) => {
    res.json(await deps.menu.publicMenu());
  });

  const admin = express.Router();
  admin.use(requireRole("admin"));
  admin.param("id", (_req, res, next, id: string) => (UUID.test(id) ? next() : void res.status(404).json({ error: "not_found" })));

  admin.get("/menu", async (_req, res) => {
    res.json(await deps.menu.adminMenu());
  });

  admin.post("/items", async (req, res) => {
    const id = await deps.menu.createItem(newItem.parse(req.body), req.staff!.staffId);
    res.status(201).json({ id });
  });

  admin.patch("/items/:id", async (req, res) => {
    await deps.menu.updateItem(req.params.id!, defined(itemPatch.parse(req.body)));
    res.status(204).end();
  });

  admin.patch("/sizes/:id", async (req, res) => {
    await deps.menu.updateSize(req.params.id!, defined(sizePatch.parse(req.body)), req.staff!.staffId);
    res.status(204).end();
  });

  admin.patch("/addons/:id", async (req, res) => {
    await deps.menu.updateAddon(req.params.id!, defined(addonPatch.parse(req.body)));
    res.status(204).end();
  });

  admin.patch("/addon-prices/:id", async (req, res) => {
    const { pricePounds } = addonPricePatch.parse(req.body);
    await deps.menu.setAddonPrice(req.params.id!, pricePounds, req.staff!.staffId);
    res.status(204).end();
  });

  admin.post("/prices/bulk/preview", async (req, res) => {
    const { percentBp } = bulkRequest.parse(req.body);
    const rows = await deps.menu.bulkPreview(percentBp);
    res.json({ percentBp, rows });
  });

  admin.post("/prices/bulk/apply", async (req, res) => {
    const { percentBp } = bulkRequest.parse(req.body);
    res.json({ changed: await deps.menu.bulkApply(percentBp, req.staff!.staffId) });
  });

  app.use("/admin", admin);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: "invalid", issues: err.issues });
    if (err instanceof NotFound) return void res.status(404).json({ error: "not_found" });
    console.error(err);
    res.status(500).json({ error: "server_error" });
  });

  return app;
}
