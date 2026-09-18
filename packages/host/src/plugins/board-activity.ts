import type { Context } from '@deepseek-ai/cordis';
import type { HostContext, MutationContext } from '@studyforge/contracts';
import { WorkbenchActivityEntrySchema, WorkbenchOpSchema, type WorkbenchActivityEntry, type WorkbenchActivitySchema, type WorkbenchOp, type WorldbookDocument } from '@studyforge/contracts/plugins';
import type { PluginDocument } from '@studyforge/contracts/plugin-learning';
import type { MathObject } from '@studyforge/contracts/math-scene';
import type { RecordStore } from '@studyforge/domain/storage';
import type { Clock } from '@studyforge/domain/clock';
import { RecordError } from '@studyforge/domain/storage';
import { packageId } from './plugin-manager.ts';

declare module '@deepseek-ai/cordis' { interface Context { studyforgeBoardActivity: BoardActivity } }

const short = (value: number): string => String(Number(value.toPrecision(4)));
const KIND_LABEL: Record<MathObject['kind'], string> = {
  function: '函数', parametric: '参数曲线', implicit: '隐式曲线', point: '点', glider: '动点', line: '线', vector: '向量', circle: '圆', polygon: '多边形',
  tangent: '切线', midpoint: '中点', intersection: '交点', parallel: '平行线', perpendicular: '垂线', circumcircle: '三点圆', angle: '角', conic: '圆锥曲线',
  point3d: '空间点', midpoint3d: '空间中点', line3d: '空间线', vector3d: '空间向量', plane3d: '平面', polygon3d: '空间多边形', sphere3d: '球',
  function3d: '函数曲面', parametric3d: '空间参数曲线', surface3d: '参数曲面',
};
const FIELD_LABEL: Record<string, string> = {
  title: '标题', blocks: '板书块', entries: '条目', events: '事件', steps: '步骤', resources: '资源', choices: '选项', question: '题目', conclusion: '结论',
  explanation: '解析', repair: '修复', background: '背景', rounds: '轮数', errorIndex: '错误位置', observation: '观察', links: '关联资料', fictional: '虚构标记',
  classroom: '教室配置', diagram: '图示', reason: '理由', body: '正文', place: '地点', year: '年份', latitude: '纬度', longitude: '经度',
};

type Scene = Extract<PluginDocument, { kind: 'math' }>;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function mathChange(before: Scene, after: Scene): string[] {
  const out: string[] = [];
  if (before.title !== after.title) out.push(`改名「${after.title}」`);
  const prev = new Map(before.objects.map(object => [object.name, object]));
  const next = new Map(after.objects.map(object => [object.name, object]));
  const added = after.objects.filter(object => !prev.has(object.name));
  const removed = before.objects.filter(object => !next.has(object.name));
  for (const object of added.slice(0, 4)) out.push(`新增${KIND_LABEL[object.kind] ?? object.kind} ${object.name}`);
  if (added.length > 4) out.push(`共新增 ${added.length} 个对象`);
  if (removed.length) out.push(`删除 ${removed.slice(0, 4).map(object => object.name).join('、')}${removed.length > 4 ? ` 等 ${removed.length} 项` : ''}`);
  for (const object of after.objects) {
    const old = prev.get(object.name);
    if (!old || old.kind !== object.kind || same(old, object)) continue;
    if ((object.kind === 'point' || object.kind === 'point3d' || object.kind === 'glider') && 'x' in object && 'x' in old) {
      const { x: _x1, y: _y1, z: _z1, ...restOld } = old as Record<string, unknown>;
      const { x: _x2, y: _y2, z: _z2, ...restNew } = object as Record<string, unknown>;
      if (!same(restOld, restNew)) { out.push(`修改 ${object.name}`); continue; }
      const coordinates = [object.x, ...('y' in object ? [object.y] : []), ...('z' in object ? [object.z] : [])];
      out.push(object.kind === 'glider' ? `动点 ${object.name} 移到 x=${short(object.x)}` : `${object.name} 移到 (${coordinates.map(short).join(', ')})`);
      continue;
    }
    out.push(`修改 ${object.name}`);
  }
  const prevParameter = new Map(before.parameters.map(parameter => [parameter.name, parameter]));
  const nextParameter = new Map(after.parameters.map(parameter => [parameter.name, parameter]));
  for (const parameter of after.parameters) {
    const old = prevParameter.get(parameter.name);
    if (!old) { out.push(`新增参数 ${parameter.name}=${short(parameter.value)}`); continue; }
    if (same(old, parameter)) continue;
    const { value: _v1, ...restOld } = old, { value: _v2, ...restNew } = parameter;
    out.push(same(restOld, restNew) ? `参数 ${parameter.name}：${short(old.value)} → ${short(parameter.value)}` : `修改参数 ${parameter.name}`);
  }
  for (const parameter of before.parameters) if (!nextParameter.has(parameter.name)) out.push(`删除参数 ${parameter.name}`);
  if (!same(before.viewport, after.viewport)) out.push('调整视区');
  if (before.view !== after.view) out.push(after.view === '3d' ? '切换到三维视图' : '切换到二维视图');
  if (!same(before.space, after.space)) {
    const camera = before.space.azimuth !== after.space.azimuth || before.space.elevation !== after.space.elevation;
    out.push(same(before.space.bounds, after.space.bounds) ? (camera ? '旋转三维视角' : '调整三维视角') : '调整三维范围');
  }
  if (before.observation !== after.observation) out.push('更新观察笔记');
  if (!same(before.links, after.links)) out.push('更新关联资料');
  return out;
}

