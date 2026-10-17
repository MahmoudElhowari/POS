import { createServer } from "node:http";
import { readPrinterConfig } from "./config.js";

// Milestone 0: health only. Milestone 1 adds the job queue, the Arabic
// raster renderer and the TCP 9100 sender.
const port = Number(process.env.PRINTER_SERVICE_PORT ?? 3100);
const printer = readPrinterConfig();

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ service: "printer", ok: true, printer }));
    return;
  }
  res.writeHead(404).end();
}).listen(port, () => {
  console.log(`printer service listening on :${port}`);
});
