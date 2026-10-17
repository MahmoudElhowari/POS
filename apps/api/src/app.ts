import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { LoginLimiter } from "./auth/limiter.js";
import { PIN_PATTERN } from "./auth/pin.js";
import { StaffRefused, type StaffStore } from "./auth/staff.js";
import type { AuthStore, Role, SessionStaff } from "./auth/store.js";
import { NotFound, type MenuStore } from "./menu/store.js";
import { addonPatch, addonPricePatch, bulkRequest, itemPatch, newItem, sizePatch } from "./menu/types.js";
import { OrderRefused, type OrderStore } from "./orders/store.js";
import { holdRequest, sendRequest } from "./orders/types.js";
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
  staff: StaffStore;
  orders: OrderStore;
  /** Tells order screens to reload the menu (Socket.IO in production). */
  menuChanged: () => void;
}

const staffInput = z.object({
  name: z.string().trim().min(1).max(40),
  role: z.enum(["admin", "manager", "cashier"]),
  pin: z.string().regex(PIN_PATTERN),
});
const staffPatch = staffInput.partial().extend({ active: z.boolean().optional() });

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
  // Any successful menu change reaches the order screens straight away.
  admin.use((req, res, next) => {
    if (req.method !== "GET" && !req.path.startsWith("/staff")) {
      res.on("finish", () => {
        if (res.statusCode < 300 && !req.path.endsWith("/preview")) deps.menuChanged();
      });
    }
    next();
  });

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

  admin.get("/staff", async (_req, res) => {
    res.json(await deps.staff.list());
  });

  admin.post("/staff", async (req, res) => {
    res.status(201).json({ id: await deps.staff.create(staffInput.parse(req.body)) });
  });

  admin.patch("/staff/:id", async (req, res) => {
    const found = await deps.staff.update(req.params.id!, defined(staffPatch.parse(req.body)));
    res.status(found ? 204 : 404).end();
  });

  app.use("/admin", admin);

  // ── Orders (Milestone 3) ──
  const orders = express.Router();
  orders.use(requireRole("admin", "manager", "cashier"));
  orders.param("id", (_req, res, next, id: string) => (UUID.test(id) ? next() : void res.status(404).json({ error: "not_found" })));

  orders.get("/held", async (_req, res) => {
    res.json(await deps.orders.held());
  });

  orders.post("/hold", async (req, res) => {
    const { draft, heldId } = holdRequest.parse(req.body);
    res.json({ heldId: await deps.orders.hold(draft, req.staff!.staffId, heldId) });
  });

  orders.delete("/held/:id", async (req, res) => {
    res.status((await deps.orders.discardHeld(req.params.id!)) ? 204 : 404).end();
  });

  orders.post("/send", async (req, res) => {
    const { draft, heldId, expectedTotalCents } = sendRequest.parse(req.body);
    res.status(201).json(await deps.orders.send(draft, req.staff!.staffId, expectedTotalCents, heldId));
  });

  orders.get("/:id", async (req, res) => {
    const order = await deps.orders.get(req.params.id!);
    if (!order) return void res.status(404).json({ error: "not_found" });
    res.json(order);
  });

  app.use("/orders", orders);

  app.get("/customers", requireRole("admin", "manager", "cashier"), async (req, res) => {
    const phone = z.string().max(20).parse(req.query.phone ?? "");
    res.json(await deps.orders.findCustomers(phone));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: "invalid", issues: err.issues });
    if (err instanceof NotFound) return void res.status(404).json({ error: "not_found" });
    if (err instanceof StaffRefused) return void res.status(409).json({ error: err.code });
    if (err instanceof OrderRefused) return void res.status(409).json({ error: err.code, ...err.detail });
    console.error(err);
    res.status(500).json({ error: "server_error" });
  });

  return app;
}
