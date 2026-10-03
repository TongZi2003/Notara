/** Host-only access to the launcher; its private address and token never reach the browser. */
const launcherCredentials = { url: process.env.NOTARA_UPDATE_URL, token: process.env.NOTARA_UPDATE_TOKEN };
delete process.env.NOTARA_UPDATE_URL;
delete process.env.NOTARA_UPDATE_TOKEN;
export function createUpdateBridge(ctx, { url = launcherCredentials.url, token = launcherCredentials.token } = {}, fetcher = fetch) {
  if (url && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !token)) throw new Error('更新服务配置无效。');
  let updating = false;
  let closing = false;
  const unsupported = { phase: 'unsupported', message: '请通过 npm run vault 启动，才能检查和安装更新。' };
  const call = async action => {
    if (!url || !token) return unsupported;
    const response = await fetcher(`${url}/${action}`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.message ?? '更新服务暂时不可用。');
    if (action === 'status' && value.phase !== 'restarting') updating = false;
    return value;
  };
  return {
    status: () => call('status'), check: () => call('check'),
    get updating() { return updating || closing; },
    async shutdown() {
      if (!url || !token) throw new Error('当前启动方式不支持从页面关闭，请回到启动终端按 Ctrl+C。');
      closing = true;
      try { return await call('shutdown'); } catch (error) { closing = false; throw error; }
    },
    async apply() {
      if (!url || !token) throw new Error('当前启动器不支持更新，请通过 npm run vault 启动。');
      const agents = ctx.get('agents')?.list?.();
      if (!Array.isArray(agents)) throw new Error('暂时无法确认课堂状态，请稍后重试。');
      const busy = agents.some(agent => agent.status === 'running') || ctx.get('jobs')?.list?.().some(job => job.status === 'running' || job.status === 'stopping');
      if (busy) throw new Error('课堂或后台任务还在进行，请等结束后再更新。');
      updating = true;
      try { return await call('apply'); } catch (error) { updating = false; throw error; }
    },
  };
}

export function installUpdateBridge(ctx) {
  const bridge = createUpdateBridge(ctx);
  ctx.reflect.provide('notaraUpdates', bridge);
  // A new message is still persisted by DSH; it cannot start a model request
  // in the small interval between accepting an update and stopping the Host.
  ctx.on('agent/pre-step', async (input, next) => bridge.updating ? { kind: 'reject' } : next(input));
}
