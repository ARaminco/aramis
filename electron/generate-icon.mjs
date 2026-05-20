#!/usr/bin/env node
/**
 * Generates icon.png (1024×1024) from icon.svg.
 *
 * electron-builder picks up icon.png for Linux and auto-converts to .ico (Win)
 * and .icns (mac) when a matching native file isn't present. We also emit
 * icon.icns and icon.ico explicitly when the necessary tools are available.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(__dirname, 'icon.svg');
const pngPath = path.join(__dirname, 'icon.png');
const icnsPath = path.join(__dirname, 'icon.icns');
const icoPath = path.join(__dirname, 'icon.ico');

if (!fs.existsSync(svgPath)) {
  console.error('icon.svg not found at', svgPath);
  process.exit(1);
}

const svg = fs.readFileSync(svgPath);

// 1) PNG @ 1024
await sharp(svg, { density: 512 }).resize(1024, 1024).png().toFile(pngPath);
console.log('✓ wrote', path.relative(process.cwd(), pngPath));

// 2) macOS .icns — requires `iconutil` (macOS only).
async function makeIcns() {
  const iconset = path.join(__dirname, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  const sizes = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [px, name] of sizes) {
    await sharp(svg, { density: Math.max(72, px / 2) })
      .resize(px, px)
      .png()
      .toFile(path.join(iconset, name));
  }
  try {
    execSync(`iconutil -c icns "${iconset}" -o "${icnsPath}"`, { stdio: 'pipe' });
    console.log('✓ wrote', path.relative(process.cwd(), icnsPath));
  } catch (e) {
    console.warn('! could not run iconutil (macOS-only). electron-builder will convert PNG → ICNS instead.');
  }
  fs.rmSync(iconset, { recursive: true, force: true });
}

// 3) Windows .ico — produced by sharp by concatenating multi-size PNGs into an ICO container.
// sharp supports PNG/JPEG/WebP/etc. but not ICO writing directly. We use a tiny manual approach:
// generate multiple PNGs at standard sizes, then pack them into ICO format.
async function makeIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = await Promise.all(
    sizes.map((s) => sharp(svg, { density: Math.max(72, s / 2) }).resize(s, s).png().toBuffer())
  );
  fs.writeFileSync(icoPath, encodeIco(sizes, buffers));
  console.log('✓ wrote', path.relative(process.cwd(), icoPath));
}

function encodeIco(sizes, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type = ICO
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  let offset = 6 + sizes.length * 16;
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i] >= 256 ? 0 : sizes[i];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width
    entry.writeUInt8(size, 1); // height
    entry.writeUInt8(0, 2); // color count (0 = ≥ 256)
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngs[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += pngs[i].length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

if (process.platform === 'darwin') await makeIcns();
await makeIco();

console.log('Done.');
