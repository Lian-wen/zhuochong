'use strict';
/**
 * 生成托盘图标（32x32 PNG），免得依赖外部素材
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 32, H = 32;
const px = Buffer.alloc(W * H * 4, 0);

function set(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}
function circle(cx, cy, rad, r, g, b) {
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) set(x, y, r, g, b);
    }
  }
}
function triangle(p1, p2, p3, r, g, b) {
  const sign = (a, b2, c) => (a[0] - c[0]) * (b2[1] - c[1]) - (b2[0] - c[0]) * (a[1] - c[1]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const pt = [x, y];
    const d1 = sign(pt, p1, p2), d2 = sign(pt, p2, p3), d3 = sign(pt, p3, p1);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(neg && pos)) set(x, y, r, g, b);
  }
}

// 耳朵
triangle([7, 14], [8, 3], [17, 10], 90, 150, 180);
triangle([25, 14], [24, 3], [15, 10], 90, 150, 180);
// 头
circle(16, 17, 12, 143, 211, 238);
// 眼睛
circle(12, 16, 2.2, 34, 51, 59);
circle(20, 16, 2.2, 34, 51, 59);
// 腮红
circle(8.5, 21, 2.2, 255, 184, 198);
circle(23.5, 21, 2.2, 255, 184, 198);

/* ---- PNG 编码 ---- */
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
console.log('已生成 assets/icon.png', png.length, 'bytes');
