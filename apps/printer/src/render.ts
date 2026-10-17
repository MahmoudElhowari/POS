import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { cents, formatSyp } from "@pos/shared";
import type { Bitmap } from "./bitmap.js";

const fontsDir = fileURLToPath(new URL("../assets/fonts/", import.meta.url));
GlobalFonts.registerFromPath(`${fontsDir}Cairo-Regular.ttf`, "Cairo");
GlobalFonts.registerFromPath(`${fontsDir}Cairo-Bold.ttf`, "Cairo");

const MARGIN = 16;

/** "start" follows the text direction; "right" pins a line (English under Arabic, say) to the right edge. */
type Align = "center" | "start" | "right";
export type Line =
  | { kind: "text"; text: string; size: number; bold?: boolean; align: Align; dir: "rtl" | "ltr" }
  /** Arabic on the right and an amount on the left, as on a receipt. */
  | { kind: "row"; start: string; end: string; size: number; bold?: boolean }
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
export function ltr(text: string) {
  return `\u2066${text}\u2069`;
}

function lineHeight(line: Line) {
  if (line.kind === "rule") return 24;
  if (line.kind === "gap") return line.height;
  return Math.ceil(line.size * 1.7);
}

const font = (size: number, bold?: boolean) => `${bold ? "bold " : ""}${size}px Cairo`;

function drawLine(ctx: SKRSContext2D, line: Line, y: number, width: number) {
  if (line.kind === "gap") return;
  if (line.kind === "rule") {
    ctx.fillRect(MARGIN, y + 11, width - 2 * MARGIN, 2);
    return;
  }
  ctx.font = font(line.size, line.bold);
  ctx.textBaseline = "middle";
  const mid = y + lineHeight(line) / 2;
  if (line.kind === "row") {
    // RTL so "3,225 ل.س" reads number first, as Arabic does; digits stay left to right.
    ctx.direction = "rtl";
    ctx.textAlign = "left";
    ctx.fillText(line.end, MARGIN, mid);
    const room = width - 2 * MARGIN - ctx.measureText(line.end).width - 16;
    ctx.direction = "rtl";
    ctx.textAlign = "right";
    ctx.fillText(line.start, width - MARGIN, mid, room);
    return;
  }
  ctx.direction = line.dir;
  // In RTL the start of a line is the right edge.
  const right = line.align === "right" || (line.align === "start" && line.dir === "rtl");
  const x = line.align === "center" ? width / 2 : right ? width - MARGIN : MARGIN;
  ctx.textAlign = line.align === "center" ? "center" : right ? "right" : "left";
  ctx.fillText(line.text, x, mid, width - 2 * MARGIN);
}

/** Splits text into lines that fit, breaking at spaces. */
function wrap(ctx: SKRSContext2D, text: string, room: number) {
  if (ctx.measureText(text).width <= room) return [text];
  const out: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > room) {
      out.push(current);
      current = word;
    } else current = next;
  }
  if (current) out.push(current);
  return out;
}

/** Long names and notes go onto more lines instead of being squeezed. */
function wrapLines(lines: Line[], width: number): Line[] {
  const ctx = createCanvas(1, 1).getContext("2d");
  return lines.flatMap((line): Line[] => {
    if (line.kind === "text") {
      ctx.font = font(line.size, line.bold);
      ctx.direction = line.dir;
      return wrap(ctx, line.text, width - 2 * MARGIN).map((text) => ({ ...line, text }));
    }
    if (line.kind === "row") {
      ctx.font = font(line.size, line.bold);
      ctx.direction = "rtl";
      const room = width - 2 * MARGIN - ctx.measureText(line.end).width - 16;
      const [first = "", ...rest] = wrap(ctx, line.start, room);
      return [
        { ...line, start: first },
        ...rest.map((text): Line => ({ kind: "text", text, size: line.size, bold: line.bold ?? false, align: "start", dir: "rtl" })),
      ];
    }
    return [line];
  });
}

/** Draws the lines on a white canvas and returns it with its 1-bit bitmap. */
export function renderLines(input: Line[], width: number) {
  const lines = wrapLines(input, width);
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