/** Field-level diff for document kinds without object semantics. */
function genericChange(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])]) {
    if (key === 'kind' || same(before[key], after[key])) continue;
    const label = FIELD_LABEL[key] ?? key, a = before[key], b = after[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      const titles = (rows: unknown[]): string[] => rows.map(row => row && typeof row === 'object' ? String((row as { title?: unknown; label?: unknown }).title ?? (row as { label?: unknown }).label ?? '') : '').filter(Boolean);
      const added = titles(b).filter(title => !titles(a).includes(title)), removed = titles(a).filter(title => !titles(b).includes(title));
      if (added.length || removed.length) out.push(`${label}：${[...added.slice(0, 3).map(title => `+${title}`), ...removed.slice(0, 3).map(title => `−${title}`)].join(' ')}`);
      else out.push(b.length - a.length > 0 ? `${label} +${b.length - a.length}` : b.length - a.length < 0 ? `${label} ${b.length - a.length}` : `修改${label}`);
    } else out.push(`修改${label}`);
    if (out.length >= 6) break;
  }
  return out;
}

export function summarizeDocumentChange(before: PluginDocument, after: PluginDocument): string {
  const items = before.kind === 'math' && after.kind === 'math' ? mathChange(before, after) : genericChange(before, after);
  return (items.length ? items.slice(0, 6).join('；') + (items.length > 6 ? ` 等 ${items.length} 项` : '') : '内容未变').slice(0, 600);
}
export function summarizeWorldbookChange(before: WorldbookDocument, after: WorldbookDocument): string {
  // Entry titles are gated worldbook content: a title in the prompt-side
  // activity feed would leak what the intimacy/role gates deliberately
  // withhold. Diff the entries array as a count, never by name.
  const { entries: beforeEntries, ...restBefore } = before;
  const { entries: afterEntries, ...restAfter } = after;
  const items = genericChange(restBefore as Record<string, unknown>, restAfter as Record<string, unknown>);
  if (JSON.stringify(beforeEntries) !== JSON.stringify(afterEntries)) {
    const delta = afterEntries.length - beforeEntries.length;
    items.push(delta === 0 ? '修改条目' : `条目 ${delta > 0 ? '+' : ''}${String(delta)}`);
  }
  return (items.length ? items.slice(0, 6).join('；') : '内容未变').slice(0, 600);
}

/** One append-only trail per (lesson, workbench); keyed without digest so a
 * plugin upgrade does not orphan the history. Entries are written by the same
 * mutation that caused them — the source operationId keeps retries idempotent. */
