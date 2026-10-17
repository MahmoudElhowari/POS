export interface PrinterConfig {
  host: string;
  port: number;
  widthDots: number;
}

export function readPrinterConfig(env: NodeJS.ProcessEnv = process.env): PrinterConfig {
  return {
    host: env.RECEIPT_PRINTER_HOST ?? "127.0.0.1",
    port: Number(env.RECEIPT_PRINTER_PORT ?? 9100),
    widthDots: Number(env.RECEIPT_PRINTER_WIDTH_DOTS ?? 576),
  };
}
