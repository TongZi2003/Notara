import { expect, test, vi } from 'vitest';
import { VaultRecovery } from '../../scripts/vault-recovery.ts';

const policy = { maxRestarts: 3, windowMs: 10_000, delaysMs: [0] };
function setup() {
  let alive = true, paused = false;
  const aliveProbe = vi.fn(async () => alive);
  const stop = vi.fn(async () => {}), start = vi.fn(async () => { alive = true; });
  const report = vi.fn(async () => {});
  const recovery = new VaultRecovery({ alive: aliveProbe, paused: () => paused, stopWorker: stop, startWorker: start, report }, policy);
  return { recovery, stop, start, report, aliveProbe, dead: () => { alive = false; }, pause: () => { paused = true; } };
}

test('an idle healthy service stays running without being replaced', async () => {
  const f = setup(); await f.recovery.check(); await f.recovery.check();
  expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
  await f.recovery.close();
});

test('concurrent missing-service checks stop the old worker once before one replacement', async () => {
  const f = setup(); f.dead();
  const order: string[] = [];
  f.stop.mockImplementation(async () => { order.push('stop'); });
  f.start.mockImplementation(async () => { order.push('start'); });
  await Promise.all([f.recovery.check(), f.recovery.check(), f.recovery.check()]);
  expect(order).toEqual(['stop', 'start']); expect(f.recovery.status()).toEqual({ phase: 'ready', restarts: 1 });
  await f.recovery.close();
});

test('auth, I/O or timeout uncertainty never authorizes replacement', async () => {
  const f = setup(); f.aliveProbe.mockRejectedValue(new Error('uncertain liveness'));
  await f.recovery.check(); expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
  expect(f.recovery.status().phase).toBe('ready'); await f.recovery.close();
});

test('Stop cancels an already starting replacement instead of waiting for its readiness timeout', async () => {
  let started!: () => void;
  const entered = new Promise<void>(done => { started = done; });
  const recovery = new VaultRecovery({
    alive: async () => false, paused: () => false, stopWorker: async () => {}, report: async () => {},
    startWorker: signal => new Promise<void>((_done, reject) => { started(); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }); }),
  }, policy);
  const checking = recovery.check(); await entered;
  await recovery.close(); await checking;
  expect(recovery.status().phase).toBe('ready');
  await recovery.check(); expect(recovery.status().restarts).toBe(1);
});

test('three crashes in the time window are recoverable but a fourth stops the loop', async () => {
  const f = setup();
  for (let i = 0; i < 4; i++) { f.dead(); await f.recovery.check(); }
  expect(f.start).toHaveBeenCalledTimes(3);
  expect(f.recovery.status()).toEqual({ phase: 'failed', restarts: 3, error: 'restart_limit' });
  await f.recovery.check(); expect(f.start).toHaveBeenCalledTimes(3); await f.recovery.close();
});

test('old crashes expire instead of exhausting recovery forever', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
  const f = setup();
  try {
    for (let i = 0; i < 3; i++) { f.dead(); await f.recovery.check(); }
    clock.mockReturnValue(20_001); f.dead(); await f.recovery.check();
    expect(f.start).toHaveBeenCalledTimes(4); expect(f.recovery.status()).toEqual({ phase: 'ready', restarts: 1 });
  } finally { await f.recovery.close(); clock.mockRestore(); }
});

test('cleanup failure preserves ownership and refuses to launch a duplicate', async () => {
  const f = setup(); f.dead(); f.stop.mockRejectedValue(new Error('still owned'));
  await f.recovery.check(); expect(f.start).not.toHaveBeenCalled();
  expect(f.recovery.status()).toEqual({ phase: 'failed', restarts: 0, error: 'stop_failed' }); await f.recovery.close();
});

test('replacement startup failure remains visible without repeated automatic retries', async () => {
  const f = setup(); f.dead(); f.start.mockRejectedValue(new Error('boot failed'));
  await f.recovery.check(); await f.recovery.check(); expect(f.start).toHaveBeenCalledTimes(1);
  expect(f.recovery.status()).toEqual({ phase: 'failed', restarts: 1, error: 'restart_failed' }); await f.recovery.close();
});

test('normal Stop during cleanup waits for cleanup and cancels the replacement', async () => {
  const f = setup(); f.dead();
  let release!: () => void;
  f.stop.mockImplementation(() => new Promise<void>(done => { release = done; }));
  const checking = f.recovery.check();
  await vi.waitFor(() => expect(f.stop).toHaveBeenCalledOnce());
  const closing = f.recovery.close(); release(); await Promise.all([checking, closing]);
  expect(f.start).not.toHaveBeenCalled(); await f.recovery.check(); expect(f.start).not.toHaveBeenCalled();
});

test('update during pending liveness detection prevents recovery for the whole switch', async () => {
  const f = setup();
  let finishProbe!: (value: boolean) => void;
  f.aliveProbe.mockImplementation(() => new Promise<boolean>(done => { finishProbe = done; }));
  const checking = f.recovery.check(); f.pause(); finishProbe(false); await checking;
  await f.recovery.check(); expect(f.stop).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled(); await f.recovery.close();
});

test('log errors do not prevent safe recovery or become unhandled rejections', async () => {
  const f = setup(); f.dead(); f.report.mockRejectedValue(new Error('log unavailable'));
  await f.recovery.check(); expect(f.start).toHaveBeenCalledOnce(); expect(f.recovery.status().phase).toBe('ready'); await f.recovery.close();
});
