/**
 * Generates all favicon PNG sizes from favicon.svg using @resvg/resvg-js,
 * then writes a multi-resolution .ico from the 16×16 and 32×32 PNGs.
 *
 * Usage: node scripts/generate-favicons.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const publicDir = resolve(root, 'public');

const svgPath = resolve(publicDir, 'favicon.svg');
const svgData = readFileSync(svgPath, 'utf8');

/** Render SVG at the given pixel size and return a PNG Buffer */
function renderPng(size) {
  const resvg = new Resvg(svgData, {
    fitTo: { mode: 'width', value: size },
    font: { loadSystemFonts: false }
  });
  return resvg.render().asPng();
}

// ── PNG files ────────────────────────────────────────────────────────────────
const sizes = [
  { name: 'favicon-16x16.png',        size: 16 },
  { name: 'favicon-32x32.png',        size: 32 },
  { name: 'apple-touch-icon.png',     size: 180 },
  { name: 'android-chrome-512x512.png', size: 512 },
];

const pngBuffers = {};

for (const { name, size } of sizes) {
  const png = renderPng(size);
  pngBuffers[size] = png;
  writeFileSync(resolve(publicDir, name), png);
  console.log(`✓ ${name} (${size}×${size})`);
}

// ── .ico file (16 + 32) ──────────────────────────────────────────────────────
// ICO format: ICONDIR + ICONDIRENTRY[] + image data
// Reference: https://en.wikipedia.org/wiki/ICO_(file_format)

function buildIco(pngs) {
  // pngs: [{size, data: Buffer}]  — must be PNG buffers, ≤ 256px
  const count = pngs.length;
  const headerSize = 6;            // ICONDIR
  const entrySize  = 16;           // ICONDIRENTRY
  const tocSize    = headerSize + count * entrySize;

  // Compute offsets
  let offset = tocSize;
  const entries = pngs.map(({ size, data }) => {
    const entry = { size, data, offset };
    offset += data.length;
    return entry;
  });

  // ICONDIR
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0,     0); // reserved
  header.writeUInt16LE(1,     2); // type: 1 = ICO
  header.writeUInt16LE(count, 4);

  // ICONDIRENTRYs
  const toc = Buffer.alloc(count * entrySize);
  entries.forEach(({ size, data, offset }, i) => {
    const b = i * entrySize;
    toc.writeUInt8(size >= 256 ? 0 : size, b);     // width  (0 = 256)
    toc.writeUInt8(size >= 256 ? 0 : size, b + 1); // height
    toc.writeUInt8(0,   b + 2); // color count (0 = no palette)
    toc.writeUInt8(0,   b + 3); // reserved
    toc.writeUInt16LE(1, b + 4); // color planes
    toc.writeUInt16LE(32, b + 6); // bits per pixel
    toc.writeUInt32LE(data.length, b + 8);
    toc.writeUInt32LE(offset,      b + 12);
  });

  return Buffer.concat([header, toc, ...entries.map(e => e.data)]);
}

const ico = buildIco([
  { size: 16,  data: pngBuffers[16] },
  { size: 32,  data: pngBuffers[32] },
]);
writeFileSync(resolve(publicDir, 'favicon.ico'), ico);
console.log('✓ favicon.ico (16+32 embedded PNGs)');

console.log('\nAll favicons generated successfully.');
