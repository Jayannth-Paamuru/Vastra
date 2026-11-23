import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'public', 'icons');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const nx = x1 + t * dx;
  const ny = y1 + t * dy;
  return Math.hypot(px - nx, py - ny);
}

function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? 0 : size * 0.22;
  const scale = maskable ? 0.72 : 0.86;
  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;

      let alpha = 1;
      if (radius > 0) {
        const qx = Math.abs(x + 0.5 - cx) - (size / 2 - radius);
        const qy = Math.abs(y + 0.5 - cy) - (size / 2 - radius);
        const sdf = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
        alpha = clamp(0.5 - sdf, 0, 1);
      }

      if (alpha <= 0) {
        rgba[idx + 3] = 0;
        continue;
      }

      const t = clamp((x / size) * 0.55 + (y / size) * 0.45, 0, 1);
      let r = lerp(20, 91, t);
      let g = lerp(24, 75, t);
      let b = lerp(51, 196, t);

      const glowDist = Math.hypot(x - size * 0.8, y - size * 0.2) / (size * 0.65);
      const glow = clamp(1 - glowDist, 0, 1) * 0.28;
      r = lerp(r, 147, glow);
      g = lerp(g, 130, glow);
      b = lerp(b, 245, glow);

      const nx = (x + 0.5 - cx) / (size * 0.5 * scale);
      const ny = (y + 0.5 - cy) / (size * 0.5 * scale);

      const diamondDist = Math.abs(nx) + Math.abs(ny);
      const borderStroke = Math.abs(diamondDist - 0.86);
      if (borderStroke < 0.042) {
        const mix = clamp((0.042 - borderStroke) / 0.02, 0, 1);
        r = lerp(r, 234, mix * 0.85);
        g = lerp(g, 193, mix * 0.85);
        b = lerp(b, 108, mix * 0.85);
      }

      const leftArm = distToSegment(nx, ny, -0.34, -0.28, 0.0, 0.36);
      const rightArm = distToSegment(nx, ny, 0.34, -0.28, 0.0, 0.36);
      const vDist = Math.min(leftArm, rightArm);
      const strokeHalf = 0.095;
      if (vDist < strokeHalf + 0.025) {
        const mix = clamp((strokeHalf + 0.025 - vDist) / 0.03, 0, 1);
        r = lerp(r, 255, mix);
        g = lerp(g, 255, mix);
        b = lerp(b, 255, mix);
      }

      const dotDist = Math.hypot(nx, ny + 0.28);
      if (dotDist < 0.1) {
        const mix = clamp((0.1 - dotDist) / 0.025, 0, 1);
        r = lerp(r, 245, mix);
        g = lerp(g, 196, mix);
        b = lerp(b, 81, mix);
      }

      rgba[idx] = Math.round(clamp(r, 0, 255));
      rgba[idx + 1] = Math.round(clamp(g, 0, 255));
      rgba[idx + 2] = Math.round(clamp(b, 0, 255));
      rgba[idx + 3] = Math.round(alpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false }
];

for (const target of targets) {
  const png = renderIcon(target.size, { maskable: target.maskable });
  const filePath = path.join(outDir, target.file);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${path.relative(projectRoot, filePath)} (${png.length} bytes)`);
}
