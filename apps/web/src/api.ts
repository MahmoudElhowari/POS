import type { DraftProblem, OrderDraft } from "@pos/shared";

export type JobStatus = "queued" | "printing" | "done" | "failed";

export interface PrintJob {
  id: string;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
}

export interface PrinterStatus {
  host: string | null;
  port: number | null;
  online: boolean;
}

export interface Staff {
  staffId: string;
  name: string;
  role: "admin" | "manager" | "cashier";
}

export interface AdminSize {
  id: string;
  sizeKey: string;
  nameAr: string;
  nameEn: string;
  priceCents: number | null;
  available: boolean;
}

export interface AdminItem {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  halfAndHalf: boolean;
  removable: { ar: string; en: string }[];
  includedAddons: string[];
  available: boolean;
  sort: number;
  sizes: AdminSize[];
}

export interface AdminCategory {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  kind: "pizza" | "calzone" | "other";
  items: AdminItem[];
}

export interface AdminAddon {
  id: string;
  key: string;
  group: "crust_stuffing" | "extra";
  nameAr: string;
  nameEn: string;
  available: boolean;
  prices: { id: string; sizeKey: string; priceCents: number | null }[];
}

export interface AdminMenu {
  categories: AdminCategory[];
  addons: AdminAddon[];
}

export interface BulkRow {
  target: "item_size" | "addon_price";
  id: string;
  nameAr: string;
  sizeAr: string;
  oldCents: number;
  newCents: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: Staff["role"];
  active: boolean;
}

/** The sellable menu (GET /menu): only available, priced items. */
export interface MenuSize {
  id: string;
  sizeKey: string;
  nameAr: string;
  nameEn: string;
  priceCents: number;
}

export interface MenuItem {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  halfAndHalf: boolean;
  removable: { ar: string; en: string }[];
  includedAddons: string[];
  sizes: MenuSize[];
}

export interface Menu {
  categories: { id: string; key: string; nameAr: string; nameEn: string; kind: "pizza" | "calzone" | "other"; items: MenuItem[] }[];
  addons: { id: string; key: string; group: "crust_stuffing" | "extra"; nameAr: string; nameEn: string; prices: Record<string, number> }[];
}

export interface HeldOrder {
  id: string;
  draft: OrderDraft;
  staffId: string;
  updatedAt: string;
}

export interface SentOrder {
  id: string;
  number: number;
  businessDate: string;
  totalCents: number;
}

export interface CustomerMatch {
  id: string;
  name: string;
  phone: string;
  area: string;
  directions: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; retryAfterMs?: number; totalCents?: number; problems?: DraftProblem[] },
  ) {
    super(`${status} ${body.error ?? ""}`);
  }
}

let token: string | null = null;
let onSignedOut: () => void = () => {};

export function setSession(next: string | null, signedOut?: () => void) {
  token = next;
  if (signedOut) onSignedOut = signedOut;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (res.status === 401 && token) onSignedOut();
  if (!res.ok) throw new ApiError(res.status, await res.json().catch(() => ({})));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

export const api = {
  printTest: () => request<{ jobId: string }>("POST", "/print/test"),
  job: (id: string) => request<PrintJob>("GET", `/print/jobs/${id}`),
  retry: (id: string) => request<{ jobId: string }>("POST", `/print/jobs/${id}/retry`),
  printerStatus: () => request<PrinterStatus>("GET", "/printer/status"),

  login: (pin: string) => request<{ token: string; staff: Staff }>("POST", "/auth/pin", { pin }),
  logout: () => request<void>("POST", "/auth/logout"),
  me: () => request<Staff>("GET", "/auth/me"),

  adminMenu: () => request<AdminMenu>("GET", "/admin/menu"),
  updateItem: (id: string, patch: Partial<Omit<AdminItem, "id" | "sizes">>) => request<void>("PATCH", `/admin/items/${id}`, patch),
  updateSize: (id: string, patch: { pricePounds?: number | null; available?: boolean }) => request<void>("PATCH", `/admin/sizes/${id}`, patch),
  updateAddon: (id: string, patch: { available?: boolean }) => request<void>("PATCH", `/admin/addons/${id}`, patch),
  setAddonPrice: (id: string, pricePounds: number | null) => request<void>("PATCH", `/admin/addon-prices/${id}`, { pricePounds }),
  bulkPreview: (percentBp: number) => request<{ rows: BulkRow[] }>("POST", "/admin/prices/bulk/preview", { percentBp }),
  bulkApply: (percentBp: number) => request<{ changed: number }>("POST", "/admin/prices/bulk/apply", { percentBp }),

  staff: () => request<StaffMember[]>("GET", "/admin/staff"),
  addStaff: (input: { name: string; role: Staff["role"]; pin: string }) => request<{ id: string }>("POST", "/admin/staff", input),
  updateStaff: (id: string, patch: Partial<{ name: string; role: Staff["role"]; pin: string; active: boolean }>) =>
    request<void>("PATCH", `/admin/staff/${id}`, patch),

  menu: () => request<Menu>("GET", "/menu"),
  heldOrders: () => request<HeldOrder[]>("GET", "/orders/held"),
  hold: (draft: OrderDraft, heldId?: string) => request<{ heldId: string }>("POST", "/orders/hold", { draft, heldId }),
  discardHeld: (heldId: string) => request<void>("DELETE", `/orders/held/${heldId}`),
  send: (draft: OrderDraft, expectedTotalCents: number, heldId?: string) =>
    request<SentOrder>("POST", "/orders/send", { draft, expectedTotalCents, heldId }),
  customers: (phone: string) => request<CustomerMatch[]>("GET", `/customers?phone=${encodeURIComponent(phone)}`),
};
