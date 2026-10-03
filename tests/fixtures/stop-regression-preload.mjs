import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { basename, resolve } from 'node:path';

// Instrument only this owned regression wrapper, never its DSH Host or other
// test workers. All intercepted paths and PIDs are registered by that wrapper.
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/stop-regression-worker.mjs')) {
  const originalExecFile = childProcess.execFile;
  const originalUnlink = fs.unlink;
  const originalRm = fs.promises.rm;
  const audit = globalThis.__notaraOwnedStopAudit = {
    root: undefined, pid: undefined, unlinkMode: 'off', holdKill: true,
    killCalls: 0, killReturned: false, killRelease: undefined,
    rmCalls: [], unlinkAttempts: 0, injectedBusy: 0,
  };
  const launcher = path => audit.root && resolve(String(path)) === resolve(audit.root, 'launcher.json');
  childProcess.execFile = function (file, args, options, callback) {
    if (basename(String(file)).toLowerCase().replace(/\.exe$/, '') !== 'taskkill' ||
        !Array.isArray(args) || args[0]?.toLowerCase() !== '/pid' || String(args[1]) !== String(audit.pid)) {
      return originalExecFile.apply(this, arguments);
    }
    audit.killCalls++;
    return originalExecFile.call(this, file, args, options, (...result) => {
      audit.killReturned = true;
      // A real terminated child, with the Windows nonzero-result race forced.
      // Production must probe the actual PID instead of ignoring this error.
      if (!result[0]) result = [Object.assign(new Error('Synthetic taskkill race: process already exited'), { code: 1 }), `PID ${audit.pid}`, `Cannot terminate PID ${audit.pid}: operation not supported`];
      const release = () => { audit.killRelease = undefined; callback(...result); };
      if (audit.holdKill) audit.killRelease = release;
      else release();
    });
  };
  // Patch the public callback unlink before internal/fs/rimraf loads. Its real
  // retry loop remains intact; patching fs.promises.rm to throw would not test it.
  fs.unlink = function (path, callback) {
    if (launcher(path)) {
      audit.unlinkAttempts++;
      if (audit.unlinkMode === 'always' || audit.unlinkMode === 'once') {
        if (audit.unlinkMode === 'once') audit.unlinkMode = 'off';
        audit.injectedBusy++;
        const error = Object.assign(new Error('Synthetic owned launcher sharing violation'), {
          code: 'EBUSY', syscall: 'unlink', path: String(path),
        });
        queueMicrotask(() => callback(error));
        return;
      }
    }
    return originalUnlink.apply(this, arguments);
  };
  fs.promises.rm = function (path, options) {
    if (launcher(path)) audit.rmCalls.push({ options: { ...options }, killReturned: audit.killReturned, callbackHeld: !!audit.killRelease });
    return originalRm.apply(this, arguments);
  };
  syncBuiltinESMExports();
}
