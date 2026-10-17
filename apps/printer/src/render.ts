import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { cents, formatSyp } from "@pos/shared";
import type { Bitmap } from "./bitmap.js";

const fontsDir = fileURLToPath(new URL("../assets/fonts/", import.meta.url));
GlobalFonts.registerFromPath(`${fontsDir}Cairo-Regular.ttf`, "Cairo");
GlobalFonts.registerFromPath(`${fontsDir}Cairo-Bold.ttf`, "Cairo");

const MARGIN = 16;

type Align = "center" | "start";
type Line =
  | { kind: "text"; text: string; size: number; bold?: boolean; align: Align; dir: "rtl" | "ltr" }
  | { kind: "rule" }
  | { kind: "gap"; height: number };

export interface TestTicket {
  restaurantAr: string;
  restaurantEn: string;
  printedAt: Date;
  timeZone: string;
  printer: string;
  attempt: number;
}

export function testTicketLines(t: TestTicket): Line[] {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: t.timeZone, dateStyle: "short" }).format(t.printedAt);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: t.timeZone, timeStyle: "short" }).format(t.printedAt);
  return [
    { kind: "text", text: t.restaurantAr, size: 52, bold: true, align: "center", dir: "rtl" },
    { kind: "text", text: t.restaurantEn, size: 30, align: "center", dir: "ltr" },
    { kind: "rule" },
    { kind: "text", text: "تذكرة اختبار — أهلاً بكم في رومانتيكا بيتزا", size: 28, bold: true, align: "start", dir: "rtl" },
    { kind: "text", text: "Test ticket — printer is working", size: 26, align: "start", dir: "ltr" },
    { kind: "text", text: `التاريخ: ${ltr(date)}    الوقت: ${ltr(time)}`, size: 26, align: "start", dir: "rtl" },
    { kind: "text", text: `السعر: ${formatSyp(cents(1_250_000))}`, size: 34, bold: true, align: "start", dir: "rtl" },
    { kind: "rule" },
    { kind: "text", text: `الطابعة: ${t.printer} · المحاولة ${t.attempt}`, size: 22, align: "center", dir: "rtl" },
    { kind: "gap", height: 8 },
  ];
}

/** Keeps a number run left-to-right inside an Arabic line (Unicode isolate). */
function ltr(text: string) {
  return `\u2066${text}\u2069`;
}

function lineHeight(line: Line) {
  if (line.kind === "rule") return 24;
  if (line.kind === "gap") return line.height;
  return Math.ceil(line.size * 1.7);
}

function drawLine(ctx: SKRSContext2D, line: Line, y: number, width: number) {
  if (line.kind === "gap") return;
  if (line.kind === "rule") {
    ctx.fillRect(MARGIN, y + 11, width - 2 * MARGIN, 2);
    return;
  }
  ctx.font = `${line.bold ? "bold " : ""}${line.size}px Cairo`;
  ctx.direction = line.dir;
  ctx.textBaseline = "middle";
  // In RTL the start of a line is the right edge.
  const x = line.align === "center" ? width / 2 : line.dir === "rtl" ? width - MARGIN : MARGIN;
  ctx.textAlign = line.align === "center" ? "center" : line.dir === "rtl" ? "right" : "left";
  ctx.fillText(line.text, x, y + lineHeight(line) / 2, width - 2 * MARGIN);
}

/** Draws the lines on a white canvas and returns it with its 1-bit bitmap. */
export function renderLines(lines: Line[], width: number) {
  const height = lines.reduce((h, l) => h + lineHeight(l), 0);
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  let y = 0;
  for (const line of lines) {
    drawLine(ctx, line, y, width);
    y += lineHeight(line);
  }
  return { canvas, bitmap: toBitmap(ctx.getImageData(0, 0, width, height).data, width, height) };
}

export function renderTestTicket(ticket: TestTicket, width: number) {
  return renderLines(testTicketLines(ticket), width);
}

function toBitmap(rgba: Uint8ClampedArray, width: number, height: number): Bitmap {
  const rowBytes = width / 8;
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luminance = 0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!;
      if (luminance < 128) data[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return { width, height, data };
}
