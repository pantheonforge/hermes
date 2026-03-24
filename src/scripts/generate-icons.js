const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const data = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = a;
}

function fillRect(x, y, w, h, color) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) setPixel(px, py, color[0], color[1], color[2], color[3] ?? 255);
  }
}

function line(x0, y0, x1, y1, thickness, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.max(Math.abs(dx), Math.abs(dy));
  for (let i = 0; i <= len; i++) {
    const x = Math.round(x0 + (dx * i) / len);
    const y = Math.round(y0 + (dy * i) / len);
    fillRect(x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, color);
  }
}

// PixelRobot — 16×16 grid, each cell = 32px, accent #4fffb0
const accent = [79, 255, 176, 255];
const screen = [10, 15, 26, 255];
const light  = [255, 255, 255, 255];
const p = 32; // pixels per grid cell

// Antenna
fillRect(7*p, 0*p, 2*p, 1*p, accent);
fillRect(7*p, 1*p, 2*p, 1*p, accent);
fillRect(6*p, 2*p, 4*p, 1*p, accent);

// Head outer
fillRect(4*p, 3*p, 8*p, 1*p, accent);
fillRect(3*p, 4*p, 10*p, 1*p, accent);
fillRect(3*p, 5*p, 10*p, 1*p, accent);
fillRect(3*p, 6*p, 10*p, 1*p, accent);
fillRect(3*p, 7*p, 10*p, 1*p, accent);
fillRect(4*p, 8*p, 8*p,  1*p, accent);

// Face screen
fillRect(4*p, 4*p, 8*p, 4*p, screen);

// Eyes
fillRect(5*p, 5*p, 2*p, 2*p, accent);
fillRect(9*p, 5*p, 2*p, 2*p, accent);
fillRect(5*p, 5*p, 1*p, 1*p, light);
fillRect(9*p, 5*p, 1*p, 1*p, light);

// Mouth
fillRect(6*p, 7*p, 4*p, 1*p, accent);

// Neck
fillRect(7*p, 9*p, 2*p, 1*p, accent);

// Body outer
fillRect(3*p, 10*p, 10*p, 1*p, accent);
fillRect(2*p, 11*p, 12*p, 1*p, accent);
fillRect(2*p, 12*p, 12*p, 1*p, accent);
fillRect(2*p, 13*p, 12*p, 1*p, accent);
fillRect(2*p, 14*p, 12*p, 1*p, accent);
fillRect(3*p, 15*p, 10*p, 1*p, accent);

// Chest screen
fillRect(3*p, 11*p, 10*p, 4*p, screen);

// > symbol on chest — full height (rows 11-14), centered (cols 6-9 center at 7.5)
fillRect(6*p, 11*p, 2*p, 1*p, accent);
fillRect(8*p, 12*p, 2*p, 1*p, accent);
fillRect(8*p, 13*p, 2*p, 1*p, accent);
fillRect(6*p, 14*p, 2*p, 1*p, accent);

// Arms
fillRect(0*p, 11*p, 2*p, 3*p, accent);
fillRect(0*p, 14*p, 2*p, 1*p, accent);
fillRect(14*p, 11*p, 2*p, 3*p, accent);
fillRect(14*p, 14*p, 2*p, 1*p, accent);

function crc32(buf) {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4);
  l.writeUInt32BE(payload.length, 0);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(Buffer.concat([t, payload])), 0);
  return Buffer.concat([l, t, payload, c]);
}

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 4);
  row[0] = 0;
  data.copy(row, 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  rows.push(row);
}
const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr.writeUInt8(8, 8);
ihdr.writeUInt8(6, 9);
ihdr.writeUInt8(0, 10);
ihdr.writeUInt8(0, 11);
ihdr.writeUInt8(0, 12);
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', idat),
  pngChunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '../..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const pngPath = path.join(outDir, 'icon.png');
fs.writeFileSync(pngPath, png);

const icoHeader = Buffer.alloc(6);
icoHeader.writeUInt16LE(0, 0);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(1, 4);
const icoEntry = Buffer.alloc(16);
icoEntry.writeUInt8(0, 0);
icoEntry.writeUInt8(0, 1);
icoEntry.writeUInt8(0, 2);
icoEntry.writeUInt8(0, 3);
icoEntry.writeUInt16LE(1, 4);
icoEntry.writeUInt16LE(32, 6);
icoEntry.writeUInt32LE(png.length, 8);
icoEntry.writeUInt32LE(22, 12);
const ico = Buffer.concat([icoHeader, icoEntry, png]);
const icoPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(icoPath, ico);

console.log(`generated ${path.relative(process.cwd(), pngPath)} and ${path.relative(process.cwd(), icoPath)}`);
