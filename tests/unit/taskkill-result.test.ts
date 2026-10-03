import { expect, test, vi } from 'vitest';
import { confirmTaskkillExited } from '../../scripts/taskkill-result.ts';

test('a nonzero taskkill result is accepted only after the root and every reported descendant exit', async () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
  try {
    expect(await confirmTaskkillExited(Object.assign(new Error('race'), { code: 1 }), 101, 'Terminated PID 101 (child of PID 999)', 'PID 102 (child of PID 101)')).toBe(true);
    expect(kill.mock.calls.map(call => call[0])).toEqual([101, 102]);
    expect(kill.mock.calls.every(call => call[1] === 0)).toBe(true);
    kill.mockClear();
    for (const error of [Object.assign(new Error('spawn'), { code: 'ENOENT' }), Object.assign(new Error('timeout'), { code: 1, killed: true })]) {
      expect(await confirmTaskkillExited(error, 101, '', 'PID 102')).toBe(false);
    }
    expect(await confirmTaskkillExited(Object.assign(new Error('failure'), { code: 1 }), 101, '', '')).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  } finally { kill.mockRestore(); }
});

test('an inaccessible or still-live descendant keeps Stop failed', async () => {
  let inaccessible = true;
  const kill = vi.spyOn(process, 'kill').mockImplementation(pid => {
    if (pid === 101) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
    if (inaccessible) throw Object.assign(new Error('cannot inspect sandbox'), { code: 'EPERM' });
    return true;
  });
  try {
    expect(await confirmTaskkillExited(Object.assign(new Error('failure'), { code: 1 }), 101, 'PID 101', 'PID 102')).toBe(false);
    inaccessible = false;
    expect(await confirmTaskkillExited(Object.assign(new Error('failure'), { code: 1 }), 101, 'PID 101', 'PID 102')).toBe(false);
  } finally { kill.mockRestore(); }
});