export class BoardActivity {
  readonly host: Context; readonly records: RecordStore<typeof WorkbenchActivitySchema>; readonly clock: Clock;
  constructor(host: Context, records: RecordStore<typeof WorkbenchActivitySchema>, clock: Clock) { this.host = host; this.records = records; this.clock = clock; }
  static key(sessionId: string, id: string): string { return packageId(sessionId + ':' + id); }
  private stored(context: HostContext, sessionId: string, id: string): { revision: number; events: WorkbenchActivityEntry[] } | undefined {
    const row = this.records.list(context).find(row => row.ref === 'workbenchactivity:' + BoardActivity.key(sessionId, id));
    return row ? { revision: row.version, events: row.data.events } : undefined;
  }
  async append(context: MutationContext, input: { id: string; kind: WorkbenchActivityEntry['kind']; revision?: number | undefined; op?: WorkbenchOp | undefined; detail?: string | undefined; at?: string | undefined }): Promise<void> {
    if (!context.sessionId) return;
    try {
      const op = input.op ? WorkbenchOpSchema.parse(input.op) : undefined;
      const entry = WorkbenchActivityEntrySchema.parse({
        at: input.at ?? this.clock.now(), actor: context.actor, kind: input.kind,
        ...(input.revision === undefined ? {} : { revision: input.revision }),
        ...(op?.labels?.length ? { labels: [...new Set(op.labels.map(label => label.trim()).filter(Boolean))].slice(0, 8) } : {}),
        ...(input.detail ? { detail: input.detail.slice(0, 600) } : {}),
      });
      const key = BoardActivity.key(context.sessionId, input.id), ref = 'workbenchactivity:' + key;
      const ctx: Omit<MutationContext, 'expectedVersion'> = { workspaceId: context.workspaceId, sessionId: context.sessionId, actor: context.actor, purpose: context.purpose, operationId: context.operationId };
      const existing = this.stored(ctx, context.sessionId, input.id);
      if (existing && this.records.changes(ctx, ref).some(change => change.operationId === context.operationId)) return;
      if (!existing) await this.records.create(ctx, key, { sessionId: context.sessionId, id: input.id, events: [entry] });
      else await this.records.updateCurrent(ctx, ref, entry, current => ({ ...current, events: [...current.events, entry].slice(-160) }));
    } catch (error) {
      this.host.logger('studyforge-board-activity').warn('append failed', error);
    }
  }
  /** Stored entries merged with uncovered record operations: writes from before
   * this feature (or without labels) still appear, with diffs computed on read. */
  async activity(context: HostContext, sessionId: string, id: string): Promise<WorkbenchActivityEntry[]> {
    const events = [...(this.stored(context, sessionId, id)?.events ?? [])];
    const covered = new Set(events.flatMap(entry => entry.revision === undefined ? [] : [`${entry.kind}:${entry.revision}`]));
    // Every write path pins the board first, so an unpinned board has no trail;
    // reading activity must not create the pin itself.
    const content = await this.host.studyforgePluginsManager.openedWorkbench(sessionId, id);
    if (!content) return events;
    const digestKey = packageId(sessionId + ':' + id + ':' + content.digest);
    const documents = this.host.studyforgeLearningWorkbenches.records, drafts = this.host.studyforgeWorkbenchData.drafts, books = this.host.studyforgeWorkbenchData.books;
    const synth = (kind: WorkbenchActivityEntry['kind'], revision: number, at: string, actor: WorkbenchActivityEntry['actor'], detail?: string): void => {
      if (!covered.has(`${kind}:${revision}`)) events.push({ at, actor, kind, revision, ...(detail ? { detail } : {}) });
    };
    try {
      for (const change of documents.changes(context, 'plugindocument:' + digestKey).slice(-60)) {
        const before = change.beforeRevision === null ? undefined : documents.read(context, 'plugindocument:' + digestKey, change.beforeRevision).data.document;
        const after = documents.read(context, 'plugindocument:' + digestKey, change.afterRevision).data.document;
        synth('document', change.afterRevision, change.committedAt, change.actor, before ? summarizeDocumentChange(before, after) : '创建文档');
      }
    } catch (error) { if (!(error instanceof RecordError)) throw error; }
    try {
      for (const change of drafts.changes(context, 'workbenchdraft:' + digestKey).slice(-40)) synth('draft', change.afterRevision, change.committedAt, change.actor, '更新草稿');
    } catch (error) { if (!(error instanceof RecordError)) throw error; }
    if (content.kind === 'worldbook' || content.kind === 'classroom') try {
      const ref = 'worldbook:' + packageId(id);
      for (const change of books.changes(context, ref).slice(-40)) {
        if (change.sessionId !== sessionId) continue;
        const before = change.beforeRevision === null ? undefined : books.read(context, ref, change.beforeRevision).data.document;
        synth('worldbook', change.afterRevision, change.committedAt, change.actor, before ? summarizeWorldbookChange(before, books.read(context, ref, change.afterRevision).data.document) : '创建文档');
      }
    } catch (error) { if (!(error instanceof RecordError)) throw error; }
    return events.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  }
  async view(context: HostContext, id: string, limit: number): Promise<unknown> {
    const content = await this.host.studyforgePluginsManager.openedWorkbench(context.sessionId!, id);
    const events = await this.activity(context, context.sessionId!, id);
    return { id, title: content?.title ?? id, kind: content?.documentKind ?? content?.kind ?? 'html', total: events.length, events: events.slice(-limit) };
  }
  async boards(context: HostContext, sessionId: string): Promise<unknown> {
    const rows = [];
    for (const choice of this.host.studyforgePluginsManager.workbenches(sessionId)) {
      const events = await this.activity(context, sessionId, choice.id);
      if (events.length) rows.push({ id: choice.id, title: choice.title, events: events.length, last: events.at(-1)!.at });
    }
    return { workbenches: rows };
  }
  /** Teacher-facing snapshot injected at assemble: what the student actually did
   * on boards since the lesson began. Teacher's own writes are theirs already. */
  async prompt(context: HostContext, sessionId: string): Promise<string> {
    const lines: string[] = [];
    for (const choice of this.host.studyforgePluginsManager.workbenches(sessionId)) {
      const events = (await this.activity(context, sessionId, choice.id)).filter(entry => entry.actor === 'student').slice(-8);
      for (const entry of events) {
        const doing = [entry.labels?.join('；'), entry.detail].filter(Boolean).join('；') || '写入';
        lines.push(`- ${choice.title} · ${entry.at.slice(5, 16).replace('T', ' ')} · ${entry.revision === undefined ? '' : `修订${entry.revision} · `}${doing}`);
      }
    }
    if (!lines.length) return '';
    return '学生近期在工作台上的操作：\n' + lines.slice(-8).join('\n');
  }
}
