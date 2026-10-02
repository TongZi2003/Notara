import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox';
import { mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createCliWriteBroker } from './cli-write-broker.js';

export const WINDOWS_POSIX_ENV = Object.freeze({
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
});

/** Native BusyBox ash receives a script file, avoiding Windows command-line limits. */
export function windowsPosixArgv(executable, script) {
  return [executable, 'ash', script.replaceAll('\\', '/')];
}

/**
 * The Windows teacher's POSIX shell, confined by the unchanged native sandbox.
 * The launcher selects and verifies the executable; this provider is mounted
 * only in the teacher's isolated shell realm, leaving the Host's PowerShell alone.
 */
export default class WindowsPosixExecutor extends SandboxBashExecutor {
  constructor(ctx, config) {
    super(ctx, config);
    const executable = process.env.NOTARA_WINDOWS_POSIX;
    if (!executable || !isAbsolute(executable)) throw new Error('notara-windows-posix: NOTARA_WINDOWS_POSIX must name the verified absolute BusyBox executable');
    this.executable = executable;
    this.scripts = join(tmpdir(), 'notara-windows-posix');
  }

  /** Optional per-call preparation. Its resources are disposed before settlement is exposed. */
  async prepareCommand(spec) {
    const broker = await createCliWriteBroker(spec);
    return { command: spec.command, env: broker.env, dispose: () => broker.close() };
  }

  writeScript(command) {
    mkdirSync(this.scripts, { recursive: true, mode: 0o700 });
    const directory = mkdtempSync(join(this.scripts, 'call-'));
    const script = join(directory, 'command.sh');
    try {
      writeFileSync(script, command, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      return script;
    } catch (error) {
      rmSync(script, { force: true });
      rmdirSync(directory);
      throw error;
    }
  }

  confine(script, policy, signal) {
    return this.ctx.sandbox.confine(windowsPosixArgv(this.executable, script), policy, signal);
  }

  async execute(spec) {
    let prepared, script, execution;
    let cleanupError;
    const rememberCleanupError = error => {
      cleanupError ??= new Error('notara-windows-posix: per-call resource cleanup failed', { cause: error });
    };
    const cleanup = async () => {
      // Per-call capabilities must be revoked, then drained, before a result
      // or background completion can claim that all of this call has settled.
      try { await prepared?.dispose?.(); }
      catch (error) { rememberCleanupError(error); }
      try {
        if (script) {
          rmSync(script, { force: true });
          rmdirSync(dirname(script));
        }
      } catch (error) { rememberCleanupError(error); }
    };
    try {
      spec.signal?.throwIfAborted();
      prepared = await this.prepareCommand(spec);
      spec.signal?.throwIfAborted();
      script = this.writeScript(prepared.command ?? spec.command);
      const commandSpec = { ...spec, dshEnv: { ...spec.dshEnv, ...prepared.env } };
      execution = spec.sandboxPolicy?.mode === 'danger-full-access'
        ? SandboxBashExecutor.decorateResult(await this.executeArgv(commandSpec, windowsPosixArgv(this.executable, script)), result => ({ ...result, sandbox: { mode: 'danger-full-access', denied: false } }))
        : await super.execute({ ...commandSpec, command: script });
    } catch (error) {
      await cleanup();
      throw error;
    }
    const nativeResult = execution.result.bind(execution);
    const nativeStderr = execution.observed.stderr;
    const nativeReadOutput = execution.readOutput.bind(execution);
    let diagnostic = Buffer.alloc(0), diagnosticOffset, diagnosticConsumed = false;
    // Background jobs consume the live handle and observed streams, without
    // calling result(). Report cleanup failures there as well, while retaining
    // the native never-rejecting done contract and genuine signal-kill facts.
    execution.observed = { ...execution.observed, stderr: { readFrom(fromByte) {
      const read = nativeStderr.readFrom(fromByte);
      if (!diagnostic.length) return read;
      return { ...read, text: read.text + diagnostic.subarray(Math.max(0, fromByte - diagnosticOffset)).toString('utf8'), nextOffset: diagnosticOffset + diagnostic.length };
    } } };
    execution.readOutput = () => {
      const read = nativeReadOutput();
      if (!diagnostic.length || diagnosticConsumed) return read;
      diagnosticConsumed = true;
      return { ...read, delta: `${read.delta}${read.delta && !read.delta.endsWith('\n') ? '\n' : ''}[stderr]\n${diagnostic.toString('utf8').trimStart()}` };
    };
    const settle = async () => {
      await cleanup();
      if (cleanupError) {
        try { diagnosticOffset = nativeStderr.readFrom(0).nextOffset; }
        catch { diagnosticOffset = 0; }
        diagnostic = Buffer.from(`\n${cleanupError.message}\n`, 'utf8');
        if (execution.status === 'completed' && execution.exitCode === 0) execution.exitCode = 1;
      }
    };
    execution.done = Promise.resolve(execution.done).then(settle, settle);
    let result;
    execution.result = () => result ??= nativeResult().then(async value => {
      await execution.done;
      if (cleanupError) throw cleanupError;
      return value;
    }, async error => {
      await execution.done;
      throw error;
    });
    return execution;
  }

  spawnSpec(spec, argv, stdoutMaxBytes, signal) {
    const spawn = super.spawnSpec(spec, argv, stdoutMaxBytes, signal);
    return { ...spawn, env: { ...WINDOWS_POSIX_ENV, ...spawn.env, BB_OVERRIDE_APPLETS: '' } };
  }
}
