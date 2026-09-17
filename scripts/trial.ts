import { resolve } from 'node:path';
import { startPersistent } from './dev-isolated.ts';

/** Persistent trial instance: `npm run trial [数据目录] [--port <n>]`.
 * Data lives in the given directory (default .trial/) and survives restarts;
 * the model provider is configured by the user in the web onboarding. */
const args = process.argv.slice(2);
const portAt = args.indexOf('--port');
const port = portAt >= 0 ? Number(args[portAt + 1]) : undefined;
const dir = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--port');
if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new Error(`bad --port: ${port}`);

const root = resolve(dir ?? '.trial');
const runtime = await startPersistent(root, { ...(port === undefined ? {} : { port }) });
console.log(`Notara 试用实例：${runtime.authUrl}`);
console.log(`数据目录：${root}（保留全部课堂与学习数据，可重复启动）`);
process.once('SIGINT', () => { void runtime.stop(); });
process.once('SIGTERM', () => { void runtime.stop(); });
