import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, parse } from 'node:path';

let cached;

/**
 * The ripgrep binary the DSH runtime already ships for its native search tools.
 * The teacher searches through Bash, where a system `rg` is often missing (a
 * fresh macOS, Git Bash on Windows); handing the packaged binary over keeps the
 * search rules independent of what the learner happened to install.
 *
 * Resolution mirrors `@deepseek-ai/dsh-tool-fs-search`: a single-file runtime
 * carries an `-rg` sidecar next to the executable, a Node install resolves the
 * platform package through `@vscode/ripgrep`. An unresolvable binary yields ''
 * so the shell simply lacks the variable and the rules fall back to grep.
 * @returns absolute path of an existing ripgrep executable, or ''.
 */
export function packagedRipgrep() {
  if (cached !== undefined) return cached;
  cached = '';
  const executable = parse(process.execPath);
  const sidecar = process.platform === 'win32' ? join(executable.dir, `${executable.name}-rg.exe`) : `${process.execPath}-rg`;
  if ('pkg' in process && existsSync(sidecar)) return (cached = sidecar);
  const origins = [import.meta.url];
  try { origins.push(import.meta.resolve('@deepseek-ai/dsh-tool-fs-search')); } catch { /* not installed beside this plugin */ }
  for (const origin of origins) {
    try {
      const path = createRequire(origin)('@vscode/ripgrep').rgPath;
      if (path && existsSync(path)) return (cached = path);
    } catch { /* try the next origin */ }
  }
  return cached;
}
