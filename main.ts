// main.ts — "THE WORLD" front page for Tuesday 17 November 2026.
// Draws a newspaper front page entirely in code: a small software
// rasterizer (framebuffer, rect/circle/line/polygon fills), an embedded
// 5x7 bitmap font designed here, and a hand-rolled PNG encoder.
// Node 22, standard library only, no network, no file reads.
// Deterministic: fixed palette, fixed layout, fixed zlib level.
//
// Run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------
const W = 1024;
const H = 1024;
const MARGIN = 28; // outer page margin
const CW = W - MARGIN * 2; // content width: 968

// Palette (fixed, so both runs are byte-identical).
const PAPER = [246, 241, 229]; // newsprint off-white
const INK = [22, 19, 15]; // near-black ink
const RED = [158, 27, 27]; // masthead red
const NAVY = [29, 47, 78]; // date band / chip
const GREY = [107, 101, 90]; // secondary text
const RULE = [185, 178, 160]; // light rule grey
const SEA = [157, 191, 217]; // gulf map sea
const SEA_DEEP = [91, 135, 168]; // deep water
const SAND = [217, 196, 143]; // land on the map
const SAND_DARK = [203, 178, 122]; // second land tone
const SKY = [223, 232, 238]; // bridge sky
const GOLD = [201, 162, 39]; // chip pins / accents
const WHITE = [255, 255, 255];
const FLAME = [214, 90, 20]; // fire on tankers

// ------------------------------------------------------------------
// CRC32 (PNG chunk checksums). Standard polynomial 0xEDB88320.
// ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// Encode the RGB framebuffer as a PNG. Filter type 0 (None) on every
// scanline and a fixed deflate level, so the bytes are deterministic.
function encodePng(rgb) {
  const stride = W * 3 + 1;
  const raw = Buffer.alloc(H * stride);
  for (let y = 0; y < H; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: None
    rgb.copy(raw, rowStart + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------
// Framebuffer and drawing primitives
// ------------------------------------------------------------------
const fb = Buffer.alloc(W * H * 3);

function fillAll(c) {
  for (let i = 0; i < W * H; i++) {
    fb[i * 3] = c[0];
    fb[i * 3 + 1] = c[1];
    fb[i * 3 + 2] = c[2];
  }
}

function px(x, y, c) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function fillRect(x, y, w, h, c) {
  const x0 = Math.max(0, x);
  const y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w);
  const y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    let i = (yy * W + x0) * 3;
    for (let xx = x0; xx < x1; xx++) {
      fb[i] = c[0];
      fb[i + 1] = c[1];
      fb[i + 2] = c[2];
      i += 3;
    }
  }
}

function hline(x, y, w, c, t = 1) {
  fillRect(x, y, w, t, c);
}

function vline(x, y, h, c, t = 1) {
  fillRect(x, y, t, h, c);
}

// Bresenham line with a square brush of side `t`.
function line(x0, y0, x1, y1, c, t = 1) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  const half = Math.floor(t / 2);
  for (;;) {
    fillRect(x - half, y - half, t, t, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

// Dashed line: `dash` pixels on, `gap` pixels off.
function dashedLine(x0, y0, x1, y1, c, dash = 6, gap = 5) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const steps = Math.ceil(len);
  let on = true;
  let left = dash;
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (dx * i) / steps);
    const y = Math.round(y0 + (dy * i) / steps);
    if (on) px(x, y, c);
    left--;
    if (left === 0) {
      on = !on;
      left = on ? dash : gap;
    }
  }
}

function fillCircle(cx, cy, r, c) {
  for (let y = -r; y <= r; y++) {
    const half = Math.floor(Math.sqrt(r * r - y * y));
    for (let x = -half; x <= half; x++) {
      px(cx + x, cy + y, c);
    }
  }
}

function ring(cx, cy, r, c, t = 2) {
  for (let a = 0; a < 360; a++) {
    const rad = (a * Math.PI) / 180;
    for (let d = 0; d < t; d++) {
      px(Math.round(cx + (r - d) * Math.cos(rad)), Math.round(cy + (r - d) * Math.sin(rad)), c);
    }
  }
}

