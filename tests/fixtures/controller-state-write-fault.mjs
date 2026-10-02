// Fault injection only in the isolated test supervisor. No product switches.
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

const target = process.env.NOTARA_TEST_CONTROLLER_STATE;
if (target && process.argv.includes('__supervisor')) {
  const canonicalTarget = join(await fs.realpath(dirname(target)), basename(target)).toLowerCase();
  const rename = fs.rename;
  const signal = process.env.NOTARA_TEST_CONTROLLER_GATE;
  const failures = Number(process.env.NOTARA_TEST_CONTROLLER_FAILURES);
  let attempts = 0;
  fs.rename = async (from, to) => {
    if (resolve(String(to)).toLowerCase() === canonicalTarget && JSON.parse(await fs.readFile(from, 'utf8')).phase === 'ready') {
      attempts++;
      await fs.writeFile(`${signal}.attempts`, String(attempts));
      if (attempts === 1) {
        await fs.writeFile(`${signal}.entered`, 'ready write is waiting');
        const deadline = Date.now() + 30_000;
        while (!await fs.stat(`${signal}.release`).then(() => true, () => false)) {
          if (Date.now() >= deadline) throw new Error('Test did not release the controller write gate');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      }
      if (attempts <= failures) throw Object.assign(new Error('Synthetic controller state sharing violation'), { code: 'EPERM' });
    }
    return rename(from, to);
  };
  syncBuiltinESMExports();
}
