import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ThoughtGraphSchema, ThoughtNodeSchema, ThoughtEdgeSchema, type ThoughtGraph, type ThoughtNode, type ClassroomTrace } from '@studyforge/contracts/classroom-trace';
import type { RecordStore } from '@studyforge/domain/storage';
import { studentContext } from './learning-service.ts';
import { decodeSourceFragments } from '@studyforge/contracts/source-context';
import { SourceUseSchema } from '@studyforge/contracts/content-history';
import { toolSchema } from './tools/tool-schema.ts';
import { teacherContext, rejected } from './tools/learning-context.ts';
import { canonicalPath } from '@studyforge/domain/access';
import { taskLabels } from './teaching/task-skills.ts';
import { entityReferenceText } from '@studyforge/contracts/entity-reference';
import { settledNotes, projectStages } from './thought-stages.ts';
import { projectConversationFrames } from './conversation-frames.ts';
declare module '@deepseek-ai/cordis' { interface Context { studyforgeTrace: StudyForgeTrace; studyforgeThoughts: RecordStore<typeof ThoughtGraphSchema>; } }
const idOf = (session: string): string => createHash('sha256').update(session).digest('hex');
const emptyGraph = (sessionId: string): ThoughtGraph => ({ sessionId, nodes: [], edges: [], hidden: [], frames: [] });
export function ownEvents(events: readonly SessionEvent[]): readonly SessionEvent[] {
  const boundary = events.findLastIndex(event => event.type === 'session/end-seed' && event.data.inherited === true);
  return events.slice(boundary + 1);
}
function acyclic(nodes: readonly ThoughtNode[], edges: ThoughtGraph['edges']): void {
  const ids = new Set(nodes.map(n => n.id)), visiting = new Set<string>(), done = new Set<string>();
  for (const edge of edges) if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error('thought_target_missing');
  const visit = (id: string): void => { if (visiting.has(id)) throw new Error('thought_cycle'); if (done.has(id)) return; visiting.add(id); for (const edge of edges.filter(e => e.from === id)) visit(edge.to); visiting.delete(id); done.add(id); };
  for (const id of ids) visit(id);
}
export class StudyForgeTrace extends TypertRemoteService {
  constructor(ctx: Context) { super(ctx, 'studyforgeTrace'); }
  @Remote('read')
  async read(input: { sessionId: string }): Promise<ClassroomTrace> {
    const context = await studentContext(this.ctx, input.sessionId), observed = await this.ctx.sessionQuery.observeSession(SessionId(input.sessionId));
    const nodes: ThoughtNode[] = []; let parent: string | undefined;
    const events = ownEvents(observed.events);
    try {
      parent = observed.header.parentSession;
      let turn = 0;
      let questionBatch: ThoughtNode[] = [];
      const skillTitles = new Map(taskLabels(this.ctx).map(row => [row.id, row.title]));
      for (const event of events) {
        if (['step/start', 'turn/end', 'tool/call', 'assistant/message'].includes(event.type)) questionBatch = [];
        if (event.type === 'user/message') {
          const invocation = z.object({ kind: z.literal('skill-invocation'), name: z.string() }).safeParse(event.data.source);
          if (invocation.success && skillTitles.has(invocation.data.name)) for (const node of questionBatch) {
            let found = false;
            const body = node.body.replace(/(^|\s)\/([\w-]+)(?=\s|$)/gu, (whole, space: string, name: string) => { if (name !== invocation.data.name) return whole; found = true; return space; }).trim();
            if (found) { node.body = body + '\n\n技能：' + skillTitles.get(invocation.data.name); node.title = (body || skillTitles.get(invocation.data.name)!).replace(/[#*`\n]/g, ' ').slice(0, 72); }
          }
        }
        if (event.type === 'turn/start') turn = event.data.turn;
        if (event.type === 'user/message' || event.type === 'assistant/message') {
          const user = event.type === 'user/message', message = user ? event.data : event.data.message;
          if (user && event.data.source.kind !== 'user' && event.data.source.kind !== 'plugin') continue;
          const decoded = decodeSourceFragments(message.content.map(block => block.type === 'text' ? block.text : '').join(''));
          const text = decoded.text.trim(); if (!text) continue;
          const system = user && event.data.source.kind === 'plugin';
          if (system && !text.includes('单据')) continue;
          const sources = decoded.fragments.flatMap(fragment => fragment.context.selection?.sources ?? (fragment.context.currentMaterial?.kind === 'source' ? [fragment.context.currentMaterial.source] : []));
          const targets = decoded.fragments.flatMap(fragment => fragment.context.currentMaterial?.kind === 'card' ? [{ ref: fragment.context.currentMaterial.cardRef, ...(fragment.context.currentMaterial.cardVersion ? { version: fragment.context.currentMaterial.cardVersion } : {}), title: fragment.titles[0]?.title ?? '卡片' }] : []);
          nodes.push({ id: 'event:' + event.seq, title: system ? '保存结果' : entityReferenceText(text).replace(/[#*`\n]/g, ' ').slice(0, 72), body: text.slice(0, 20000), kind: system ? 'result' : user ? 'question' : 'answer', sequence: event.seq, turn, sources, targets });
          if (user && !system) questionBatch.push(nodes.at(-1)!);
        }
        if (event.type === 'tool/result' && !event.data.message.content.some(block => block.isError)) {
          const use = SourceUseSchema.safeParse(event.data.meta), node = nodes.at(-1);
          if (node && use.success) { node.sources.push(...use.data.sources); if (use.data.target) node.targets.push({ ref: use.data.target, ...(use.data.version ? { version: use.data.version } : {}), title: use.data.target.startsWith('card:') ? '相关卡片' : '相关记录' }); }
        }
      }
    } finally { observed[Symbol.dispose](); }
    const saved = this.ctx.studyforgeThoughts.list(context).find(row => row.data.sessionId === input.sessionId);
    const graph = saved?.data ?? emptyGraph(input.sessionId);
    const merged = nodes.map(node => { const edit = graph.nodes.find(item => item.id === node.id); return edit ? { ...node, title: edit.title, body: edit.body, kind: edit.kind, ...(edit.frameId ? { frameId: edit.frameId } : {}), ...(edit.position ? { position: edit.position } : {}) } : node; });
    for (const node of graph.nodes) if (!node.id.startsWith('event:') && !node.id.startsWith('stage:')) merged.push(node);
    const shown = merged.filter(node => !graph.hidden.includes(node.id));
    const stages = projectStages(settledNotes(this.ctx, context, events), events, nodes, graph.nodes).filter(node => !graph.hidden.includes(node.id));
    const native = await this.ctx.sessionController.list({}, AbortSignal.timeout(15000));
    const candidates = native.items.filter(item => item.origin !== 'subagent' && item.cwd && canonicalPath(item.cwd, this.ctx.studyforgeAccess.root) === this.ctx.studyforgeAccess.root && item.projections?.values.agentPreset === 'studyforge-learning').map(item => ({ sessionId: String(item.sessionId), title: String(item.projections?.values.title ?? '课堂'), ...(item.parentSessionId ? { parent: String(item.parentSessionId) } : {}) }));
    // Only this classroom's native fork family, never the whole workspace's
    // unrelated lessons or blank drafts. Missing ancestors stop the walk.
    const index = new Map(candidates.map(item => [item.sessionId, item]));
    const rootOf = (id: string): string => { const seen = new Set<string>(); let current = id; while (!seen.has(current)) { seen.add(current); const above = index.get(current)?.parent; if (!above || !index.has(above)) break; current = above; } return current; };
    const root = rootOf(input.sessionId), branches = candidates.filter(item => rootOf(item.sessionId) === root);
    const all = [...shown, ...stages];
    const edges = graph.edges.filter(edge => all.some(n => n.id === edge.from) && all.some(n => n.id === edge.to));
    const frameProjection = projectConversationFrames(graph, shown);
    return { version: saved?.version ?? 0, sessionId: input.sessionId, nodes: shown, stages, edges,
      frames: frameProjection.frames, ...(frameProjection.activeFrameId ? { activeFrameId: frameProjection.activeFrameId } : {}), unsegmented: frameProjection.unsegmented,
      ...(parent ? { parent } : {}), branches };
  }
  /** Close the current frame and create the next one in one conditional write. */
  async advance(input: { sessionId: string; operationId: string; title: string; summary: string; nextGoal: string; mode?: 'continue' | 'branch' | 'resume'; parentFrameId?: string; resumeFrameId?: string }): Promise<ClassroomTrace> {
    const data = z.object({ sessionId: z.string().min(1), operationId: z.string().min(1), title: z.string().trim().min(1).max(160), summary: z.string().trim().min(1).max(4000), nextGoal: z.string().trim().min(1).max(4000), mode: z.enum(['continue', 'branch', 'resume']).optional(), parentFrameId: z.string().min(1).optional(), resumeFrameId: z.string().min(1).optional() }).strict().parse(input);
    const context = await studentContext(this.ctx, data.sessionId), current = await this.read({ sessionId: data.sessionId });
    const saved = this.ctx.studyforgeThoughts.list(context).find(row => row.data.sessionId === data.sessionId);
    if (saved?.data.frames.some(frame => frame.operationIds.includes(data.operationId))) return current;
    const observed = await this.ctx.sessionQuery.observeSession(SessionId(data.sessionId));
    let lastSequence = -1;
    try { for (const event of ownEvents(observed.events)) lastSequence = Math.max(lastSequence, event.seq); }
    finally { observed[Symbol.dispose](); }
    const graph = structuredClone(saved?.data ?? emptyGraph(data.sessionId));
    const activeIndex = graph.frames.findLastIndex(frame => frame.status === 'active');
    const boundary = Math.max(0, lastSequence + 1);
    if (activeIndex >= 0) {
      const active = graph.frames[activeIndex]!;
      graph.frames[activeIndex] = { ...active, summary: data.summary, endSequence: boundary, status: data.mode === 'branch' ? 'branched' : 'completed' };
    }
    const mode: 'root' | 'continue' | 'branch' | 'resume' = activeIndex < 0 ? 'root' : (data.mode ?? 'continue');
    if (mode === 'branch' && data.parentFrameId && !graph.frames.some(frame => frame.id === data.parentFrameId)) throw rejected('parentFrameId不是现存阶段；先read_thoughtmap列出阶段再选');
    if (mode === 'resume' && data.resumeFrameId && !graph.frames.some(frame => frame.id === data.resumeFrameId)) throw rejected('resumeFrameId不是现存阶段；先read_thoughtmap列出阶段再选');
    const frame: ThoughtGraph['frames'][number] = {
      id: 'frame:' + idOf(`${data.sessionId}:${data.operationId}`), title: data.title, goal: data.nextGoal, mode,
      status: 'active' as const, startSequence: boundary, operationIds: [data.operationId],
      ...(mode === 'branch' ? { parentFrameId: data.parentFrameId ?? graph.frames[activeIndex]!.id } : {}),
      ...(mode === 'resume' && data.resumeFrameId ? { resumeFrameId: data.resumeFrameId } : {}),
    };
    graph.frames.push(frame);
    const mutation = { ...context, operationId: data.operationId, expectedVersion: saved?.version ?? 0 };
    if (saved) await this.ctx.studyforgeThoughts.update(mutation, saved.ref, data, () => graph);
    else await this.ctx.studyforgeThoughts.create(mutation, idOf(data.sessionId), graph);
    return this.read({ sessionId: data.sessionId });
  }
  @Remote('edit')
  async edit(input: { sessionId: string; operationId: string; expectedVersion: number; node?: { id?: string; title: string; body: string; kind: ThoughtNode['kind']; sequence?: number; frameId?: string; stageBasis?: string; position?: { x: number; y: number } }; edge?: { from: string; to: string; label: string }; removeEdge?: { from: string; to: string; label: string }; hide?: string; frame?: { id: string; title?: string; goal?: string; summary?: string; status?: 'paused' } }): Promise<ClassroomTrace> {
    const data = z.object({ sessionId: z.string().min(1), operationId: z.string().min(1), expectedVersion: z.number().int().nonnegative(), node: ThoughtNodeSchema.pick({ id: true, title: true, body: true, kind: true, sequence: true, frameId: true, stageBasis: true, position: true }).partial({ id: true }).optional(), edge: ThoughtEdgeSchema.optional(), removeEdge: ThoughtEdgeSchema.optional(), hide: z.string().optional(), frame: z.object({ id: z.string().min(1), title: z.string().trim().min(1).max(160).optional(), goal: z.string().trim().min(1).max(4000).optional(), summary: z.string().trim().max(4000).optional(), status: z.literal('paused').optional() }).strict().optional() }).strict().parse(input);
    const context = await studentContext(this.ctx, data.sessionId), current = await this.read({ sessionId: data.sessionId });
    const old = this.ctx.studyforgeThoughts.list(context).find(row => row.data.sessionId === data.sessionId);
    const graph: ThoughtGraph = structuredClone(old?.data ?? emptyGraph(data.sessionId));
    if (data.frame) {
      const index = graph.frames.findIndex(frame => frame.id === data.frame!.id);
      if (index < 0) throw new Error('frame_missing');
      const currentFrame = graph.frames[index]!;
      if (data.frame.status === 'paused' && currentFrame.status !== 'active') throw new Error('frame_not_active');
      graph.frames[index] = { ...currentFrame, ...(data.frame.title ? { title: data.frame.title } : {}), ...(data.frame.goal ? { goal: data.frame.goal } : {}), ...(data.frame.summary !== undefined ? { summary: data.frame.summary } : {}), ...(data.frame.status ? { status: data.frame.status } : {}) };
    }
    if (data.node) {
      const stage = current.stages.find(node => node.id === data.node!.id);
      if (stage && (stage.stage.pending || stage.stage.basis !== data.node.stageBasis)) throw new Error('stage_changed');
      const basis = stage ? ThoughtNodeSchema.strip().parse(stage) : current.nodes.find(node => node.id === data.node!.id);
      if (data.node.id && !basis) throw new Error('thought_node_missing');
      const anchor = data.node.sequence === undefined ? undefined : current.nodes.find(node => node.sequence === data.node!.sequence);
      if (data.node.sequence !== undefined && !anchor) throw new Error('thought_anchor_missing');
      if (data.node.frameId && !graph.frames.some(frame => frame.id === data.node!.frameId)) throw new Error('frame_missing');
      const node: ThoughtNode = { ...(basis ?? anchor ?? { sources: [], targets: [] }), ...data.node, id: data.node.id ?? 'note:' + idOf(data.operationId) };
      graph.nodes = [...graph.nodes.filter(item => item.id !== node.id), node];
    }
    if (data.edge && !graph.edges.some(edge => JSON.stringify(edge) === JSON.stringify(data.edge))) graph.edges.push(data.edge);
    if (data.removeEdge) graph.edges = graph.edges.filter(edge => JSON.stringify(edge) !== JSON.stringify(data.removeEdge));
    if (data.hide) { graph.hidden.push(data.hide); graph.edges = graph.edges.filter(edge => edge.from !== data.hide && edge.to !== data.hide); }
    acyclic([...current.nodes, ...current.stages, ...graph.nodes], graph.edges);
    const mutation = { ...context, operationId: data.operationId, expectedVersion: data.expectedVersion };
    if (data.expectedVersion === 0) await this.ctx.studyforgeThoughts.create(mutation, idOf(data.sessionId), graph);
    else await this.ctx.studyforgeThoughts.update(mutation, 'thought:' + idOf(data.sessionId), data, () => graph);
    return this.read({ sessionId: data.sessionId });
  }
  @Remote('fork')
  async fork(input: { sessionId: string; atSeq: number }): Promise<{ sessionId: string }> {
    const data = z.object({ sessionId: z.string().min(1), atSeq: z.number().int().nonnegative() }).strict().parse(input), context = await studentContext(this.ctx, data.sessionId);
    const source = this.ctx.studyforgeCourseMetadata.read(context).data;
    const result = await this.ctx.sessionController.fork({ sessionId: SessionId(data.sessionId), atSeq: data.atSeq });
    const { lessonMaterials, learningSetRef, teachingRef, subjects, temporaryInstructions, stance, guided, learningGoal } = source;
    await this.ctx.studyforgeCourseMetadata.update({ ...context, sessionId: result.sessionId, operationId: 'fork:' + result.sessionId, expectedVersion: 0 }, {
      lessonMaterials, learningSetRef, ...(teachingRef ? { teachingRef } : {}), ...(subjects ? { subjects } : {}), ...(temporaryInstructions ? { temporaryInstructions } : {}), ...(stance ? { stance } : {}), ...(guided !== undefined ? { guided } : {}), ...(learningGoal ? { learningGoal } : {}),
    });
    const pins = this.ctx.studyforgeSubjectBindings.list(context).find(row => row.ref === 'subjectbinding:' + idOf(data.sessionId));
    if (pins) await this.ctx.studyforgeSubjectBindings.create({ ...context, sessionId: result.sessionId, operationId: 'fork-pins:' + result.sessionId }, idOf(result.sessionId), pins.data);
    return { sessionId: result.sessionId };
  }
}
export function registerThoughtTool(host: Context): void {
  const readInput = z.object({ stageId: z.string().optional() }).strict();
  const summaryInput = z.object({ stageId: z.string(), basis: z.string(), expectedVersion: z.number().int().nonnegative(), title: z.string().trim().min(1).max(160), summary: z.string().trim().min(1).max(4000) }).strict();
  const advanceInput = z.object({ title: z.string().trim().min(1).max(160), summary: z.string().trim().min(1).max(4000), nextGoal: z.string().trim().min(1).max(4000), mode: z.enum(['continue', 'branch', 'resume']).optional(), parentFrameId: z.string().min(1).optional(), resumeFrameId: z.string().min(1).optional() }).strict();
  const jsonOutput = { schema: toolSchema(z.object({ json: z.string() })), render: (_args: unknown, result: { json: string }) => [{ type: 'text' as const, text: result.json }] };
  host.effect(() => host.tools.register({ name: 'read_thoughtmap', description: '读取实际笔记沉淀生成的阶段。省略stageId列出阶段、basis和version；指定id返回该阶段笔记摘录、固定版本资料和原对话，供总结使用。进行中阶段没有笔记，不可总结为已完成。', parameters: toolSchema(readInput), output: jsonOutput,
    async execute(args, execution) {
      const context = await teacherContext(host, execution), data = readInput.parse(args), trace = await host.studyforgeTrace.read({ sessionId: context.sessionId! });
      if (!data.stageId) return { json: JSON.stringify({ version: trace.version, activeFrameId: trace.activeFrameId, frames: trace.frames.map(frame => ({ id: frame.id, title: frame.title, goal: frame.goal, summary: frame.summary, mode: frame.mode, status: frame.status, parentFrameId: frame.parentFrameId, resumeFrameId: frame.resumeFrameId, nodes: frame.nodes.map(node => ({ id: node.id, title: node.title, body: node.body, sequence: node.sequence, targets: node.targets })) })), unsegmented: trace.unsegmented, stages: trace.stages.map(s => ({ id: s.id, title: s.title, basis: s.stage.basis, pending: s.stage.pending, summary: s.stage.summary, targets: s.targets })) }) };
      const stage = trace.stages.find(s => s.id === data.stageId); if (!stage) throw rejected('这个stageId不存在；先read_thoughtmap不带参数列出阶段');
      return { json: JSON.stringify({ version: trace.version, stage, conversation: trace.nodes.filter(n => n.sequence !== undefined && n.sequence >= (stage.stage.fromSequence ?? Infinity) && n.sequence <= (stage.stage.toSequence ?? -1)) }) };
    },
  }));
  host.effect(() => host.tools.register({ name: 'advance_conversation_stage', description: '推进当前课堂阶段：原子关闭当前活动阶段、保存本阶段总结，并创建一个新的活动阶段。第一次调用会创建根阶段；branch/resume只建立ThoughtMap内部关系，不增加route:tree课程节点。阶段完成不表示掌握、复习或课程结束。', parameters: toolSchema(advanceInput), output: jsonOutput,
    async execute(args, execution) {
      const context = await teacherContext(host, execution), data = advanceInput.parse(args);
      const trace = await host.studyforgeTrace.advance({ sessionId: context.sessionId!, operationId: context.operationId, title: data.title, summary: data.summary, nextGoal: data.nextGoal,
        ...(data.mode ? { mode: data.mode } : {}), ...(data.parentFrameId ? { parentFrameId: data.parentFrameId } : {}), ...(data.resumeFrameId ? { resumeFrameId: data.resumeFrameId } : {}) });
      return { json: JSON.stringify({ version: trace.version, activeFrameId: trace.activeFrameId, frames: trace.frames.map(frame => ({ id: frame.id, title: frame.title, goal: frame.goal, summary: frame.summary, status: frame.status, mode: frame.mode })) }) };
    },
  }));
  host.effect(() => host.tools.register({ name: 'summarize_stage', description: '只压缩一个已沉淀笔记阶段的思维图小结。先read_thoughtmap读取阶段和原文，把它返回的version原值填进expectedVersion，再带回stageId/basis；总结问题、推进与未解决点，不将讨论或保存推断成掌握。沿同一阶段更新，保留学生编辑；不创建卡、不记复习、不结束课堂。', parameters: toolSchema(summaryInput), output: jsonOutput,
    async execute(args, execution) {
      const context = await teacherContext(host, execution), data = summaryInput.parse(args), trace = await host.studyforgeTrace.read({ sessionId: context.sessionId! });
      const stage = trace.stages.find(s => s.id === data.stageId);
      if (!stage || stage.stage.pending || stage.stage.basis !== data.basis || trace.version !== data.expectedVersion) throw rejected('阶段或思维图在你读取后已有变化：重新read_thoughtmap取得最新basis和version再提交');
      const saved = host.studyforgeThoughts.list(context).find(row => row.data.sessionId === context.sessionId);
      const graph: ThoughtGraph = structuredClone(saved?.data ?? emptyGraph(context.sessionId!));
      const node = ThoughtNodeSchema.strip().parse({ ...stage, title: data.title, body: data.summary, stageBasis: data.basis });
      graph.nodes = [...graph.nodes.filter(n => n.id !== node.id), node];
      const mutation = { ...context, expectedVersion: data.expectedVersion };
      const result = saved ? await host.studyforgeThoughts.update(mutation, saved.ref, data, () => graph) : await host.studyforgeThoughts.create(mutation, idOf(context.sessionId!), graph);
      return { json: JSON.stringify({ stageId: stage.id, title: data.title, version: result.version }) };
    },
  }));
  const input = z.object({ title: z.string().trim().min(1).max(160), note: z.string().max(20000), kind: z.enum(['idea', 'question', 'conclusion']) }).strict();
  host.effect(() => host.tools.register({ name: 'mark_thought', description: '在课堂思维图记下当前问题、想法或阶段结论，自动关联当前对话和资料；不是学情判断或掌握记录。', parameters: toolSchema(input),
    output: { schema: toolSchema(z.object({ recorded: z.boolean(), title: z.string() })), render: (_args, result) => [{ type: 'text', text: JSON.stringify(result) }] },
    async execute(args, execution) {
      const context = await teacherContext(host, execution), data = input.parse(args), current = await host.studyforgeTrace.read({ sessionId: context.sessionId! });
      const basis = current.nodes.at(-1);
      const saved = host.studyforgeThoughts.list(context).find(row => row.data.sessionId === context.sessionId);
      const graph: ThoughtGraph = structuredClone(saved?.data ?? emptyGraph(context.sessionId!));
      const id = 'note:' + idOf(context.operationId);
      const node: ThoughtNode = { ...(basis ?? { sources: [], targets: [] }), id, title: data.title, body: data.note, kind: data.kind, ...(current.activeFrameId ? { frameId: current.activeFrameId } : {}) };
      delete node.position;
      graph.nodes = [...graph.nodes.filter(item => item.id !== id), node];
      if (basis && !graph.edges.some(edge => edge.from === basis.id && edge.to === id)) graph.edges.push({ from: basis.id, to: id, label: '提炼' });
      if (saved) await host.studyforgeThoughts.update({ ...context, expectedVersion: saved.version }, saved.ref, data, () => graph);
      else await host.studyforgeThoughts.create(context, idOf(context.sessionId!), graph);
      return { recorded: true, title: data.title };
    },
  }));
}
