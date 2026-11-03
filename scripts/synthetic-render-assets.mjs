// Synthetic stand-ins for the private Director signature and Common Seal, for
// tests and render QA only. Plain generated shapes: never the real artwork.
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** RGBA PNG from a pixel function (x, y) => [r, g, b, a]. */
export function syntheticPng(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (width * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// A grey zig-zag stroke on transparency, shaped like a signature box (418:285).
export const SYNTHETIC_SIGNATURE_PNG = syntheticPng(209, 143, (x, y) => (Math.abs(y - (71 + 40 * Math.sin(x / 14))) < 4 ? [70, 70, 70, 255] : [0, 0, 0, 0]));
// A navy disc with a gold ring and a transparent margin, like the seal canvas.
export const SYNTHETIC_SEAL_PNG = syntheticPng(160, 160, (x, y) => {
  const r = Math.hypot(x - 80, y - 80);
  if (r > 75) return [0, 0, 0, 0];
  return r > 68 ? [212, 175, 55, 255] : [11, 58, 99, 255];
});
export const dataUri = (png) => `data:image/png;base64,${png.toString("base64")}`;
export const SYNTHETIC_RENDER_ASSETS = { mode: "resolved", signature: dataUri(SYNTHETIC_SIGNATURE_PNG), seal: dataUri(SYNTHETIC_SEAL_PNG) };
