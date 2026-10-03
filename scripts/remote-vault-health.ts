import { liveVaultUrl } from './vault-launcher-state.ts';

/** A failed liveness check is not evidence that it is safe to replace a
 * service. Only an explicitly missing live URL, outside startup/update/stop,
 * can trigger owned-resource cleanup. Re-check after the asynchronous probe. */
export async function readyVaultHasStopped(
  runtimeRoot: string,
  context: () => { phase: string; updating: boolean },
  probe: typeof liveVaultUrl = liveVaultUrl,
): Promise<boolean> {
  const ready = (): boolean => { const state = context(); return state.phase === 'ready' && !state.updating; };
  if (!ready()) return false;
  const login = await probe(runtimeRoot);
  return login === undefined && ready();
}
