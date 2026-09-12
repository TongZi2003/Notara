import { Context } from '@deepseek-ai/cordis';
import Storage from '@deepseek-ai/dsh-storage';
import { z } from 'zod';
import { openWorkspaceRecords } from '../../packages/host/src/storage.ts';
import { createTestClock } from '../../packages/domain/src/clock.ts';
const [root, boundary] = process.argv.slice(2);
if (!root || !boundary) throw new Error('root and boundary required');
const ctx = new Context(); await ctx.plugin(Storage);
const owner = await openWorkspaceRecords(ctx, root, 'w', createTestClock('2026-09-12T00:00:00Z', 'UTC'));
const schema = z.object({ path: z.string().min(1) }).strict();
const cards = await owner.collection('card', schema), skeletons = await owner.collection('skeleton', schema);
const base = { workspaceId: 'w', sessionId: 'lesson', actor: 'student' as const, purpose: 'learning' as const, expectedVersion: 1 };
const plans = [cards.prepareUpdate({ ...base, operationId: 'atomic-card' }, 'card:one', { path: '新' }, () => ({ path: '新' })),
  skeletons.prepareUpdate({ ...base, operationId: 'atomic-outline' }, 'skeleton:book', { path: '新' }, () => ({ path: '新' }))];
if (boundary === 'before') process.kill(process.pid, 'SIGKILL');
await owner.atomic(plans);
if (boundary === 'after') process.kill(process.pid, 'SIGKILL');
await owner.close(); await ctx.fiber.dispose();
