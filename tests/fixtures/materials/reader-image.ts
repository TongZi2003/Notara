import { createCanvas } from '@napi-rs/canvas';

/** Legible synthetic classroom original for reader layout and orientation checks. */
export function readerImage(format: 'png' | 'jpeg' = 'png'): Buffer {
  const canvas = createCanvas(900, 560), context = canvas.getContext('2d');
  // A CJK-capable family with the maths marks this page uses (−, ²): the
  // generic `sans-serif` has no Han glyphs here, and Hiragino Sans GB alone
  // drops the minus and the square, so both would read as tofu boxes.
  const han = '"Arial Unicode MS", "Hiragino Sans GB", "Heiti SC", "Noto Sans CJK SC", sans-serif';
  const font = (size: number) => `${String(size)}px ${han}`;
  context.fillStyle = '#fffef9'; context.fillRect(0, 0, 900, 560);
  context.fillStyle = '#213c63'; context.font = font(32);
  context.fillText('函数与图像 · 例题', 45, 58);
  context.font = font(23);
  context.fillText('已知 f(x) = (x − 1)²，观察图像的顶点与对称轴。', 45, 110);
  context.fillStyle = '#5a6578'; context.font = font(19);
  context.fillText('先标出顶点，再说明 x 改变时 y 怎样变化。', 45, 151);
  const point = (x: number, y: number) => [450 + x * 90, 460 - y * 60] as const;
  context.strokeStyle = '#8391a2'; context.lineWidth = 1.5;
  context.beginPath(); context.moveTo(180, 460); context.lineTo(760, 460); context.moveTo(450, 485); context.lineTo(450, 180); context.stroke();
  context.setLineDash([7, 6]); context.beginPath(); context.moveTo(540, 190); context.lineTo(540, 460); context.stroke(); context.setLineDash([]);
  context.strokeStyle = '#2555ad'; context.lineWidth = 4; context.beginPath();
  for (let index = 0; index <= 160; index++) { const x = -1 + 4 * index / 160, [px, py] = point(x, (x - 1) ** 2); if (index === 0) context.moveTo(px, py); else context.lineTo(px, py); }
  context.stroke(); context.fillStyle = '#b54336'; context.beginPath(); context.arc(540, 460, 6, 0, 2 * Math.PI); context.fill();
  context.font = font(18); context.fillStyle = '#213c63'; context.fillText('(1, 0)', 553, 448); context.fillText('y', 430, 185); context.fillText('x', 765, 470);
  context.fillStyle = '#6c7580'; context.fillText('印刷页 7', 760, 528);
  return format === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer('image/jpeg');
}
