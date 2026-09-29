import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { win32 } from 'node:path';

/** What finding Git Bash may look at; the real probe asks Windows, tests pass a fake one. */
export interface GitBashProbe {
  env: Record<string, string | undefined>;
  exists(path: string): boolean;
  /** stdout of `git <args>`, or undefined when git is not on PATH. */
  git(args: string[]): string | undefined;
  /** The InstallPath value under a GitForWindows registry key, if any. */
  registry(key: string): string | undefined;
  /** stdout of `uname -s` run by that bash, or undefined when it does not start. */
  uname(bash: string): string | undefined;
}

export type GitBashResult = { path: string; checked: string[] } | { path?: undefined; checked: string[]; reason: string };

const REGISTRY_KEYS = ['HKLM\\SOFTWARE\\GitForWindows', 'HKCU\\SOFTWARE\\GitForWindows'];

/**
 * Git for Windows' bash for the teacher's shell. Its `bin\bash.exe` wrapper
 * puts the MSYS tools on PATH. Bash under System32 or WindowsApps is WSL's
 * launcher, never used; a candidate must also say it is MINGW or MSYS. The
 * order: NOTARA_GIT_BASH when set (only that), the git on PATH (whose exec
 * path is <root>\mingw64\libexec\git-core, which also sees through scoop's
 * shims), the installer's registry keys, then the usual install folders.
 */
export function findGitBash(probe: GitBashProbe): GitBashResult {
  const checked: string[] = [];
  const accept = (bash: string): string | undefined => {
    checked.push(bash);
    const lowered = bash.toLowerCase().replaceAll('/', '\\');
    if (lowered.includes('\\system32\\') || lowered.includes('\\windowsapps\\')) return undefined;
    if (!probe.exists(bash)) return undefined;
    return /^(MINGW|MSYS)/.test(probe.uname(bash)?.trim() ?? '') ? bash : undefined;
  };
  const explicit = probe.env.NOTARA_GIT_BASH;
  if (explicit) {
    const path = accept(explicit);
    return path ? { path, checked } : { checked, reason: `环境变量 NOTARA_GIT_BASH 指向的 ${explicit} 不是可用的 Git Bash（要指向 Git for Windows 安装目录下的 bin\\bash.exe）。` };
  }
  const roots: string[] = [];
  const exec = probe.git(['--exec-path'])?.trim();
  if (exec) roots.push(win32.resolve(exec, '..', '..', '..'));
  for (const key of REGISTRY_KEYS) { const value = probe.registry(key)?.trim(); if (value) roots.push(value); }
  for (const [base, tail] of [['ProgramFiles', 'Git'], ['ProgramFiles(x86)', 'Git'], ['LOCALAPPDATA', 'Programs\\Git'], ['USERPROFILE', 'scoop\\apps\\git\\current']] as const) {
    const value = probe.env[base];
    if (value) roots.push(win32.join(value, tail));
  }
  const seen = new Set<string>();
  for (const root of roots) {
    const bash = win32.join(root, 'bin', 'bash.exe');
    if (seen.has(bash.toLowerCase())) continue;
    seen.add(bash.toLowerCase());
    const path = accept(bash);
    if (path) return { path, checked };
  }
  return { checked, reason: `没有找到 Git Bash。请安装 Git for Windows（https://gitforwindows.org/）后重新打开终端，或者把 bash.exe 的完整路径写进环境变量 NOTARA_GIT_BASH。已检查：${checked.length ? checked.join('、') : '（没有候选位置）'}` };
}

/** The probe that asks this Windows machine. */
export function windowsProbe(): GitBashProbe {
  const output = (command: string, args: string[]): string | undefined => {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 10_000 });
    return result.status === 0 ? result.stdout : undefined;
  };
  return {
    env: process.env,
    exists: existsSync,
    git: args => output('git', args),
    registry: key => /InstallPath\s+REG_\w+\s+(.+)/.exec(output('reg', ['query', key, '/v', 'InstallPath']) ?? '')?.[1],
    uname: bash => output(bash, ['--noprofile', '--norc', '-c', 'uname -s']),
  };
}
