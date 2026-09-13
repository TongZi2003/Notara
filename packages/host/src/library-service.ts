import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { LibraryRelationSchema, type LibraryRelation } from '@studyforge/contracts/library';
import type { RecordStore } from '@studyforge/domain/storage';
import { studentContext } from './learning-service.ts';
import { createHash } from 'node:crypto';
import { z } from 'zod';
declare module '@deepseek-ai/cordis' { interface Context { studyforgeLibrary: StudyForgeLibrary; studyforgeRelations: RecordStore<typeof LibraryRelationSchema>; } }
export class StudyForgeLibrary extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeLibrary'); }
  @Remote('relations')
  async relations(): Promise<LibraryRelation[]> { return this.ctx.studyforgeRelations.list(await studentContext(this.ctx)).map(row => ({ ref: row.ref, version: row.version, ...row.data })); }
  @Remote('relate')
  async relate(input: { operationId: string; from: string; to: string; label: string }): Promise<LibraryRelation> {
    const parsed = z.object({ operationId: z.string().min(1), from: z.string(), to: z.string(), label: z.string() }).strict().parse(input);
    const context = await studentContext(this.ctx), data = LibraryRelationSchema.parse({ from: parsed.from, to: parsed.to, label: parsed.label });
    for (const ref of [data.from, data.to]) {
      if (ref.startsWith('material:')) await this.ctx.studyforgeMaterialService.get(context, ref.slice(9));
      else if (ref.startsWith('card:')) this.ctx.studyforgeCardService.read(context, ref);
      else this.ctx.studyforgeKnowledgeService.read(context, ref);
    }
    const existing = (await this.relations()).find(row => row.from === data.from && row.to === data.to && row.label === data.label);
    if (existing) return existing;
    const saved = await this.ctx.studyforgeRelations.create({ ...context, operationId: parsed.operationId }, createHash('sha256').update(parsed.operationId).digest('hex'), data);
    return { ref: saved.ref, version: saved.version, ...saved.data };
  }
  @Remote('removeRelation')
  async removeRelation(input: { operationId: string; ref: string; expectedVersion: number }): Promise<void> {
    await this.ctx.studyforgeRelations.remove({ ...await studentContext(this.ctx), operationId: input.operationId, expectedVersion: input.expectedVersion }, input.ref);
  }
}
