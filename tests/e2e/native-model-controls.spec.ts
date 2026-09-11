import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, enterClassroom, sendInput } from './fixtures/classroom.ts';

/** The native model control's accessible name, whichever locale the app boots in. */
const MODEL_TRIGGER = /^(Select model|选择模型)/;
const MODEL_CELL = /^(Model|模型)/;
const EFFORT_CELL = /^(Effort|推理)/;

interface RequestRow {
  readonly purpose?: string;
  readonly provider: string;
  readonly model: string;
  readonly reasoningEffort?: unknown;
  readonly messages: readonly { readonly role: string; readonly content?: readonly unknown[] }[];
}

async function requests(root: string): Promise<RequestRow[]> {
  const text = await readFile(join(root, 'model-requests.jsonl'), 'utf8');
  return text.trim().split('\n').map(line => JSON.parse(line) as RequestRow);
}

test('native model and effort controls choose the real provider route for the lesson request', async ({ page, classroom }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterClassroom(page, classroom.authUrl);

  // The model control is the native one, and this client adds no second copy.
  const trigger = page.getByRole('button', { name: MODEL_TRIGGER });
  await expect(trigger).toHaveCount(1);
  await expect(trigger).toHaveAttribute('aria-label', /study-model-a/);
  await expect(trigger).toHaveAttribute('aria-label', /(简短|low)/);

  // The adapter's two models are the native menu's real content.
  await trigger.click();
  await page.getByRole('menuitem', { name: MODEL_CELL }).click();
  const modelA = page.getByRole('menuitemradio', { name: 'study-model-a', exact: true });
  const modelB = page.getByRole('menuitemradio', { name: 'study-model-b', exact: true });
  await expect(modelA).toHaveAttribute('aria-checked', 'true');
  await modelB.click();
  await expect(trigger).toHaveAttribute('aria-label', /study-model-b/);

  // study-model-b carries no reasoning capability, so the native menu offers no effort row.
  await trigger.click();
  await expect(page.getByRole('menuitem', { name: EFFORT_CELL })).toHaveCount(0);
  await page.getByRole('menuitem', { name: MODEL_CELL }).click();
  await modelA.click();
  await expect(trigger).toHaveAttribute('aria-label', /study-model-a/);

  // study-model-a's declared efforts come from the adapter, not from this client.
  await trigger.click();
  await page.getByRole('menuitem', { name: EFFORT_CELL }).click();
  await expect(page.getByRole('menuitemradio', { name: '简短' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: '充分' }).click();
  await expect(trigger).toHaveAttribute('aria-label', /充分|high/);

  await sendInput(page, '请讲解一次函数');
  await expect.poll(async () => existsSync(join(classroom.root, 'model-requests.jsonl')), { timeout: 30_000 }).toBe(true);
  const rows = await requests(classroom.root);
  const answer = rows.filter(row => row.purpose !== 'session-title').at(-1);
  expect(answer?.provider).toBe('studyforge-test');
  expect(answer?.model).toBe('study-model-a');
  expect(String(answer?.reasoningEffort)).toContain('high');
  expect(errors).toEqual([]);
});
