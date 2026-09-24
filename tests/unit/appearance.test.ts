import { expect, test } from 'vitest';
import { readAppearance } from '../../packages/client/src/theme/appearance.ts';
test('all saved appearances use the released minimal style', () => {
  expect(readAppearance(null).style).toBe('modern');
  expect(readAppearance(null).face).toBe('hand');
  expect(readAppearance({ face: 'print' }).face).toBe('print');
  expect(readAppearance({ enabled: true }).style).toBe('modern');
  expect(readAppearance({ style: 'notebook' }).style).toBe('modern');
  expect(readAppearance({ style: 'soft' }).style).toBe('modern');
  expect(readAppearance({ style: 'notebook', enabled: false }).style).toBe('modern');
});
test('dormant paper settings are preserved without enabling the unfinished style', () => {
  const paper = readAppearance({ style: 'notebook', tone: 'white', scheme: 'bing', paper: 'fangge', size: 'l' });
  const modern = readAppearance({ ...paper, style: 'modern' });
  expect(readAppearance({ ...modern, style: 'notebook' })).toEqual(paper);
  expect(readAppearance({ style: 'other', size: 'huge', paper: '<bad>' })).toMatchObject({ style: 'modern', size: 'm', paper: 'hengxian' });
});
