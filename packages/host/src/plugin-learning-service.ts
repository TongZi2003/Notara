import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';
import { PluginDocumentSchema, PluginLinkSchema, SeminarStartSchema, SeminarRoleSchema, type SeminarView, type SeminarRole, type PluginLink } from '@studyforge/contracts/plugin-learning';
import { studentContext } from './learning-service.ts';
const Target = z.object({ sessionId: z.string().min(1), id: z.string().min(1), digest: z.string().min(1) }).strict();
export class PluginLearningRemote extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'notaraWorkbench'); }
  @Remote('seminars')
  async seminars(input:{sessionId:string;id:string;digest:string}):Promise<SeminarView[]> { const data=Target.parse(input),context=await studentContext(this.ctx,data.sessionId); await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId,data.id,'seminar',data.digest); return this.ctx.notaraSeminar.list(context,data.id); }
  @Remote('startSeminar')
  async startSeminar(input:{sessionId:string;id:string;digest:string;topic:string;materials:string;standard:string;roles:SeminarRole[]}):Promise<SeminarView[]> {
    const data=Target.extend({topic:z.string(),materials:z.string(),standard:z.string(),roles:z.array(SeminarRoleSchema)}).parse(input),context=await studentContext(this.ctx,data.sessionId);
    await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId,data.id,'seminar',data.digest);
    return this.ctx.notaraSeminar.start(context,data.id,SeminarStartSchema.parse({topic:data.topic,materials:data.materials,standard:data.standard,roles:data.roles}));
  }
  @Remote('followSeminar')
  async followSeminar(input:{sessionId:string;id:string;digest:string;ref:string;role:SeminarRole;text:string;operationId:string}):Promise<{accepted:true}> {
    const data=Target.extend({ref:z.string(),role:SeminarRoleSchema,text:z.string().trim().min(1).max(8000),operationId:z.string().min(1).max(160)}).parse(input),context=await studentContext(this.ctx,data.sessionId);
    await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId,data.id,'seminar',data.digest); await this.ctx.notaraSeminar.follow(context,data.id,data.ref,data.role,data.text,data.operationId);return {accepted:true};
  }
  @Remote('stopSeminar')
  async stopSeminar(input:{sessionId:string;id:string;digest:string;ref:string}):Promise<{accepted:true}> {
    const data=Target.extend({ref:z.string()}).parse(input),context=await studentContext(this.ctx,data.sessionId); await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId,data.id,'seminar',data.digest); await this.ctx.notaraSeminar.stop(context,data.id,data.ref);return {accepted:true};
  }
  @Remote('readDocument')
  async readDocument(input: { sessionId: string; id: string; digest: string }): Promise<{revision:number;json:string}> {
    const data = Target.parse(input), context = await studentContext(this.ctx, data.sessionId); await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId, data.id, 'document', data.digest);
    const row = await this.ctx.studyforgeLearningWorkbenches.read(context, data.id); return { revision: row.revision, json: JSON.stringify(row.document) };
  }
  @Remote('writeDocument')
  async writeDocument(input: { sessionId: string; id: string; digest: string; expectedVersion: number; operationId: string; json: string }): Promise<{revision:number;json:string}> {
    const data = Target.extend({ expectedVersion: z.number().int().nonnegative(), operationId: z.string().min(1).max(160), json: z.string().max(60000) }).parse(input);
    const context = await studentContext(this.ctx, data.sessionId); await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId, data.id, 'document', data.digest);
    const row = await this.ctx.studyforgeLearningWorkbenches.write({ ...context, expectedVersion: data.expectedVersion, operationId: data.operationId }, data.id, PluginDocumentSchema.parse(JSON.parse(data.json)));
    return { revision: row.revision, json: JSON.stringify(row.document) };
  }
  @Remote('sources')
  async sources(input: {sessionId:string;id:string;digest:string;query:string}): Promise<PluginLink[]> {
    const data = Target.extend({ query: z.string().max(200) }).parse(input), context = await studentContext(this.ctx, data.sessionId);
    await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId, data.id, 'sources', data.digest); return this.ctx.studyforgeLearningWorkbenches.sources(context, data.query);
  }
  @Remote('resolveLink')
  async resolveLink(input: {sessionId:string;id:string;digest:string;link:PluginLink}): Promise<PluginLink> {
    const data = Target.extend({ link: PluginLinkSchema }).parse(input), context = await studentContext(this.ctx, data.sessionId);
    await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId, data.id, 'sources', data.digest); return this.ctx.studyforgeLearningWorkbenches.link(context, data.link);
  }
  @Remote('worldbookContext')
  async worldbookContext(input: {sessionId:string;id:string;digest:string;query:string}): Promise<{text:string}> {
    const data = Target.extend({ query: z.string().max(2000) }).parse(input); await studentContext(this.ctx, data.sessionId);
    await this.ctx.studyforgeLearningWorkbenches.authorize(data.sessionId, data.id, 'worldbook-context', data.digest); return { text: await this.ctx.studyforgeWorkbenchData.background(data.sessionId, data.query) };
  }
}
