import { randomUUID } from 'node:crypto';
import { open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const windowsRenameDelays = [20, 40, 80, 160, 240] as const;

export interface AtomicReplaceOptions {
  platform?: NodeJS.Platform;
  renameFile?: (temporary: string, destination: string) => Promise<void>;
  pause?: (milliseconds: number) => Promise<void>;
}

/** Replace one existing file through a fsynced sibling, retrying transient Windows sharing errors. */
export async function replaceFileAtomically(path: string, content: string, options: AtomicReplaceOptions = {}): Promise<void> {
  const mode = (await stat(path)).mode & 0o777;
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.next`);
  const handle = await open(temporary, 'wx', mode);
  try {
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    const platform = options.platform ?? process.platform;
    const renameFile = options.renameFile ?? rename;
    const pause = options.pause ?? (milliseconds => new Promise<void>(resolve => setTimeout(resolve, milliseconds)));
    for (let attempt = 0; ; attempt++) {
      try { await renameFile(temporary, path); return; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '') || attempt >= windowsRenameDelays.length) throw error;
        await pause(windowsRenameDelays[attempt]!);
      }
    }
  } finally { await rm(temporary, { force: true }); }
}
