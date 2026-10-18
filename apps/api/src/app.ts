import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { LoginLimiter } from "./auth/limiter.js";
import { PIN_PATTERN } from "./auth/pin.js";
import { StaffRefused, type StaffStore } from "./auth/staff.js";
import type { AuthStore, Role, SessionStaff } from "./auth/store.js";
import type { AuditLog } from "./audit.js";
import { DayRefused, type DayStore } from "./days.js";
import { DeliveryRefused, type DeliveryStore } from "./delivery.js";
import { NotFound, type MenuStore } from "./menu/store.js";
import { addonPatch, addonPricePatch, bulkRequest, itemPatch, newItem, sizePatch } from "./menu/types.js";
import { MoneyRefused, type MoneyStore, VOID_REASONS } from "./orders/money.js";
import { OrderRefused, type OrderStore } from "./orders/store.js";
import { holdRequest, sendRequest } from "./orders/types.js";
import type { PrintStore } from "./prints.js";
import { settingsPatch, type SettingsStore } from "./settings.js";

export interface PrinterStatus {
  host: string | null;
  port: number | null;
  online: boolean;
  /** The kitchen printer; the fields above are the receipt printer. */
  kitchen?: { host: string | null; port: number | null; online: boolean };
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
  money: MoneyStore;
  settings: SettingsStore;
  days: DayStore;
  audit: AuditLog;
  delivery: DeliveryStore;
  /** Tells order screens to reload the menu (Socket.IO in production). */
  menuChanged: () => void;
  /** Tells today's orders and the delivery board to reload. */
  ordersChanged: () => void;
}

