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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: { error?: string; retryAfterMs?: number },
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
};
