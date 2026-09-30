import { resolve } from 'node:path';
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
process.on('message', (message: unknown) => { if (message && typeof message === 'object' && 'type' in message && message.type === 'stop') void stop(); });
process.once('disconnect', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
