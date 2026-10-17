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

async function request<T>(method: string, path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { method });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  printTest: () => request<{ jobId: string }>("POST", "/print/test"),
  job: (id: string) => request<PrintJob>("GET", `/print/jobs/${id}`),
  retry: (id: string) => request<{ jobId: string }>("POST", `/print/jobs/${id}/retry`),
  printerStatus: () => request<PrinterStatus>("GET", "/printer/status"),
};
