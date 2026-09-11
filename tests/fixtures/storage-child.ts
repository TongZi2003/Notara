import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { CardContentSchema } from '../../packages/contracts/src/cards.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
const [root, mode] = process.argv.slice(2);
if (!root || !mode) throw new Error('root and mode required');
const ctx = new Context(); await ctx.plugin(Storage);
try {
  const owner = await openWorkspaceRecords(ctx, root, 'student-a', createTestClock('2026-09-12T01:00:00Z', 'Asia/Shanghai'));
  const cards = await owner.collection('card', CardContentSchema);
  await cards.update({ workspaceId: 'student-a', sessionId: 'lesson-a', actor: 'teacher', purpose: 'learning', operationId: 'crash-edit', expectedVersion: 1 }, 'card:one', { front: 'committed' }, old => {
    if (mode === 'before') process.kill(process.pid, 'SIGKILL');
    return { ...old, front: 'committed' };
  });
  if (mode === 'after') process.kill(process.pid, 'SIGKILL');
  await owner.close(); await ctx.fiber.dispose();
} catch (error) { console.log((error as { code?: string }).code); process.exitCode = 23; await ctx.fiber.dispose(); }
