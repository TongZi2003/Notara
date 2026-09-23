import { startVaultIsolated } from './dev-isolated.ts';
const runtime = await startVaultIsolated({ pixelClassroom: true, testModel: true });
console.log(`DSH 教室像素视图：${new URL(runtime.authUrl).origin}/\n隔离验证目录：${runtime.root}\n已接入 DSH 课堂状态；此隔离实例使用合成模型，不调用付费模型。登录入口保存在此目录的 launcher.json。`);
let stopping = false;
const stop = async () => { if (stopping) return; stopping = true; await runtime.stop(); };
process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
