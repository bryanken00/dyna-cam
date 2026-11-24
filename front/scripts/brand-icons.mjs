/**
 * CR-036: writes every web icon and logo file from the DGPlay logo's one
 * description (scripts/brand/dgplay.mjs, copied from the brand kit):
 *
 *   public/favicon.svg (transparent; blue frame, white in dark), public/mask-icon.svg — vector
 *   public/brand/logo.svg (on its blue), logo-on-blue.svg (white frame, transparent),
 *   logo-blue.svg (blue frame, transparent), mark.svg (on its rounded tile)
 *   public/favicon-32.png, apple-touch-icon.png, icon-192/512.png,
 *   icon-maskable-192/512.png                           — sampled from dgplay.mjs paint()
 *
 * Run it after changing dgplay.mjs:  node scripts/brand-icons.mjs  (from front/)
 * Plain Node, no dependencies: the PNGs are encoded here with zlib.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

import { paint, sky } from "./brand/dgplay.mjs";
import { bareSvg, iconSvg, logoSvg } from "./brand/dgplay-svg.mjs";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const write = (rel, data) => {
  const file = path.join(PUBLIC, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log("wrote", rel);
};

/* ---------------------------------------------------------------- vectors */

write("favicon.svg", bareSvg({ id: "fav", adaptive: true }));
write("brand/mark.svg", iconSvg({ id: "mark", scale: 0.84, radius: 22 }));
write("brand/logo.svg", logoSvg({ id: "logo" }));
write("brand/logo-on-blue.svg", bareSvg({ id: "lob", frame: "#FFFFFF", square: false }));
write("brand/logo-blue.svg", bareSvg({ id: "lbl", square: false }));
write("mask-icon.svg", iconSvg({ id: "msk", scale: 0.94, ink: "#000000" }));

/* ------------------------------------------------------------------ PNGs */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const encodePng = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

/**
 * A square icon, sampled from paint(): the logo `scale` wide, on the tile's
 * blue with corners of `radius` (in 100ths; 0 = full bleed). 4×4 samples a pixel.
 */
const BLUE = [0x17, 0x4f, 0x8a];
const isWhite = (c) => c && c[0] === 255 && c[1] === 255 && c[2] === 255;

const iconPng = (size, { scale = 0.78, radius = 22, transparent = false } = {}) => {
  const S = 4;
  const rgba = Buffer.alloc(size * size * 4);
  const r = radius;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let R = 0;
      let G = 0;
      let B = 0;
      let A = 0;
      for (let sy = 0; sy < S; sy += 1) {
        for (let sx = 0; sx < S; sx += 1) {
          const u = ((px + (sx + 0.5) / S) / size) * 100; // 0..100 across the tile
          const v = ((py + (sy + 0.5) / S) / size) * 100;
          // Outside the rounded tile: transparent
          const cx = Math.min(Math.max(u, r), 100 - r);
          const cy = Math.min(Math.max(v, r), 100 - r);
          if (r > 0 && Math.hypot(u - cx, v - cy) > r) continue;
          // The logo box: 100 units = the frame's width, shown `scale` of the tile wide
          const bx = 50 + (u - 50) / scale;
          const by = 50 + (v - 50) / scale;
          let c = paint(bx, by);
          // Transparent: no tile, and the white frame drawn in the logo's blue
          if (transparent) {
            if (!c) continue;
            if (isWhite(c)) c = BLUE;
          } else if (!c) c = sky(u / 100, v / 100);
          R += c[0];
          G += c[1];
          B += c[2];
          A += 1;
        }
      }
      const i = (py * size + px) * 4;
      if (A > 0) {
        rgba[i] = Math.round(R / A);
        rgba[i + 1] = Math.round(G / A);
        rgba[i + 2] = Math.round(B / A);
      }
      rgba[i + 3] = Math.round((A / (S * S)) * 255);
    }
  }
  return encodePng(size, rgba);
};

write("favicon-32.png", iconPng(32, { scale: 0.98, radius: 0, transparent: true }));
write("apple-touch-icon.png", iconPng(180, { scale: 0.78, radius: 0 })); // iOS rounds it itself
write("icon-192.png", iconPng(192, { scale: 0.8, radius: 22 }));
write("icon-512.png", iconPng(512, { scale: 0.8, radius: 22 }));
// Maskable: full bleed, the logo inside the safe circle (80% of the tile)
write("icon-maskable-192.png", iconPng(192, { scale: 0.64, radius: 0 }));
write("icon-maskable-512.png", iconPng(512, { scale: 0.64, radius: 0 }));

