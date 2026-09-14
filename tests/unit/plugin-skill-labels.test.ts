import { expect, test } from 'vitest';
import { displaySkillReferences } from '../../packages/client/src/plugins/skill-labels.ts';
test('only native-confirmed skill references display titles, without modifying source text', () => {
  const id = 'notara-0123456789abcdef01234567-0123456789abcdef-quiz';
  const original = [{ type: 'text', text: '出一道题\n/' + id }];
  expect(displaySkillReferences(original, [], { [id]: '出一组题' }).content).toEqual(original);
  const display = displaySkillReferences(original, [id], { [id]: '出一组题' });
  expect(display.content[0]?.text).toBe('出一道题'); expect(display.titles).toEqual(['出一组题']);
  expect(original[0]?.text).toContain(id);
  expect(displaySkillReferences([{type:'text',text:'path/' + id}], [id], {[id]:'出题'}).titles).toEqual([]);
});
