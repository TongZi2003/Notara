import { expect, test } from 'vitest';
import { readAppearance } from '../../packages/client/src/theme/appearance.ts';
test('new and formerly disabled/soft appearances use modern; original notebooks retain their style', () => {
  expect(readAppearance(null).style).toBe('modern');
  expect(readAppearance({ enabled: true }).style).toBe('notebook');
  expect(readAppearance({ style: 'notebook' }).style).toBe('notebook');
  expect(readAppearance({ style: 'soft' }).style).toBe('modern');
  expect(readAppearance({ style: 'notebook', enabled: false }).style).toBe('modern');
});
test('theme switches preserve dormant paper settings, but invalid values cannot add a third style', () => {
  const paper = readAppearance({ style: 'notebook', tone: 'white', scheme: 'bing', paper: 'fangge', size: 'l' });
  const modern = readAppearance({ ...paper, style: 'modern' });
  expect(readAppearance({ ...modern, style: 'notebook' })).toEqual(paper);
  expect(readAppearance({ style: 'other', size: 'huge', paper: '<bad>' })).toMatchObject({ style: 'modern', size: 'm', paper: 'hengxian' });
});
