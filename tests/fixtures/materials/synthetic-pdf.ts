/** Small PDF whose pages carry a real extractable text layer (base-14 Helvetica Tj ops). */
export function textPdf(pages: readonly (readonly string[])[], rotations?: readonly number[]): Buffer {
  const escape = (text: string): string => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const rotate = rotations ?? pages.map(() => 0);
  const stream = (dictionary: string, bytes: Uint8Array) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.byteLength} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const fontId = rotate.length + 3;
  const objects: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${rotate.map((_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${rotate.length} >>`,
    ...rotate.map((degree, i) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Rotate ${degree} /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${fontId + 1 + i} 0 R >>`),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ...pages.map(lines => stream('', Buffer.from(lines.map((line, index) => `BT /F1 14 Tf 40 ${360 - index * 22} Td (${escape(line)}) Tj ET`).join('\n')))),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')], offsets: number[] = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]));
  }
  const end = parts.reduce((total, part) => total + part.length, 0);
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${end}\n%%EOF\n`));
  return Buffer.concat(parts);
}

/** Small self-contained PDF with a real embedded raster and no OCR text layer. */
export function scannedPdf(jpeg: Uint8Array, width: number, height: number, rotations: readonly number[] = [0, 90]): Buffer {
  const content = Buffer.from(`q 200 0 0 100 0 0 cm /Im0 Do Q`);
  const stream = (dictionary: string, bytes: Uint8Array) => Buffer.concat([Buffer.from(`<< ${dictionary} /Length ${bytes.byteLength} >>\nstream\n`), bytes, Buffer.from('\nendstream')]);
  const objects: (string | Buffer)[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${rotations.map((_, i) => `${i + 3} 0 R`).join(' ')}] /Count ${rotations.length} >>`,
    ...rotations.map(rotate => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Rotate ${rotate} /Resources << /XObject << /Im0 ${rotations.length + 3} 0 R >> >> /Contents ${rotations.length + 4} 0 R >>`),
    stream(`/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, jpeg),
    stream('', content),
  ];
  const parts = [Buffer.from('%PDF-1.4\n')], offsets: number[] = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(parts.reduce((total, part) => total + part.length, 0));
    parts.push(Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]));
  }
  const end = parts.reduce((total, part) => total + part.length, 0);
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${end}\n%%EOF\n`));
  return Buffer.concat(parts);
}
