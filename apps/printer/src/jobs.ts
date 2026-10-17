import type { PrintJob } from "@pos/db";
import type { PrinterConfig } from "./config.js";
import { imageJob } from "./escpos.js";
import type { CustomerReceipt, DayReportPaper, KitchenTicket } from "@pos/shared";
import { renderTestTicket } from "./render.js";
import { renderKitchenTicket, renderReceipt, renderReport } from "./tickets.js";
import { sendToPrinter } from "./send.js";

export interface StoreInfo {
  restaurantAr: string;
  restaurantEn: string;
  timeZone: string;
}

/** Turns a queued job into printer bytes. */
export function jobBytes(job: PrintJob, printer: PrinterConfig, store: StoreInfo): Buffer {
  switch (job.kind) {
    case "test": {
      const { bitmap } = renderTestTicket(
        { ...store, printedAt: new Date(), printer: `${printer.host}:${printer.port}`, attempt: job.attempts },
        printer.widthDots,
      );
      return imageJob(bitmap, printer.bandRows);
    }
    case "kitchen":
      return imageJob(renderKitchenTicket(job.payload as KitchenTicket, store, printer.widthDots).bitmap, printer.bandRows);
    case "receipt":
      return imageJob(renderReceipt(job.payload as CustomerReceipt, store, printer.widthDots).bitmap, printer.bandRows);
    case "x_report":
    case "z_report":
      return imageJob(renderReport(job.payload as DayReportPaper, store, printer.widthDots).bitmap, printer.bandRows);
    default:
      throw new Error(`unknown print job kind: ${job.kind}`);
  }
}

export function makePrinter(printer: PrinterConfig, store: StoreInfo) {
  return (job: PrintJob) => sendToPrinter(printer.host, printer.port, jobBytes(job, printer, store));
}
