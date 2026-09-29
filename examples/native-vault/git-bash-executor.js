import { SandboxBashExecutor } from '@deepseek-ai/dsh-bash-sandbox';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * The teacher's Bash on Windows, run by Git for Windows' bash instead of the
 * PowerShell the native win32 layer mounts. It is the native sandboxed bash
 * executor with two changes: the program is the absolute Git Bash path the
 * launcher found (never whatever `bash` the search order reaches first, which
 * is WSL's on a default PATH), and each command is written to a private script
 * file run as `bash --noprofile --norc <file>`, which keeps long commands under
 * the 32767-character command line and away from Windows quoting rules. The
 * native `ctx.sandbox` still confines it (the windows-acl runner on Windows);
 * approval, output limits and timeouts are the native executor's own.
 *
 * The launcher passes the path in NOTARA_GIT_BASH: the shell settings schema
 * owns this plugin's config and would drop a key it does not know.
 */
export const GIT_BASH_ENV = Object.freeze({
  // Arguments such as /pattern/ or /c/... stay as written; paths reach the
  // teacher as C:/... already, which node, rg and bash all accept.
  MSYS_NO_PATHCONV: '1',
  MSYS2_ARG_CONV_EXCL: '*',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  // A Windows Python writes pipes in the ANSI code page unless told otherwise.
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
});

/** The exact program and arguments for one command already written to `script`. */
export function gitBashArgv(bashPath, script) {
  return [bashPath, '--noprofile', '--norc', script.replaceAll('\\', '/')];
}

export default class GitBashExecutor extends SandboxBashExecutor {
  constructor(ctx, config) {
    super(ctx, config);
    const bashPath = process.env.NOTARA_GIT_BASH;
    if (!bashPath) throw new Error('notara-git-bash: NOTARA_GIT_BASH is not set; the launcher sets it after finding Git Bash');
    this.bashPath = bashPath;
    this.scripts = join(tmpdir(), 'notara-git-bash');
  }

  /** One private script per command, removed when the command settles. */
  writeScript(command) {
    mkdirSync(this.scripts, { recursive: true, mode: 0o700 });
    const path = join(this.scripts, `${randomUUID()}.sh`);
    writeFileSync(path, command, { encoding: 'utf8', mode: 0o600 });
    return path;
  }

  // The native sandboxed path hands `spec.command` only to confine(); passing the
  // script path there lets the confined runner execute the file, not the source.
  confine(script, policy, signal) {
    return this.ctx.sandbox.confine(gitBashArgv(this.bashPath, script), policy, signal);
  }

  /**
   * DSH 0.2.0 has one entry point, `execute(spec)`. Full access runs Git Bash
   * directly through the native argv path (never `bash -c` from PATH, which on
   * Windows is WSL's); every other mode goes through the native sandboxed
   * execute with the script path as its command. The script is removed once
   * the process settles, whatever the outcome.
   */
  async execute(spec) {
    const script = this.writeScript(spec.command);
    let execution;
    try {
      execution = spec.sandboxPolicy?.mode === 'danger-full-access'
        ? SandboxBashExecutor.decorateResult(await this.executeArgv(spec, gitBashArgv(this.bashPath, script)), result => ({ ...result, sandbox: { mode: 'danger-full-access', denied: false } }))
        : await super.execute({ ...spec, command: script });
    } catch (error) { rmSync(script, { force: true }); throw error; }
    void Promise.resolve(execution.done).catch(() => {}).finally(() => rmSync(script, { force: true }));
    return execution;
  }

  spawnSpec(spec, argv, stdoutMaxBytes, signal) {
    const spawn = super.spawnSpec(spec, argv, stdoutMaxBytes, signal);
    return { ...spawn, env: { ...GIT_BASH_ENV, ...spawn.env } };
  }
}
