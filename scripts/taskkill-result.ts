import { setTimeout as delay } from 'node:timers/promises';

function exited(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}

/** taskkill can lose a race with Windows sandbox/job teardown. Accept its
 * nonzero result only when every target PID it reported, and our owned root, is gone.
 * An inaccessible or reused PID is conservatively treated as still alive. */
export async function confirmTaskkillExited(error: { code?: string | number | null | undefined; killed?: boolean | undefined }, rootPid: number, stdout: string, stderr: string): Promise<boolean> {
  if (typeof error.code !== 'number' || error.killed || !Number.isSafeInteger(rootPid) || rootPid <= 0) return false;
  // Each result line names its target first, followed by its parent. The root's
  // parent is our still-running controller and must never be treated as a
  // descendant that taskkill should stop.
  const reported = `${stdout}\n${stderr}`.split(/\r?\n/).flatMap(line => {
    const match = /\bPID\s+(\d+)\b/i.exec(line);
    return match ? [Number(match[1])] : [];
  });
  if (!reported.length || reported.some(pid => !Number.isSafeInteger(pid) || pid <= 0)) return false;
  const pids = [...new Set([rootPid, ...reported])];
  for (let attempt = 0; ; attempt++) {
    if (pids.every(exited)) return true;
    if (attempt === 10) return false;
    await delay(100);
  }
}
