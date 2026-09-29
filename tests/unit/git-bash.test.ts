import { describe, expect, it } from 'vitest';
import { findGitBash, type GitBashProbe } from '../../scripts/git-bash.ts';

/** A Windows machine made of a few facts: which files exist and what each bash says it is. */
function machine({ files = {}, env = {}, execPath, registry = {} }: {
  files?: Record<string, string>; env?: Record<string, string>; execPath?: string; registry?: Record<string, string>;
}): GitBashProbe {
  return {
    env,
    exists: path => Object.hasOwn(files, path),
    git: args => (args[0] === '--exec-path' ? execPath : undefined),
    registry: key => registry[key],
    uname: bash => files[bash],
  };
}

describe('finding Git Bash for the teacher on Windows', () => {
  it('prefers the git on PATH and walks up from its exec path', () => {
    const result = findGitBash(machine({
      execPath: 'C:/Program Files/Git/mingw64/libexec/git-core\n',
      files: { 'C:\\Program Files\\Git\\bin\\bash.exe': 'MINGW64_NT-10.0-22631\n', 'C:\\Windows\\System32\\bash.exe': 'Linux\n' },
      env: { ProgramFiles: 'C:\\Program Files' },
    }));
    expect(result.path).toBe('C:\\Program Files\\Git\\bin\\bash.exe');
  });
  it('falls back to the registry and install folders, skipping WSL and anything that is not MSYS', () => {
    const result = findGitBash(machine({
      registry: { 'HKCU\\SOFTWARE\\GitForWindows': 'D:\\Tools\\Git' },
      files: { 'D:\\Tools\\Git\\bin\\bash.exe': 'Linux\n', 'C:\\Users\\张三\\AppData\\Local\\Programs\\Git\\bin\\bash.exe': 'MSYS_NT-10.0\n' },
      env: { LOCALAPPDATA: 'C:\\Users\\张三\\AppData\\Local' },
    }));
    expect(result.path).toBe('C:\\Users\\张三\\AppData\\Local\\Programs\\Git\\bin\\bash.exe');
    expect(result.checked).toContain('D:\\Tools\\Git\\bin\\bash.exe');
  });
  it('uses NOTARA_GIT_BASH alone when it is set, and refuses WSL there too', () => {
    const wsl = 'C:\\Windows\\System32\\bash.exe';
    const refused = findGitBash(machine({ env: { NOTARA_GIT_BASH: wsl }, files: { [wsl]: 'MINGW64\n' } }));
    expect(refused.path).toBeUndefined();
    expect('reason' in refused && refused.reason).toContain('NOTARA_GIT_BASH');
    const chosen = 'E:\\PortableGit\\bin\\bash.exe';
    expect(findGitBash(machine({ env: { NOTARA_GIT_BASH: chosen }, files: { [chosen]: 'MINGW64\n' } })).path).toBe(chosen);
  });
  it('says what it checked and how to fix it when there is no Git Bash', () => {
    const result = findGitBash(machine({ env: { ProgramFiles: 'C:\\Program Files' } }));
    expect(result.path).toBeUndefined();
    expect('reason' in result && result.reason).toMatch(/Git for Windows[\s\S]*NOTARA_GIT_BASH[\s\S]*C:\\Program Files\\Git\\bin\\bash\.exe/);
  });
});
