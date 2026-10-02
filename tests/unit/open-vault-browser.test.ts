import { EventEmitter } from 'node:events';
import { afterEach, expect, test, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { openVaultBrowser } from '../../scripts/open-vault-browser.ts';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => vi.resetAllMocks());

test('the authenticated browser entry remains a single argument and does not keep the launcher alive', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockImplementation(() => { queueMicrotask(() => child.emit('spawn')); return child as unknown as ReturnType<typeof spawn>; });
  const url = 'http://127.0.0.1:12345/?token=synthetic-test-token&next=%2F';
  await openVaultBrowser(url);
  const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
  expect(args).toContain(url);
  expect(command).not.toContain(url);
  expect(options).toMatchObject({ stdio: 'ignore', windowsHide: true });
  expect(options?.shell).not.toBe(true);
  expect(child.unref).toHaveBeenCalledOnce();
});

test('browser startup failure is actionable and does not expose the login credential', async () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  vi.mocked(spawn).mockImplementation(() => { queueMicrotask(() => child.emit('error', new Error('synthetic launcher failure'))); return child as unknown as ReturnType<typeof spawn>; });
  const result = openVaultBrowser('http://127.0.0.1:12345/?token=private-test-token');
  await expect(result).rejects.toThrow('npm run vault:open');
  await expect(result).rejects.not.toThrow('private-test-token');
});
