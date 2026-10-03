import { setTimeout as delay } from 'node:timers/promises';

export interface VaultRecoveryPolicy {
  maxRestarts: number;
  windowMs: number;
  delaysMs: readonly number[];
}

export interface VaultRecoveryStatus {
  phase: 'ready' | 'recovering' | 'failed';
  restarts: number;
  error?: 'stop_failed' | 'restart_failed' | 'restart_limit';
}

interface RecoveryOperations {
  /** Throws when liveness is uncertain; false must mean definitely absent. */
  alive(): Promise<boolean>;
  paused(): boolean;
  stopWorker(): Promise<void>;
  startWorker(signal: AbortSignal): Promise<void>;
  report(event: 'unexpected_stop' | 'recovered' | 'recovery_failed', status: VaultRecoveryStatus): Promise<void>;
}

const defaultPolicy: VaultRecoveryPolicy = { maxRestarts: 3, windowMs: 10 * 60_000, delaysMs: [1000, 3000, 5000] };

export function validateVaultRecoveryPolicy(policy: VaultRecoveryPolicy = defaultPolicy): void {
  if (!Number.isInteger(policy.maxRestarts) || policy.maxRestarts < 1 || !Number.isFinite(policy.windowMs) || policy.windowMs <= 0 ||
      !policy.delaysMs.length || policy.delaysMs.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid Vault recovery policy');
}

/** Owns only recovery of an already-started Vault. It cannot keep its own
 * parent process alive, and never replaces a service on an ambiguous probe. */
export class VaultRecovery {
  private state: VaultRecoveryStatus = { phase: 'ready', restarts: 0 };
  private readonly restartTimes: number[] = [];
  private pending: Promise<void> | undefined;
  private cancellation = new AbortController();
  private closed = false;
  private readonly operations: RecoveryOperations;
  private readonly policy: VaultRecoveryPolicy;
  constructor(operations: RecoveryOperations, policy: VaultRecoveryPolicy = defaultPolicy) {
    this.operations = operations; this.policy = policy;
    validateVaultRecoveryPolicy(policy);
  }
  status(): VaultRecoveryStatus { return { ...this.state }; }
  check(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.closed || this.operations.paused() || this.state.phase === 'failed') return Promise.resolve();
    const signal = this.cancellation.signal;
    this.pending = this.inspect(signal).finally(() => { this.pending = undefined; });
    return this.pending;
  }
  /** Stop/update cancels backoff and waits for any owned cleanup/start to
   * settle before the caller can change files or launch another worker. */
  async suspend(): Promise<void> {
    this.cancellation.abort();
    await this.pending;
    if (!this.closed) this.cancellation = new AbortController();
  }
  requestClose(): void { this.closed = true; this.cancellation.abort(); }
  async close(): Promise<void> { this.requestClose(); await this.suspend(); }
  private async report(event: Parameters<RecoveryOperations['report']>[0]): Promise<void> {
    try { await this.operations.report(event, this.status()); } catch { /* Logging must not create an unhandled rejection. */ }
  }
  private async inspect(signal: AbortSignal): Promise<void> {
    const cancelled = (): boolean => signal.aborted || this.closed || this.operations.paused();
    let alive: boolean;
    try { alive = await this.operations.alive(); } catch { return; }
    if (alive || cancelled()) return;
    const now = Date.now();
    while (this.restartTimes.length && this.restartTimes[0]! <= now - this.policy.windowMs) this.restartTimes.shift();
    if (this.restartTimes.length >= this.policy.maxRestarts) {
      this.state = { phase: 'failed', restarts: this.restartTimes.length, error: 'restart_limit' };
      await this.report('recovery_failed'); return;
    }
    this.state = { phase: 'recovering', restarts: this.restartTimes.length };
    await this.report('unexpected_stop');
    if (cancelled()) { this.state = { phase: 'ready', restarts: this.restartTimes.length }; return; }
    try { await this.operations.stopWorker(); }
    catch { this.state = { phase: 'failed', restarts: this.restartTimes.length, error: 'stop_failed' }; await this.report('recovery_failed'); return; }
    const wait = this.policy.delaysMs[Math.min(this.restartTimes.length, this.policy.delaysMs.length - 1)]!;
    try { await delay(wait, undefined, { signal }); }
    catch { this.state = { phase: 'ready', restarts: this.restartTimes.length }; return; }
    if (cancelled()) { this.state = { phase: 'ready', restarts: this.restartTimes.length }; return; }
    this.restartTimes.push(Date.now());
    try { await this.operations.startWorker(signal); }
    catch {
      this.state = { phase: cancelled() ? 'ready' : 'failed', restarts: this.restartTimes.length, ...(!cancelled() ? { error: 'restart_failed' as const } : {}) };
      if (!cancelled()) await this.report('recovery_failed'); return;
    }
    this.state = { phase: 'ready', restarts: this.restartTimes.length };
    if (!cancelled()) await this.report('recovered');
  }
}
