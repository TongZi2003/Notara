import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * The JavaScript file behind a package's executable, read from its package.json
 * `bin`. Launchers run it with `process.execPath` instead of the npm shim in
 * node_modules/.bin, which on Windows is a POSIX shell script node cannot run.
 */
export function packageBin(project: string, pkg: string, name: string): string {
  const manifestPath = join(project, 'node_modules', pkg, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { bin?: string | Record<string, string> };
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[name];
  if (!bin) throw new Error(`${pkg} has no executable named ${name}`);
  return join(dirname(manifestPath), bin);
}

/** A build output by file name, whether its path uses / or \ separators. */
export function outputNamed<T extends { path: string }>(files: readonly T[], name: string): T | undefined {
  return files.find(file => file.path.split(/[\\/]/).at(-1) === name);
}
