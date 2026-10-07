import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from 'vitest';

function waitForMessage(child: ChildProcess, expected: string): Promise<unknown> {
  return new Promise((resolveMessage, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${expected}.`)), 10_000);
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== 'object' || !('type' in message) || message.type !== expected) return;
      clearTimeout(timer);
      child.off('message', onMessage);
      resolveMessage(message);
    };
    child.on('message', onMessage);
    child.once('error', error => { clearTimeout(timer); reject(error); });
  });
}

test('vault-process handles a rejected runtime stop and exits without an unhandled rejection', async () => {
  const root = await mkdtemp(join(resolve('.'), '.notara-vault-process-stop-'));
  const script = resolve('scripts/vault-process.ts');
  const scriptUrl = pathToFileURL(script).href;
  const runner = join(root, 'run-vault-process.cjs');
  const stub = join(root, 'synthetic-runtime.mjs');
  const preload = join(root, 'intercept-vault-runtime.mjs');
  const unhandled = join(root, 'unhandled-rejection.txt');
  await writeFile(stub, `
import { writeFileSync } from 'node:fs';
process.on('unhandledRejection', error => writeFileSync(process.env.NOTARA_UNHANDLED_MARKER, String(error)));
export async function startVaultPersistent() {
  setInterval(() => {}, 1000);
  return { authUrl: 'http://127.0.0.1:57093/?token=synthetic', async stop() { throw new Error('synthetic runtime cleanup failure'); } };
}
`);
  // Import the real TypeScript entrypoint from a CommonJS fork runner. On
  // Windows, directly forking an ESM/TypeScript path can make Node 24 pass its
  // drive letter through the ESM loader as a URL scheme.
  await writeFile(runner, `import(process.env.NOTARA_VAULT_PROCESS_SOURCE).catch(error => { console.error(error); process.exit(1); });\n`);
  await writeFile(preload, `
import { registerHooks } from 'node:module';
const source = process.env.NOTARA_VAULT_PROCESS_SOURCE;
const replacement = process.env.NOTARA_VAULT_PROCESS_RUNTIME;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === './dev-native-vault.ts' && context.parentURL === source)
      return { url: replacement, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
`);

  const child = fork(runner, [root, '57093'], {
    cwd: resolve('.'),
    execArgv: ['--experimental-strip-types', '--import', pathToFileURL(preload).href],
    env: {
      ...process.env,
      NOTARA_UNHANDLED_MARKER: unhandled,
      NOTARA_VAULT_PROCESS_SOURCE: scriptUrl,
      NOTARA_VAULT_PROCESS_RUNTIME: pathToFileURL(stub).href,
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  child.stderr?.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  try {
    await waitForMessage(child, 'ready').catch(error => { throw new Error(`vault-process did not become ready; child stderr: ${stderr}`, { cause: error }); });
    child.send({ type: 'stop' });
    const [code] = await new Promise<[number | null, NodeJS.Signals | null]>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (exitCode, signal) => resolveExit([exitCode, signal]));
    });
    expect(code).toBe(1);
    expect(stderr).toContain('Notara Vault cleanup failed: synthetic runtime cleanup failure');
    await expect(readFile(unhandled, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
