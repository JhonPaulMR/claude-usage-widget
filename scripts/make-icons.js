// Gera build/icon.png (256) e build/icon.ico (PNG embutido) com o asterisco do Claude. Sem dependências.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = ~0;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Desenha fundo preto arredondado + 10 raios laranja, com supersampling 3x3.
function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 3;
  const c = size / 2;
  const R = size * 0.46; // raio do disco de fundo
  const rayLen = size * 0.34;
  const rayW = size * 0.045;
  const rays = 10;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cov = 0, ray = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const dx = x + (sx + 0.5) / ss - c;
          const dy = y + (sy + 0.5) / ss - c;
          if (Math.hypot(dx, dy) <= R) cov++;
          for (let i = 0; i < rays; i++) {
            const a = (i * Math.PI) / (rays / 2) + 0.2;
            const along = dx * Math.cos(a) + dy * Math.sin(a);
            const across = -dx * Math.sin(a) + dy * Math.cos(a);
            if (along > 0 && along < rayLen && Math.abs(across) < rayW * (1 - (along / rayLen) * 0.3)) {
              ray++;
              break;
            }
          }
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      const bg = cov / n;
      const r = ray / n;
      // mistura raio (#d97757) sobre fundo (#111)
      px[o] = Math.round(0xd9 * r + 0x11 * (1 - r));
      px[o + 1] = Math.round(0x77 * r + 0x11 * (1 - r));
      px[o + 2] = Math.round(0x57 * r + 0x11 * (1 - r));
      px[o + 3] = Math.round(255 * bg);
    }
  }
  return px;
}

const out = path.join(__dirname, '..', 'build');
fs.mkdirSync(out, { recursive: true });
const png256 = encodePng(256, draw(256));
fs.writeFileSync(path.join(out, 'icon.png'), png256);
fs.writeFileSync(path.join(out, 'tray.png'), encodePng(32, draw(32)));

// ICO com PNG embutido (suportado desde o Vista)
const hdr = Buffer.alloc(6);
hdr.writeUInt16LE(1, 2);
hdr.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; // 256 => 0
entry[1] = 0;
entry.writeUInt16LE(1, 4);
entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png256.length, 8);
entry.writeUInt32LE(22, 12);
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([hdr, entry, png256]));
console.log('ícones gerados em build/');
