import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { decodeJob } from "./decode.js";
import { toPng } from "./png.js";

// Development stand-in for a network receipt printer: listens on 9100 and
// saves every job as a PNG, so work does not wait for hardware.
const port = Number(process.env.FAKE_PRINTER_PORT ?? 9100);
const outDir = process.env.FAKE_PRINTER_OUTPUT ?? "printer-output";
mkdirSync(outDir, { recursive: true });

createServer((socket) => {
  const chunks: Buffer[] = [];
  socket.on("data", (c) => chunks.push(c));
  socket.on("error", () => {});
  socket.on("end", async () => {
    socket.end();
    const bytes = Buffer.concat(chunks);
    if (!bytes.length) return; // status probe
    const job = decodeJob(bytes);
    const name = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(join(outDir, `${name}.bin`), bytes);
    writeFileSync(join(outDir, `${name}.png`), await toPng(job));
    console.log(`printed ${job.width}x${job.height}${job.cut ? " + cut" : ""} -> ${name}.png`);
  });
}).listen(port, () => console.log(`fake printer listening on :${port}, saving to ${outDir}`));