const staffInput = z.object({
  name: z.string().trim().min(1).max(40),
  role: z.enum(["admin", "manager", "cashier"]),
  pin: z.string().regex(PIN_PATTERN),
});
const wholePounds = z.number().int().min(0).max(100_000_000);
const discountRequest = z.union([
  z.object({ percentBp: z.number().int().min(1).max(10_000), managerPin: z.string().regex(PIN_PATTERN) }),
  z.object({ amountPounds: wholePounds.min(1), managerPin: z.string().regex(PIN_PATTERN) }),
]);
const closeRequest = z.object({
  dayId: z.string().regex(/^[0-9a-f-]{36}$/i),
  notes: z.array(z.object({ pounds: z.number().int().min(1).max(1_000_000), count: z.number().int().min(0).max(100_000) })).max(30),
  otherPounds: wholePounds.default(0),
});
const voidRequest = z.object({ reason: z.enum(VOID_REASONS), note: z.string().trim().max(200).default("") });
const staffPatch = staffInput.partial().extend({ active: z.boolean().optional() });
const driverInput = z.object({ name: z.string().trim().min(1).max(40) });
const driverPatch = driverInput.partial().extend({ active: z.boolean().optional() });
const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

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

  /** After any successful change, other tablets reload today's orders and the board. */
  const announce = (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") res.on("finish", () => res.statusCode < 300 && deps.ordersChanged());
    next();
  };

  // ── Menu (Milestone 2) ──
  app.get("/menu", async (_req, res) => {
    res.json(await deps.menu.publicMenu());
  });

  const admin = express.Router();
  admin.use(requireRole("admin"));
  admin.param("id", (_req, res, next, id: string) => (UUID.test(id) ? next() : void res.status(404).json({ error: "not_found" })));
  // Any successful menu change reaches the order screens straight away.
  admin.use((req, res, next) => {
    if (req.method !== "GET" && !req.path.startsWith("/staff") && !req.path.startsWith("/settings") && !req.path.startsWith("/drivers")) {
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
    const input = staffInput.parse(req.body);
    const id = await deps.staff.create(input);
    // Never the PIN itself in the log.
    await deps.audit.record(req.staff!.staffId, "staff_added", { id, name: input.name, role: input.role });
    res.status(201).json({ id });
  });

  admin.patch("/staff/:id", async (req, res) => {
    const { pin, ...patch } = defined(staffPatch.parse(req.body));
    const found = await deps.staff.update(req.params.id!, { ...patch, ...(pin ? { pin } : {}) });
    if (found) await deps.audit.record(req.staff!.staffId, "staff_changed", { id: req.params.id, ...patch, pinChanged: Boolean(pin) });
    res.status(found ? 204 : 404).end();
  });

  admin.get("/drivers", async (_req, res) => {
    res.json(await deps.delivery.drivers());
  });

  admin.post("/drivers", async (req, res) => {
    const { name } = driverInput.parse(req.body);
    res.status(201).json({ id: await deps.delivery.addDriver(name, req.staff!.staffId) });
  });

  admin.patch("/drivers/:id", async (req, res) => {
    const found = await deps.delivery.updateDriver(req.params.id!, defined(driverPatch.parse(req.body)), req.staff!.staffId);
    res.status(found ? 204 : 404).end();
  });

  admin.get("/settings", async (_req, res) => {
    res.json(await deps.settings.all());
  });

  admin.patch("/settings", async (req, res) => {
    const patch = defined(settingsPatch.parse(req.body));
    await deps.settings.update(patch, req.staff!.staffId);
    await deps.audit.record(req.staff!.staffId, "settings_changed", patch);
    res.json(await deps.settings.all());
  });

  admin.get("/audit", async (req, res) => {
    const dayId = z.string().max(40).optional().parse(req.query.dayId);
    res.json(await deps.days.audit(dayId));
  });

  app.use("/admin", admin);

  // ── Orders (Milestone 3) ──
  const orders = express.Router();
  orders.use(requireRole("admin", "manager", "cashier"), announce);
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

  orders.get("/today", async (_req, res) => {
    res.json(await deps.money.today());
  });

  orders.get("/:id", async (req, res) => {
    res.json(await deps.money.detail(req.params.id!));
  });

  // ── Money (Milestone 4) ──
  orders.post("/:id/discount", async (req, res) => {
    const { managerPin, ...amount } = discountRequest.parse(req.body);
    const client = req.ip ?? "unknown";
    const wait = deps.limiter.lockedFor(client);
    if (wait > 0) return void res.status(429).json({ error: "locked", retryAfterMs: wait });
    const manager = await deps.auth.approver(managerPin);
    if (!manager) {
      deps.limiter.fail(client);
      return void res.status(403).json({ error: "not_approver" });
    }
    deps.limiter.succeed(client);
    res.json(await deps.money.discount(req.params.id!, amount, req.staff!.staffId, manager.staffId));
  });

  orders.post("/:id/delivery-fee", async (req, res) => {
    const { amountPounds } = z.object({ amountPounds: wholePounds }).parse(req.body);
    res.json(await deps.money.deliveryFee(req.params.id!, amountPounds, req.staff!.staffId));
  });

  orders.post("/:id/pay", async (req, res) => {
    const { tenderedPounds } = z.object({ tenderedPounds: wholePounds.min(1) }).parse(req.body);
    res.json(await deps.money.payCash(req.params.id!, tenderedPounds, req.staff!.staffId));
  });

  orders.post("/:id/void", async (req, res) => {
    const { reason, note } = voidRequest.parse(req.body);
    res.json(await deps.money.void(req.params.id!, reason, note, req.staff!.staffId));
  });

  orders.post("/:id/refund", async (req, res) => {
    const { reason, note } = voidRequest.parse(req.body);
    res.json(await deps.money.refund(req.params.id!, reason, note, req.staff!.staffId));
  });

  orders.post("/:id/reprint", async (req, res) => {
    const { which } = z.object({ which: z.enum(["kitchen", "receipt"]) }).parse(req.body);
    await deps.money.reprint(req.params.id!, which);
    res.status(202).end();
  });

  app.use("/orders", orders);

  // ── Delivery board (Milestone 7): every role ──
  const delivery = express.Router();
  delivery.use(requireRole("admin", "manager", "cashier"), announce);
  delivery.param("id", (_req, res, next, id: string) => (UUID.test(id) ? next() : void res.status(404).json({ error: "not_found" })));

  delivery.get("/board", async (_req, res) => {
    res.json(await deps.delivery.board());
  });

  delivery.post("/out", async (req, res) => {
    const { driverId, orderIds } = z.object({ driverId: uuid, orderIds: z.array(uuid).min(1).max(20) }).parse(req.body);
    await deps.delivery.out(orderIds, driverId, req.staff!.staffId);
    res.status(204).end();
  });

  delivery.post("/orders/:id/delivered", async (req, res) => {
    const { tenderedPounds } = z.object({ tenderedPounds: wholePounds.min(1).nullable().default(null) }).parse(req.body);
    res.json(await deps.delivery.delivered(req.params.id!, tenderedPounds, req.staff!.staffId));
  });

  delivery.post("/orders/:id/returned", async (req, res) => {
    const { note } = z.object({ note: z.string().trim().max(200).default("") }).parse(req.body);
    await deps.delivery.returned(req.params.id!, note, req.staff!.staffId);
    res.status(204).end();
  });

  app.use("/delivery", delivery);

  // ── Close of day (Milestone 5): managers and admins ──
  const reports = express.Router();
  reports.use(requireRole("admin", "manager"));
  reports.param("id", (_req, res, next, id: string) => (UUID.test(id) ? next() : void res.status(404).json({ error: "not_found" })));

  reports.get("/x", async (_req, res) => {
    res.json(await deps.days.x());
  });

  reports.post("/x/print", async (req, res) => {
    await deps.days.printX(req.staff!.staffId);
    res.status(202).end();
  });

  reports.put("/float", async (req, res) => {
    const { pounds } = z.object({ pounds: wholePounds }).parse(req.body);
    await deps.days.setFloat(pounds, req.staff!.staffId);
    res.status(204).end();
  });

  reports.post("/orders/:id/leave-unpaid", async (req, res) => {
    const { note } = z.object({ note: z.string().trim().max(200).default("") }).parse(req.body);
    await deps.days.leaveUnpaid(req.params.id!, note, req.staff!.staffId);
    res.status(204).end();
  });

  reports.post("/z", async (req, res) => {
    res.status(201).json(await deps.days.close(closeRequest.parse(req.body), req.staff!.staffId));
  });

  reports.get("/z", async (_req, res) => {
    res.json(await deps.days.closes());
  });

  reports.get("/z/:id", async (req, res) => {
    res.json(await deps.days.getClose(req.params.id!));
  });

  reports.post("/z/:id/print", async (req, res) => {
    await deps.days.reprintZ(req.params.id!, req.staff!.staffId);
    res.status(202).end();
  });

  app.use("/reports", reports);

  app.get("/customers", requireRole("admin", "manager", "cashier"), async (req, res) => {
    const phone = z.string().max(20).parse(req.query.phone ?? "");
    res.json(await deps.orders.findCustomers(phone));
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return void res.status(400).json({ error: "invalid", issues: err.issues });
    if (err instanceof NotFound) return void res.status(404).json({ error: "not_found" });
    if (err instanceof StaffRefused) return void res.status(409).json({ error: err.code });
    if (err instanceof DeliveryRefused) return void res.status(err.code === "not_found" ? 404 : 409).json({ error: err.code });
    if (err instanceof MoneyRefused) return void res.status(err.code === "not_found" ? 404 : 409).json({ error: err.code });
    if (err instanceof DayRefused) {
      return void res.status(err.code === "not_found" ? 404 : 409).json({ error: err.code, ...(err.code === "unresolved" ? { orders: err.detail } : {}) });
    }
    if (err instanceof OrderRefused) return void res.status(409).json({ error: err.code, ...err.detail });
    console.error(err);
    res.status(500).json({ error: "server_error" });
  });

  return app;
}
