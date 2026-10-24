'use strict';
const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICO_SIZES = [16, 32, 48, 256];

// ── CRC32 for PNG ─────────────────────────────────────────────
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.allocUnsafe(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.allocUnsafe(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

// ── Render icon pixels (RGBA) for a given size ────────────────
function buildPixels(size) {
  const px = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2;
  const outerR = size / 2 - (size > 48 ? 2 : 1);

  const vx = [0.31*size, 0.31*size, 0.76*size];
  const vy = [0.21*size, 0.79*size, 0.50*size];

  function inTri(qx, qy) {
    const d1 = (qx-vx[1])*(vy[0]-vy[1]) - (vx[0]-vx[1])*(qy-vy[1]);
    const d2 = (qx-vx[2])*(vy[1]-vy[2]) - (vx[1]-vx[2])*(qy-vy[2]);
    const d3 = (qx-vx[0])*(vy[2]-vy[0]) - (vx[2]-vx[0])*(qy-vy[0]);
    return !((d1<0||d2<0||d3<0) && (d1>0||d2>0||d3>0));
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.sqrt((x-cx)**2 + (y-cy)**2);
      const i = (y*size + x) * 4;
      if (dist > outerR + 1) continue; // transparent (already 0)
      const a = dist > outerR ? Math.round((outerR+1-dist)*255) : 255;
      const t = inTri(x+0.5, y+0.5);
      px[i]   = t ? 255 : 0x11;
      px[i+1] = t ? 255 : 0x11;
      px[i+2] = t ? 255 : 0x11;
      px[i+3] = a;
    }
  }
  return px;
}

// ── Build PNG file from RGBA pixel array ──────────────────────
function buildPNG(px, size) {
  const sig  = Buffer.from([137,80,78,71,13,10,26,10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8]=8; ihdr[9]=6;

  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size*4);
    for (let x = 0; x < size; x++) {
      const si = (y*size+x)*4, di = 1+x*4;
      row[di]=px[si]; row[di+1]=px[si+1]; row[di+2]=px[si+2]; row[di+3]=px[si+3];
    }
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows), { level:9 });
  return Buffer.concat([sig, pngChunk('IHDR',ihdr), pngChunk('IDAT',idat), pngChunk('IEND',Buffer.alloc(0))]);
}

// ── Build BMP-format ICO image entry ─────────────────────────
function buildBMPEntry(px, size) {
  // 32bpp BGRA XOR mask + 1bpp AND mask (DWORD-aligned rows, bottom-to-top)
  const xorStride  = size * 4;
  const andStride  = Math.ceil(Math.ceil(size / 8) / 4) * 4;
  const xorSize    = xorStride * size;
  const andSize    = andStride * size;
  const bmp        = Buffer.alloc(40 + xorSize + andSize, 0);

  bmp.writeUInt32LE(40,       0);   // BITMAPINFOHEADER.biSize
  bmp.writeInt32LE(size,      4);   // biWidth
  bmp.writeInt32LE(size*2,    8);   // biHeight (XOR + AND stacked)
  bmp.writeUInt16LE(1,       12);   // biPlanes
  bmp.writeUInt16LE(32,      14);   // biBitCount
  bmp.writeUInt32LE(0,       16);   // biCompression: BI_RGB
  bmp.writeUInt32LE(xorSize, 20);   // biSizeImage

  // XOR mask: BGRA, bottom-to-top rows
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      const si = (srcY*size + x)*4;
      const di = 40 + y*xorStride + x*4;
      bmp[di]   = px[si+2]; // B
      bmp[di+1] = px[si+1]; // G
      bmp[di+2] = px[si];   // R
      bmp[di+3] = px[si+3]; // A
    }
  }

  // AND mask: 1 = transparent, bottom-to-top rows
  for (let y = 0; y < size; y++) {
    const srcY = size - 1 - y;
    for (let x = 0; x < size; x++) {
      if (px[(srcY*size + x)*4 + 3] < 128) {
        const off = 40 + xorSize + y*andStride + Math.floor(x/8);
        bmp[off] |= (0x80 >> (x % 8));
      }
    }
  }
  return bmp;
}

// ── Assemble multi-size ICO ───────────────────────────────────
function buildICO(entries) {
  // entries: [{size, data}]
  const n = entries.length;
  const headerSize = 6 + n*16;

  const hdr = Buffer.alloc(6);
  hdr.writeUInt16LE(0, 0);
  hdr.writeUInt16LE(1, 2); // type: ICO
  hdr.writeUInt16LE(n, 4);

  const dirs = [], datas = [];
  let offset = headerSize;

  for (const { size, data } of entries) {
    const dir = Buffer.alloc(16);
    dir[0] = size === 256 ? 0 : size;
    dir[1] = size === 256 ? 0 : size;
    dir[2] = 0; dir[3] = 0;
    dir.writeUInt16LE(1,  4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(data.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirs.push(dir);
    datas.push(data);
    offset += data.length;
  }

  return Buffer.concat([hdr, ...dirs, ...datas]);
}

// ── Generate ──────────────────────────────────────────────────
const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });

const entries = ICO_SIZES.map(size => ({ size, data: buildBMPEntry(buildPixels(size), size) }));
fs.writeFileSync(path.join(outDir, 'icon.ico'), buildICO(entries));
console.log('  ✓ assets/icon.ico (16, 32, 48, 256 px — BMP format)');

const px256 = buildPixels(256);
fs.writeFileSync(path.join(outDir, 'icon.png'), buildPNG(px256, 256));
console.log('  ✓ assets/icon.png (256 px)');
