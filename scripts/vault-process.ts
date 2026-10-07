import { resolve } from 'node:path';
import { writeSync } from 'node:fs';
import { startVaultPersistent } from './dev-native-vault.ts';

const root = resolve(process.argv[2]!);
const port = Number(process.argv[3]);
const runtime = await startVaultPersistent(root, { ...(Number.isFinite(port) ? { port } : {}) });
process.send?.({ type: 'ready', authUrl: runtime.authUrl });
let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return; stopping = true;
  await runtime.stop(); if (process.connected) process.disconnect();
}
function requestStop(): void {
  void stop().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    writeSync(2, `Notara Vault cleanup failed: ${message}\n`);
    // The supervisor owns recovery from an unsuccessful stop. Exit explicitly
    // so this IPC worker cannot become an unobserved orphan with open handles.
    process.exit(1);
  });
}
process.on('message', (message: unknown) => { if (message && typeof message === 'object' && 'type' in message && message.type === 'stop') requestStop(); });
process.once('disconnect', requestStop);
process.once('SIGINT', requestStop);
process.once('SIGTERM', requestStop);
