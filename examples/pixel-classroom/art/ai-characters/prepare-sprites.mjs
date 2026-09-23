// Mechanical import of generated atlases into Pixel Agents' native frame format.
// Run from the repository with: node examples/pixel-classroom/art/ai-characters/prepare-sprites.mjs
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const output = resolve(here, '../../public/assets/ai-characters');
const identities = ['deepseek', 'gpt', 'claude', 'kimi', 'glm'];
const report = {};
await mkdir(output, { recursive: true });
for (const id of identities) {
  const source = resolve(here, `source/${id}.png`);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rowRuns = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] >= 180) count++;
    if (count > width * .025) { if (start < 0) start = y; }
    else if (start >= 0) { if (y - start > 12) rowRuns.push([start, y]); start = -1; }
  }
  if (start >= 0) rowRuns.push([start, height]);
  if (rowRuns.length !== 3) throw new Error(`${id}: expected three separate direction rows`);
  const cuts = [0, Math.floor((rowRuns[0][1] + rowRuns[1][0]) / 2), Math.floor((rowRuns[1][1] + rowRuns[2][0]) / 2), height];
  const frames = [];
  for (let row = 0; row < 3; row++) for (let column = 0; column < 7; column++) {
    const left = Math.round(column * width / 7), right = Math.round((column + 1) * width / 7);
    let x0 = right, x1 = left, y0 = cuts[row + 1], y1 = cuts[row];
    for (let y = cuts[row]; y < cuts[row + 1]; y++) for (let x = left; x < right; x++) {
      if (data[(y * width + x) * 4 + 3] < 160) continue;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (x1 <= x0 || y1 <= y0) throw new Error(`${id}: empty frame ${row}/${column}`);
    frames.push({ row, column, left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
  }
  // One scale per character prevents frame-specific stretch or size pulses.
  const scale = Math.min(15 / Math.max(...frames.map(f => f.width)), 30 / Math.max(...frames.map(f => f.height)));
  const layers = [];
  const detailLayers = [];
  for (const frame of frames) {
    let input = sharp(source).extract({ left: frame.left, top: frame.top, width: frame.width, height: frame.height });
    // The generated whale profile faces left; native row three must face right.
    if (id === 'deepseek' && frame.row === 2) input = input.flop();
    const w = Math.max(1, Math.round(frame.width * scale)), h = Math.max(1, Math.round(frame.height * scale));
    const pixels = await input.resize(w, h, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer();
    // Native sprites are opaque pixel colors or transparent, never a glow fringe.
    for (let i = 3; i < pixels.length; i += 4) pixels[i] = pixels[i] >= 160 ? 255 : 0;
    const png = await sharp(pixels, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
    layers.push({ input: png, left: frame.column * 16 + Math.floor((16 - w) / 2), top: frame.row * 32 + 31 - h });
    const detailPixels = await input.clone().resize(w * 4, h * 4, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer();
    for (let i = 3; i < detailPixels.length; i += 4) detailPixels[i] = detailPixels[i] >= 160 ? 255 : 0;
    const detailPng = await sharp(detailPixels, { raw: { width: w * 4, height: h * 4, channels: 4 } }).png().toBuffer();
    detailLayers.push({ input: detailPng, left: (frame.column * 16 + Math.floor((16 - w) / 2)) * 4, top: (frame.row * 32 + 31 - h) * 4 });
  }
  await sharp({ create: { width: 112, height: 96, channels: 4, background: '#00000000' } }).composite(layers).png().toFile(resolve(output, `${id}.png`));
  await sharp({ create: { width: 448, height: 384, channels: 4, background: '#00000000' } }).composite(detailLayers).png().toFile(resolve(output, `${id}.detail.png`));
  // Keep a larger native-pixel contact sheet for visual inspection.
  await sharp(resolve(output, `${id}.png`)).resize(896, 768, { kernel: 'nearest' }).png().toFile(resolve(here, `${id}-frames.png`));
  report[id] = { sourceWidth: width, sourceHeight: height, rowCuts: cuts, scale, frames: frames.length, profileFlipped: id === 'deepseek' };
}
await writeFile(resolve(here, 'import-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log('Prepared 5 transparent atlases, 105 frames, fixed native 16x32 geometry.');
