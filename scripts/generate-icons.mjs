#!/usr/bin/env node
// Generates the Pixel Crew PWA icons (original art, MIT like the rest of the repo):
// a 32×32 pixel grid of three crew members behind a desk, written as
// apps/web/public/icons/icon.svg plus nearest-neighbour PNGs at 192 and 512 px.
// Run: node scripts/generate-icons.mjs
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GRID = 32;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "apps", "web", "public", "icons");

const BG = "#1a1a2e";
const grid = Array.from({ length: GRID }, () => Array(GRID).fill(BG));
const DY = -2; // vertical offset to centre the art
const put = (x, y0, c) => { const y = y0 + DY; if (x >= 0 && y >= 0 && x < GRID && y < GRID) grid[y][x] = c; };

// 6×10 crew member: h = hair, s = skin, e = eye, C = shirt
const CREW = [
  ".hhhh.",
  "hhhhhh",
  "hssssh",
  "sesses",
  "ssssss",
  ".ssss.",
  "CCCCCC",
  "CCCCCC",
  "CCCCCC",
  "CC..CC",
];

function crew(x0, y0, { hair, skin, shirt }) {
  CREW.forEach((row, dy) => {
    [...row].forEach((ch, dx) => {
      const c = { h: hair, s: skin, e: BG, C: shirt }[ch];
      if (c) put(x0 + dx, y0 + dy, c);
    });
  });
}

crew(5, 13, { hair: "#3b2a20", skin: "#f2c29b", shirt: "#2ec4b6" });  // dev
crew(21, 13, { hair: "#c0602a", skin: "#e0ac69", shirt: "#ef6f9a" }); // dev
crew(13, 10, { hair: "#1e1e1e", skin: "#c68642", shirt: "#e8b040" }); // lead, a step forward

// Desk in front of the crew
for (let x = 3; x <= 28; x++) {
  put(x, 21, "#c08a50");
  for (let y = 22; y <= 24; y++) put(x, y, "#8b5a2b");
  put(x, 25, "#5b3a1b");
}
for (const x of [4, 5, 26, 27]) put(x, 26, "#5b3a1b");
// A paper on the desk (the hand-off)
for (let x = 14; x <= 17; x++) put(x, 21, "#f4f1e8");
put(15, 20, "#f4f1e8");

// ── SVG ─────────────────────────────────────────────────────────
function toSvg() {
  const rects = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (grid[y][x] !== BG) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${grid[y][x]}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRID} ${GRID}" shape-rendering="crispEdges">` +
    `<rect width="${GRID}" height="${GRID}" fill="${BG}"/>${rects.join("")}</svg>\n`;
}

// ── PNG (RGBA, no dependencies) ─────────────────────────────────
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16), 255];
}
function toPng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    const gy = Math.floor((y * GRID) / size);
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x * GRID) / size);
      for (const v of hex(grid[gy][gx])) raw[o++] = v;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "icon.svg"), toSvg());
for (const size of [192, 512]) writeFileSync(join(OUT, `icon-${size}.png`), toPng(size));
console.log(`Wrote icon.svg, icon-192.png and icon-512.png to ${OUT}`);
