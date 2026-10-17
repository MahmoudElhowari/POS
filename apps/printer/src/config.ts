export interface PrinterConfig {
  host: string;
  port: number;
  widthDots: number;
  /** Rows per GS v 0 band; lower it for printers with small buffers. */
  bandRows: number;
}

/** The store's two printers: receipts at the counter, tickets in the kitchen. */
export const PRINTERS = ["receipt", "kitchen"] as const;
export type PrinterName = (typeof PRINTERS)[number];

function readOne(env: NodeJS.ProcessEnv, prefix: string, fallback?: PrinterConfig): PrinterConfig {
  return {
    host: env[`${prefix}_HOST`] ?? fallback?.host ?? "127.0.0.1",
    port: Number(env[`${prefix}_PORT`] ?? fallback?.port ?? 9100),
    widthDots: Number(env[`${prefix}_WIDTH_DOTS`] ?? fallback?.widthDots ?? 576),
    bandRows: Number(env[`${prefix}_BAND_ROWS`] ?? fallback?.bandRows ?? 255),
  };
}

export function readPrinterConfig(env: NodeJS.ProcessEnv = process.env): PrinterConfig {
  return readOne(env, "RECEIPT_PRINTER");
}

/** Without KITCHEN_PRINTER_* the kitchen tickets come out of the receipt printer. */
export function readPrinters(env: NodeJS.ProcessEnv = process.env): Record<PrinterName, PrinterConfig> {
  const receipt = readPrinterConfig(env);
  return { receipt, kitchen: readOne(env, "KITCHEN_PRINTER", receipt) };
}