// Scanline polygon fill (even-odd). Points: [[x,y], ...].
function fillPoly(pts, c) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1]);
        xs.push(a[0] + t * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k]));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1]));
      for (let x = x0; x <= x1; x++) px(x, y, c);
    }
  }
}

function fillTriangle(x0, y0, x1, y1, x2, y2, c) {
  fillPoly(
    [
      [x0, y0],
      [x1, y1],
      [x2, y2],
    ],
    c,
  );
}

// Rounded-corner rectangle outline (used for the map frame).
function rectOutline(x, y, w, h, c, t = 1) {
  hline(x, y, w, c, t);
  hline(x, y + h - t, w, c, t);
  vline(x, y, h, c, t);
  vline(x + w - t, y, h, c, t);
}

// ------------------------------------------------------------------
// Embedded bitmap font — designed here, 5 wide by 7 tall per glyph.
// Each glyph is 7 rows of 5 bits ("1" = ink). Two sizes are produced
// by scaling: headlines at scale 3-5, body text at scale 2.
// ------------------------------------------------------------------
const FONT = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  a: ["00000", "00000", "01110", "00001", "01111", "10001", "01111"],
  b: ["10000", "10000", "11110", "10001", "10001", "10001", "11110"],
  c: ["00000", "00000", "01110", "10000", "10000", "10001", "01110"],
  d: ["00001", "00001", "01111", "10001", "10001", "10001", "01111"],
  e: ["00000", "00000", "01110", "10001", "11111", "10000", "01110"],
  f: ["00110", "01001", "01000", "11110", "01000", "01000", "01000"],
  g: ["00000", "01111", "10001", "10001", "01111", "00001", "01110"],
  h: ["10000", "10000", "11110", "10001", "10001", "10001", "10001"],
  i: ["00100", "00000", "01100", "00100", "00100", "00100", "01110"],
  j: ["00010", "00000", "00110", "00010", "00010", "00010", "01100"],
  k: ["10000", "10000", "10010", "10100", "11000", "10100", "10010"],
  l: ["01100", "00100", "00100", "00100", "00100", "00100", "01110"],
  m: ["00000", "00000", "11010", "10101", "10101", "10101", "10101"],
  n: ["00000", "00000", "11110", "10001", "10001", "10001", "10001"],
  o: ["00000", "00000", "01110", "10001", "10001", "10001", "01110"],
  p: ["00000", "00000", "11110", "10001", "11110", "10000", "10000"],
  q: ["00000", "00000", "01111", "10001", "01111", "00001", "00001"],
  r: ["00000", "00000", "10110", "11001", "10000", "10000", "10000"],
  s: ["00000", "00000", "01111", "10000", "01110", "00001", "11110"],
  t: ["01000", "01000", "11100", "01000", "01000", "01000", "00110"],
  u: ["00000", "00000", "10001", "10001", "10001", "10011", "01101"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
  w: ["00000", "00000", "10001", "10101", "10101", "10101", "01010"],
  x: ["00000", "00000", "10001", "01010", "00100", "01010", "10001"],
  y: ["00000", "00000", "10001", "10001", "01111", "00001", "01110"],
  z: ["00000", "00000", "11111", "00010", "00100", "01000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11111", "00010", "00100", "00010", "00001", "10001", "01110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "<": ["00010", "00100", "01000", "10000", "01000", "00100", "00010"],
  ">": ["01000", "00100", "00010", "00001", "00010", "00100", "01000"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "@": ["01110", "10001", "10111", "10101", "10110", "10000", "01110"],
  "~": ["00000", "00000", "01001", "10110", "00000", "00000", "00000"],
  "^": ["00100", "01010", "10001", "00000", "00000", "00000", "00000"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  "{": ["00010", "00100", "00100", "11100", "00100", "00100", "00010"],
  "}": ["01000", "00100", "00100", "00111", "00100", "00100", "01000"],
  "|": ["00100", "00100", "00100", "00100", "00100", "00100", "00100"],
  "\\": ["10000", "01000", "01000", "00100", "00010", "00010", "00001"],
};

// Characters outside the font fall back to "?".
function glyph(ch) {
  return FONT[ch] || FONT["?"];
}

// Width of one character cell at scale `s` (5 glyph pixels + 1 gap).
function charAdvance(s) {
  return 6 * s;
}

function textWidth(text, s) {
  if (text.length === 0) return 0;
  return text.length * charAdvance(s) - s;
}

function drawGlyph(ch, x, y, s, c) {
  const g = glyph(ch);
  for (let row = 0; row < 7; row++) {
    const bits = g[row];
    for (let col = 0; col < 5; col++) {
      if (bits[col] === "1") {
        fillRect(x + col * s, y + row * s, s, s, c);
      }
    }
  }
}

// Draw text at (x, y). align "left" or "center" (centered on x).
function drawText(text, x, y, s, c, align = "left") {
  let startX = x;
  if (align === "center") startX = x - Math.floor(textWidth(text, s) / 2);
  for (let i = 0; i < text.length; i++) {
    drawGlyph(text[i], startX + i * charAdvance(s), y, s, c);
  }
  return startX + text.length * charAdvance(s);
}

// Word-wrap `text` to lines no wider than `maxW` at scale `s`.
// Words longer than the line are split by character.
function wrapText(text, maxW, s) {
  const maxChars = Math.max(1, Math.floor((maxW + s) / charAdvance(s)));
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      for (let i = 0; i < word.length; i += maxChars) {
        lines.push(word.slice(i, i + maxChars));
      }
      continue;
    }
    const trial = cur ? cur + " " + word : word;
    if (trial.length <= maxChars) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Draw a wrapped paragraph. Returns the y just below the last line.
function drawPara(text, x, y, maxW, s, c, lineH) {
  const lines = wrapText(text, maxW, s);
  for (let i = 0; i < lines.length; i++) {
    drawText(lines[i], x, y + i * lineH, s, c);
  }
  return y + lines.length * lineH;
}

// ------------------------------------------------------------------
// Vector illustrations — one small iconic drawing per story panel.
// All flat shapes from the primitives above; no text is drawn inside
// an illustration except short place labels in the map.
// ------------------------------------------------------------------

// Lead illustration: schematic map of the Gulf / Strait of Hormuz.
// Frame (x, y, w, h). Sea fills the frame; Iran sits top-right,
// Arabia bottom-left; Qeshm Island, Bahrain, two burning tankers,
// two jets on dashed arcs and a carrier are marked.
function drawGulfMap(x, y, w, h) {
  fillRect(x, y, w, h, SEA);
  // Iran (north-east land mass, top right).
  fillPoly(
    [
      [x + w * 0.42, y],
      [x + w, y],
      [x + w, y + h * 0.42],
      [x + w * 0.78, y + h * 0.46],
      [x + w * 0.62, y + h * 0.30],
      [x + w * 0.5, y + h * 0.18],
    ],
    SAND,
  );
  // Arabia (south-west land mass, bottom left).
  fillPoly(
    [
      [x, y + h * 0.62],
      [x + w * 0.34, y + h * 0.55],
      [x + w * 0.52, y + h * 0.72],
      [x + w * 0.42, y + h],
      [x, y + h],
    ],
    SAND_DARK,
  );
  // Qeshm Island: long thin island in the strait.
  fillPoly(
    [
      [x + w * 0.60, y + h * 0.52],
      [x + w * 0.86, y + h * 0.47],
      [x + w * 0.88, y + h * 0.53],
      [x + w * 0.62, y + h * 0.58],
    ],
    SAND,
  );
  // Strike marker on Qeshm.
  const qx = x + Math.round(w * 0.74);
  const qy = y + Math.round(h * 0.52);
  fillCircle(qx, qy, 7, RED);
  ring(qx, qy, 12, RED, 2);
  // Bahrain: small island dot in the Gulf, west side.
  const bx = x + Math.round(w * 0.30);
  const by = y + Math.round(h * 0.42);
  fillCircle(bx, by, 5, SAND);
  fillCircle(bx, by, 2, INK);
  // US carrier in the Gulf (grey flat-top).
  const cx0 = x + Math.round(w * 0.16);
  const cy0 = y + Math.round(h * 0.60);
  fillRect(cx0, cy0, 52, 10, [90, 96, 104]);
  fillRect(cx0 + 34, cy0 - 8, 10, 8, [70, 76, 84]);
  // Two tankers in the strait, with flames.
  const t1x = x + Math.round(w * 0.58);
  const t1y = y + Math.round(h * 0.66);
  fillRect(t1x, t1y, 46, 9, [52, 44, 40]);
  fillRect(t1x + 8, t1y - 6, 12, 6, [52, 44, 40]);
  fillTriangle(t1x + 12, t1y - 6, t1x + 18, t1y - 22, t1x + 24, t1y - 6, FLAME);
  fillTriangle(t1x + 26, t1y - 6, t1x + 31, t1y - 16, t1x + 36, t1y - 6, FLAME);
  const t2x = x + Math.round(w * 0.72);
  const t2y = y + Math.round(h * 0.80);
  fillRect(t2x, t2y, 40, 9, [52, 44, 40]);
  fillRect(t2x + 24, t2y - 6, 10, 6, [52, 44, 40]);
  fillTriangle(t2x + 8, t2y - 6, t2x + 14, t2y - 20, t2x + 20, t2y - 6, FLAME);
  // Jets: two small delta shapes on dashed arcs from the top.
  dashedLine(x + Math.round(w * 0.55), y + 8, x + Math.round(w * 0.70), y + Math.round(h * 0.34), WHITE, 5, 4);
  dashedLine(x + Math.round(w * 0.82), y + 10, x + Math.round(w * 0.76), y + Math.round(h * 0.38), WHITE, 5, 4);
  const j1x = x + Math.round(w * 0.70);
  const j1y = y + Math.round(h * 0.34);
  fillTriangle(j1x, j1y - 11, j1x - 10, j1y + 9, j1x + 10, j1y + 9, INK);
  fillTriangle(j1x - 10, j1y + 9, j1x - 17, j1y + 15, j1x - 5, j1y + 9, INK);
  fillTriangle(j1x + 10, j1y + 9, j1x + 5, j1y + 9, j1x + 17, j1y + 15, INK);
  const j2x = x + Math.round(w * 0.76);
  const j2y = y + Math.round(h * 0.38);
  fillTriangle(j2x, j2y - 10, j2x - 9, j2y + 8, j2x + 9, j2y + 8, INK);
  // Compass arrow, top left.
  drawText("N", x + 10, y + 8, 2, INK);
  fillTriangle(x + 16, y + 26, x + 11, y + 40, x + 21, y + 40, RED);
  // Labels.
  drawText("QESHM", qx + 16, qy - 7, 2, INK);
  drawText("BAHRAIN", bx - 8, by + 12, 2, INK);
  drawText("HORMUZ", x + Math.round(w * 0.60), y + h - 26, 2, INK);
  drawText("GULF", x + 14, y + Math.round(h * 0.30), 2, INK);
  rectOutline(x, y, w, h, INK, 2);
}

// Kerch Bridge: deck across a strait, two towers, one span broken
// and falling, splash where it hit the water.
function drawBridge(x, y, w, h) {
  fillRect(x, y, w, h, SKY);
  const waterY = y + Math.round(h * 0.68);
  fillRect(x, waterY, w, h - (waterY - y), SEA_DEEP);
  // Water lines.
  for (let i = 0; i < 3; i++) {
    hline(x + 8 + i * 6, waterY + 12 + i * 12, w - 30 - i * 8, WHITE, 2);
  }
  // Towers.
  const t1 = x + Math.round(w * 0.28);
  const t2 = x + Math.round(w * 0.68);
  const deckY = y + Math.round(h * 0.42);
  fillRect(t1 - 3, y + 8, 6, deckY - y - 8, INK);
  fillRect(t2 - 3, y + 8, 6, deckY - y - 8, INK);
  fillRect(t1 - 3, y + 8, 6, 4, INK);
  fillRect(t2 - 3, y + 8, 6, 4, INK);
  // Cables from tower tops to the deck.
  line(t1, y + 10, x + 6, deckY, INK, 1);
  line(t1, y + 10, x + Math.round(w * 0.5), deckY, INK, 1);
  line(t2, y + 10, x + Math.round(w * 0.5), deckY, INK, 1);
  line(t2, y + 10, x + w - 6, deckY, INK, 1);
  // Deck: left half intact, a clear gap, then the right span tilted down.
  fillRect(x + 4, deckY, Math.round(w * 0.46) - 4, 6, INK);
  const breakX = x + Math.round(w * 0.54);
  line(breakX, deckY + 3, x + w - 8, deckY + 34, INK, 6);
  // Falling span fragment.
  fillPoly(
    [
      [x + w - 34, deckY + 40],
      [x + w - 10, deckY + 46],
      [x + w - 14, deckY + 56],
      [x + w - 38, deckY + 50],
    ],
    INK,
  );
  // Splash star where the span hit the water.
  const sx = x + Math.round(w * 0.82);
  const sy = waterY + 14;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const a2 = ((i + 0.5) * Math.PI) / 4;
    fillTriangle(
      sx,
      sy,
      Math.round(sx + 16 * Math.cos(a)),
      Math.round(sy + 16 * Math.sin(a)),
      Math.round(sx + 7 * Math.cos(a2)),
      Math.round(sy + 7 * Math.sin(a2)),
      WHITE,
    );
  }
  drawText("KERCH", x + 8, y + h - 20, 2, INK);
  rectOutline(x, y, w, h, INK, 1);
}

// Nvidia chip: dark square, gold pins, NVDA in the middle.
function drawChip(x, y, w, h) {
  fillRect(x, y, w, h, PAPER);
  const s = Math.min(w, h) - 28;
  const cx = x + Math.floor((w - s) / 2);
  const cy = y + Math.floor((h - s) / 2);
  // Pins on all four sides.
  for (let i = 0; i < 5; i++) {
    const p = cy + 10 + i * Math.floor((s - 20) / 4);
    fillRect(cx - 12, p, 12, 5, GOLD);
    fillRect(cx + s, p, 12, 5, GOLD);
    const q = cx + 10 + i * Math.floor((s - 20) / 4);
    fillRect(q, cy - 12, 5, 12, GOLD);
    fillRect(q, cy + s, 5, 12, GOLD);
  }
  fillRect(cx, cy, s, s, NAVY);
  fillRect(cx + 8, cy + 8, s - 16, s - 16, [38, 62, 102]);
  drawText("NVDA", cx + Math.floor(s / 2), cy + Math.floor(s / 2) - 11, 3, WHITE, "center");
  drawText("$115.8BN", cx + Math.floor(s / 2), cy + s + 2, 2, INK, "center");
  rectOutline(x, y, w, h, INK, 1);
}

// Summit flags: US stripes, China red, Russia tricolour, plus a globe.
function drawSummit(x, y, w, h) {
  fillRect(x, y, w, h, PAPER);
  // Globe on the left.
  const gx = x + 22;
  const gy = y + Math.floor(h / 2);
  fillCircle(gx, gy, 15, SEA_DEEP);
  fillPoly(
    [
      [gx - 10, gy - 6],
      [gx - 2, gy - 10],
      [gx + 4, gy - 4],
      [gx - 2, gy + 2],
      [gx - 8, gy + 2],
    ],
    [96, 160, 96],
  );
  fillPoly(
    [
      [gx + 2, gy + 6],
      [gx + 10, gy + 2],
      [gx + 11, gy + 9],
      [gx + 4, gy + 12],
    ],
    [96, 160, 96],
  );
  ring(gx, gy, 15, INK, 1);
  // Three flags to the right of the globe.
  const fw = 62;
  const fh = 26;
  const fy = y + Math.floor((h - fh) / 2);
  let fx = x + 48;
  // US: red/white stripes + blue canton.
  for (let i = 0; i < 7; i++) {
    fillRect(fx, fy + i * 4, fw, 4, i % 2 === 0 ? RED : WHITE);
  }
  fillRect(fx, fy, 26, 14, NAVY);
  fillCircle(fx + 6, fy + 4, 1, WHITE);
  fillCircle(fx + 13, fy + 7, 1, WHITE);
  fillCircle(fx + 20, fy + 4, 1, WHITE);
  fillCircle(fx + 10, fy + 11, 1, WHITE);
  fillCircle(fx + 17, fy + 11, 1, WHITE);
  rectOutline(fx, fy, fw, fh, INK, 1);
  fx += fw + 10;
  // China: red field, one big yellow star + small stars.
  fillRect(fx, fy, fw, fh, RED);
  fillPoly(
    [
      [fx + 12, fy + 3],
      [fx + 15, fy + 10],
      [fx + 22, fy + 10],
      [fx + 16, fy + 14],
      [fx + 18, fy + 21],
      [fx + 12, fy + 17],
      [fx + 6, fy + 21],
      [fx + 8, fy + 14],
      [fx + 2, fy + 10],
      [fx + 9, fy + 10],
    ],
    GOLD,
  );
  fillCircle(fx + 30, fy + 5, 2, GOLD);
  fillCircle(fx + 38, fy + 9, 2, GOLD);
  fillCircle(fx + 38, fy + 16, 2, GOLD);
  fillCircle(fx + 30, fy + 20, 2, GOLD);
  rectOutline(fx, fy, fw, fh, INK, 1);
  fx += fw + 10;
  // Russia: white / blue / red horizontal bands.
  fillRect(fx, fy, fw, 9, WHITE);
  fillRect(fx, fy + 9, fw, 9, [0, 60, 160]);
  fillRect(fx, fy + 18, fw, 8, RED);
  rectOutline(fx, fy, fw, fh, INK, 1);
}

// Japan jets: red sun disc and two interceptor silhouettes.
function drawJets(x, y, w, h) {
  fillRect(x, y, w, h, SKY);
  const sx = x + Math.round(w * 0.30);
  const sy = y + Math.floor(h / 2);
  fillCircle(sx, sy, 13, RED);
  // Dashed flight paths.
  dashedLine(x + w - 14, y + 6, x + Math.round(w * 0.55), y + Math.floor(h * 0.42), INK, 5, 4);
  dashedLine(x + w - 14, y + h - 8, x + Math.round(w * 0.55), y + Math.floor(h * 0.62), INK, 5, 4);
  // Two jet silhouettes flying left, towards the sun.
  for (const [jx, jy] of [
    [x + Math.round(w * 0.62), y + Math.floor(h * 0.40)],
    [x + Math.round(w * 0.62), y + Math.floor(h * 0.62)],
  ]) {
    fillTriangle(jx - 16, jy, jx + 12, jy - 6, jx + 12, jy + 6, INK);
    fillTriangle(jx - 2, jy - 5, jx + 6, jy - 12, jx + 10, jy - 5, INK);
    fillTriangle(jx - 2, jy + 5, jx + 6, jy + 12, jx + 10, jy + 5, INK);
  }
}

// Aid trucks: two box trucks heading for a gate, with crates.
function drawAid(x, y, w, h) {
  fillRect(x, y, w, h, PAPER);
  const gy = y + h - 8;
  // Road.
  fillRect(x, gy - 2, w, 2, RULE);
  // Gate posts at the right.
  const gx = x + w - 26;
  fillRect(gx, y + 4, 4, gy - y - 4, INK);
  fillRect(gx + 14, y + 4, 4, gy - y - 4, INK);
  fillRect(gx, y + 4, 18, 4, RED);
  // Truck 1 (left, larger).
  const t1x = x + 12;
  const t1y = gy - 20;
  fillRect(t1x, t1y, 52, 16, WHITE);
  rectOutline(t1x, t1y, 52, 16, INK, 1);
  fillRect(t1x + 52, t1y + 4, 18, 12, RED);
  rectOutline(t1x + 52, t1y + 4, 18, 12, INK, 1);
  fillCircle(t1x + 12, gy - 2, 4, INK);
  fillCircle(t1x + 42, gy - 2, 4, INK);
  fillCircle(t1x + 60, gy - 2, 4, INK);
  // Truck 2 (middle, smaller).
  const t2x = x + 96;
  const t2y = gy - 18;
  fillRect(t2x, t2y, 44, 14, [226, 220, 205]);
  rectOutline(t2x, t2y, 44, 14, INK, 1);
  fillRect(t2x + 44, t2y + 4, 15, 10, NAVY);
  rectOutline(t2x + 44, t2y + 4, 15, 10, INK, 1);
  fillCircle(t2x + 10, gy - 2, 4, INK);
  fillCircle(t2x + 36, gy - 2, 4, INK);
  fillCircle(t2x + 51, gy - 2, 4, INK);
  // Crates waiting at the gate.
  fillRect(gx - 34, gy - 12, 10, 10, SAND_DARK);
  rectOutline(gx - 34, gy - 12, 10, 10, INK, 1);
  fillRect(gx - 22, gy - 12, 10, 10, SAND_DARK);
  rectOutline(gx - 22, gy - 12, 10, 10, INK, 1);
  // Direction arrow above the trucks.
  line(x + 20, y + 6, x + w - 44, y + 6, RED, 2);
  fillTriangle(x + w - 44, y + 2, x + w - 44, y + 10, x + w - 34, y + 6, RED);
}

// ------------------------------------------------------------------
// Page layout — a newspaper front page, 1024 x 1024.
// Vertical plan (y):
//   16..202   masthead: THE WORLD + date band
//   210..512  lead story: Gulf strikes (map on the right)
//   526..712  row 2: Kerch Bridge | Nvidia
//   726..898  row 3: Shenzhen summit | Japan jets | Gaza aid
//   906..1000 digest strip: four more stories
// ------------------------------------------------------------------

function drawMasthead() {
  // Double rule at the top.
  hline(MARGIN, 16, CW, INK, 3);
  hline(MARGIN, 22, CW, INK, 1);
  // The nameplate.
  drawText("THE WORLD", W / 2, 30, 14, INK, "center");
  // Date band: the day, big and unmissable.
  fillRect(MARGIN, 134, CW, 60, NAVY);
  drawText("TUESDAY 17 NOVEMBER 2026", W / 2, 146, 5, WHITE, "center");
  // Rule under the masthead.
  hline(MARGIN, 202, CW, INK, 2);
  hline(MARGIN, 206, CW, INK, 1);
}

// Kicker line above a headline: small red caps label.
function kicker(text, x, y) {
  drawText(text, x, y, 2, RED);
}

// Headline + body for a story panel. Returns y below the body.
function storyText(x, y, w, head, body, headScale, bodyLinesMax) {
  const headLines = wrapText(head, w, headScale);
  const headLH = headScale * 7 + 5;
  for (let i = 0; i < headLines.length; i++) {
    drawText(headLines[i], x, y + i * headLH, headScale, INK);
  }
  const bodyY = y + headLines.length * headLH + 6;
  const bodyLines = wrapText(body, w, 2).slice(0, bodyLinesMax);
  for (let i = 0; i < bodyLines.length; i++) {
    drawText(bodyLines[i], x, bodyY + i * 18, 2, INK);
  }
  return bodyY + bodyLines.length * 18;
}

function drawLead() {
  const x = MARGIN;
  const y = 210;
  const textW = 620;
  const mapX = x + textW + 12;
  const mapW = MARGIN + CW - mapX; // 336
  const mapH = 296;
  kicker("THE GULF  -  MIDDLE EAST", x, y + 4);
  storyText(
    x,
    y + 24,
    textW,
    "US JETS STRIKE IRAN MISSILE SITE ON QESHM ISLAND",
    "US fighter jets hit an IRGC missile launch site on Qeshm Island, " +
      "hours after Iran fired drones at a US-operated radar in Bahrain - " +
      "the third attack on US forces there in five days. Mines hit tankers " +
      "in the Strait of Hormuz: a supertanker and an LNG carrier caught fire, " +
      "and 24 crew were evacuated from the Tara Gas. A third US carrier, " +
      "USS Theodore Roosevelt, is now in the Gulf.",
    5,
    8,
  );
  drawGulfMap(mapX, y + 4, mapW, mapH);
  hline(MARGIN, 518, CW, INK, 2);
}

function drawRow2() {
  const y = 526;
  const colW = 472;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 24;
  const illoW = 150;
  const illoH = 186;

  // --- Ukraine / Kerch Bridge (left) ---
  kicker("UKRAINE  -  WAR", leftX, y + 2);
  storyText(
    leftX,
    y + 20,
    colW - illoW - 12,
    "KERCH BRIDGE HIT FOR SECOND DAY",
    "Ukraine hit the Kerch Bridge to Crimea for a second day. A road span " +
      "fell into the strait; two people were killed. Russia closed road traffic.",
    3,
    6,
  );
  drawBridge(leftX + colW - illoW, y + 2, illoW, illoH);

  // Column divider.
  vline(MARGIN + colW + 11, y, 186, RULE, 1);

  // --- Nvidia (right) ---
  kicker("TECH  -  MARKETS", rightX, y + 2);
  storyText(
    rightX,
    y + 20,
    colW - illoW - 12,
    "NVIDIA SALES HIT $115.8BN",
    "Nvidia reported Q3 revenue of $115.8 billion and forecast about " +
      "$130 billion next quarter. Its board will not reinstate Jensen Huang as CEO.",
    3,
    6,
  );
  drawChip(rightX + colW - illoW, y + 2, illoW, illoH);
  hline(MARGIN, 718, CW, INK, 2);
}

function drawRow3() {
  const y = 726;
  const colW = 310;
  const gutter = 19;
  const cols = [MARGIN, MARGIN + colW + gutter, MARGIN + 2 * (colW + gutter)];
  const bandH = 34;

  // --- Trump / Shenzhen summit ---
  kicker("DIPLOMACY", cols[0], y + 2);
  storyText(
    cols[0],
    y + 20,
    colW,
    "TRUMP HEADS TO SHENZHEN SUMMIT",
    "APEC summit with Xi and Putin on 19 Nov.",
    3,
    2,
  );
  drawSummit(cols[0], y + 138, colW, bandH);

  // --- Japan jets ---
  kicker("ASIA  -  DEFENCE", cols[1], y + 2);
  storyText(
    cols[1],
    y + 20,
    colW,
    "JAPAN SCRAMBLES JETS AFTER INCURSION",
    "Russian aircraft entered Japanese airspace.",
    3,
    2,
  );
  drawJets(cols[1], y + 138, colW, bandH);

  // --- Gaza aid ---
  kicker("MIDDLE EAST  -  AID", cols[2], y + 2);
  storyText(
    cols[2],
    y + 20,
    colW,
    "FOUR NATIONS PRESS ISRAEL ON GAZA AID",
    "Pressure grows to let aid into Gaza.",
    3,
    2,
  );
  drawAid(cols[2], y + 138, colW, bandH);

  // Column dividers.
  vline(cols[1] - 10, y, 172, RULE, 1);
  vline(cols[2] - 10, y, 172, RULE, 1);
}

function drawDigest() {
  const y = 906;
  const h = 94;
  fillRect(MARGIN, y, CW, h, NAVY);
  drawText("ALSO TODAY", MARGIN + 10, y + 6, 2, [255, 214, 120]);
  const items = [
    "EBOLA IN DR CONGO PASSES 11,000 CASES; 5,400 DEAD",
    "US LOSES MEASLES-ELIMINATION STATUS AFTER 26 YEARS",
    "RUSSIAN AN-12 CRASHES IN KEMEROVO; 19 DEAD",
    "GERARD DEPARDIEU PLEADS GUILTY",
  ];
  const colW = 232;
  for (let i = 0; i < items.length; i++) {
    const ix = MARGIN + 10 + i * 242;
    const lines = wrapText(items[i], colW, 2).slice(0, 4);
    for (let j = 0; j < lines.length; j++) {
      drawText(lines[j], ix, y + 24 + j * 17, 2, WHITE);
    }
  }
}

// ------------------------------------------------------------------
// main
// ------------------------------------------------------------------
function main() {
  fillAll(PAPER);
  drawMasthead();
  drawLead();
  drawRow2();
  drawRow3();
  drawDigest();

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output/entry.png";
  const outPath = outDir.endsWith(".png") ? outDir : path.join(outDir, "entry.png");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const png = encodePng(fb);
  fs.writeFileSync(outPath, png);
}

main();
