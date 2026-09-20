import { mkdir, symlink, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = await mkdtemp(join(tmpdir(), 'notara-vault-native-'));
const home = join(root, 'home'), workspace = join(root, 'workspace');
await Promise.all([mkdir(home, { recursive: true }), mkdir(workspace, { recursive: true })]);
await mkdir(join(workspace, 'node_modules/@notara'), { recursive: true });
await symlink(join(project, 'examples/native-vault'), join(workspace, 'node_modules/@notara/vault-native'));
await mkdir(join(home, 'profiles/web/node_modules/@notara'), { recursive: true });
await symlink(join(project, 'examples/native-vault'), join(home, 'profiles/web/node_modules/@notara/vault-native'));
await writeFile(join(home, 'settings.yaml'), 'ui-onboarding:\n  welcomeNoticeVersion: 2026-08-13.1\n');
await writeFile(join(home, 'cordis.patch.yml'), JSON.stringify([{ insert: [{ id: 'notara-vault-native', name: '@notara/vault-native' }] }]));
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' };
const child = spawn(process.execPath, [join(project, 'node_modules/.bin/dsh'), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
const collect = (chunk: Buffer): void => { output += chunk.toString(); process.stdout.write(chunk); };
child.stdout.on('data', collect); child.stderr.on('data', collect);
const stop = async (): Promise<void> => { if (child.exitCode === null) child.kill('SIGTERM'); await rm(root, { recursive: true, force: true }); };
process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
await new Promise<void>((resolveReady, reject) => {
  const timer = setInterval(() => { if (/dsh web: http/.test(output)) { clearInterval(timer); resolveReady(); } else if (child.exitCode !== null) { clearInterval(timer); reject(new Error(output)); } }, 50);
});
console.log(`隔离数据目录：${root}`);
