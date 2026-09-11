import { test as base, expect } from '@playwright/test';
import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startIsolated, type IsolatedRuntime } from '../../../scripts/dev-isolated.ts';

export const test = base.extend<{ dsh: IsolatedRuntime }>({
  dsh: async ({}, use, testInfo) => {
    const runtime = await startIsolated();
    try {
      await writeFile(join(runtime.root, 'classroom', '学习示例.md'), '# 一起读这一小段\n\n这是本次检查新建的示例资料。\n\n**观察，然后提出一个问题。**\n\n- 先说看到了什么\n- 再说明你的理由\n');
      await use(runtime);
    } finally {
      await runtime.stop();
      await runtime.stop(); // disposal is idempotent
      await testInfo.attach('host-log', { body: runtime.log(), contentType: 'text/plain' });
      await expect(access(runtime.root)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  },
});

export { expect };
