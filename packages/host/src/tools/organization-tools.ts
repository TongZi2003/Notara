import { entityReferenceContent } from './entity-reference-output.ts';
import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { SetCreateSchema, SetPatchSchema, SetViewSchema } from '@studyforge/contracts/sets';
import { RouteNodeInputSchema, RouteNodePatchSchema, RouteViewSchema } from '@studyforge/contracts/routes';
import { PlanContentSchema, PlanPatchSchema, PlanViewSchema, SkeletonChangeSchema } from '@studyforge/contracts/plans';
import { SkeletonViewSchema } from '@studyforge/contracts/skeleton';
import { ATLAS_REF, AtlasChangeSchema, AtlasViewSchema } from '@studyforge/contracts/atlas';
import type { ProposalInput } from '@studyforge/contracts/proposals';
import { teacherContext, observedVersion, rejected } from './learning-context.ts';
import { existingProposal, proposeFromTool, proposalOutput } from './proposal-tools.ts';
import { toolSchema } from './tool-schema.ts';
import { CoursePatchSchema, CourseViewSchema } from '@studyforge/contracts/courses';
import { JourneyViewSchema } from '@studyforge/contracts/journey';
import { courseRecordRef } from '@studyforge/domain/courses';
import { journeyView } from '@studyforge/domain/journey';
import { canonicalPath } from '@studyforge/domain/access';
import { civilDay } from '@studyforge/domain/read-day';
import { routeStudyContext } from '../teaching/guided-learning.ts';
import { assertRefinedReads } from './source-use-tools.ts';

/** Authoring is a proposal; reads and expansion never change plans or open lessons. */
export function registerOrganizationTools(host: Context): void {
  const ref = z.object({ target: z.string().min(1) }).strict();
  function read(name: string, description: string, input: z.ZodType, output: z.ZodType, run: (args: unknown, execution: ToolRunContext) => Promise<unknown>): void {
    host.effect(() => host.tools.register({ name, description, parameters: toolSchema(input),
      output: { schema: toolSchema(output), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }, ...entityReferenceContent(value)] },
      execute: run,
    }));
  }
  read('list_sets', '列出本人学习集。学习集组织材料与复习政策，不限制本人阅读。', z.object({}).strict(), z.array(SetViewSchema),
    async (_args, execution) => host.studyforgeSetService.list(await teacherContext(host, execution)));
  read('read_set', '读一个已有学习集的实际材料、成员和政策；修改前先读。', ref, SetViewSchema,
    async (args, execution) => host.studyforgeSetService.read(await teacherContext(host, execution), ref.parse(args).target));
  read('list_plans', '列出本人已有的书本安排和复习计划；修改时选择实际目标，不按同名覆盖。', z.object({}).strict(), z.array(PlanViewSchema),
    async (_args, execution) => host.studyforgePlanService.list(await teacherContext(host, execution)));
  read('read_plan', '读取明确的计划目标和内容，修改前先读。', ref, PlanViewSchema,
    async (args, execution) => host.studyforgePlanService.read(await teacherContext(host, execution), ref.parse(args).target));
  read('read_route', '读取课程路线、计划节点和真实已开课绑定；展开不创建课程。', z.object({}).strict(), RouteViewSchema.omit({ layout: true }),
    async (_args, execution) => {
      const { layout: _studentLayout, ...route } = host.studyforgeRouteService.read(await teacherContext(host, execution));
      return route;
    });
  const skeletonRead = z.object({ materialId: z.string().min(1) }).strict();
  read('read_skeleton', '读取这份真实资料的目录，修改之前先读取。没有目录不表示书为空。', skeletonRead, SkeletonViewSchema,
    async (args, execution) => host.studyforgeSkeletonService.read(await teacherContext(host, execution), skeletonRead.parse(args).materialId));
  read('read_atlas', '读取工作区知识地图(atlas)：不依赖任何单一资料的跨书层次归属树，卡的topic字段挂到这些路径上。修改之前先读取；没有地图不表示卡为空。', z.object({}).strict(), AtlasViewSchema,
    async (_args, execution) => host.studyforgeAtlasService.read(await teacherContext(host, execution)));
  read('read_lesson', '读取当前课的材料、学习集和教学方式；修改之前先读，不能借此关闭课堂。', z.object({}).strict(), CourseViewSchema.extend({ ref: z.string() }),
    async (_args, execution) => { const context = await teacherContext(host, execution); return { ref: courseRecordRef(context.sessionId!), ...host.studyforgeCourseMetadata.read(context) }; });
  read('read_journey', '读取本工作区全部学习经历的索引：每节课的小结指针与当时系统事实（材料/产出/待确认）、路线已开与未开节点、卡片复习态势、学情与方法清单。续接下一段、规划新路线或回答「之前学了什么」先读这里定位，不凭印象复述；需要哪段的正文再按需精读——小结用open(method=handoff)给ref/version，卡用read_card，学情用read_memory/search_memory，方法用read_method。读取是投影不产生写入，不替代修改前的完整读取。', z.object({}).strict(), JourneyViewSchema,
    async (_args, execution) => {
      const context = await teacherContext(host, execution);
      const native = await host.sessionController.list({}, AbortSignal.timeout(10_000));
      const lessons = native.items
        .filter(row => row.projections?.values.agentPreset === 'studyforge-learning' && row.origin !== 'subagent' && row.cwd !== undefined && canonicalPath(row.cwd, host.studyforgeAccess.root) === host.studyforgeAccess.root)
        .map(row => ({ sessionId: String(row.sessionId), title: String(row.projections?.values.title ?? '课堂').slice(0, 240) }));
      const route = host.studyforgeRouteService.read(context);
      return journeyView({
        handoffs: host.studyforgeHandoffService.list(context),
        lessons,
        route: route.version === 0 ? null : route,
        cards: host.studyforgeCardRecords.list(context),
        today: civilDay(host.studyforgeClock.now(), host.studyforgeClock.timeZone),
        memory: host.studyforgeMemoryService.list(context),
        knowledge: host.studyforgeKnowledgeRecords?.list(context) ?? [],
      });
    });

  function proposal(name: string, description: string, schema: z.ZodType, build: (args: unknown, execution: ToolRunContext) => Promise<Omit<ProposalInput, 'origin'>>): void {
    host.effect(() => host.tools.register({ name, description, parameters: toolSchema(schema), output: proposalOutput(),
      async execute(args, execution) {
        const parsed = schema.parse(args), old = await existingProposal(host, execution);
        return old ?? proposeFromTool(host, execution, await build(parsed, execution));
      },
    }));
  }
  const setInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), content: SetCreateSchema }).strict(),
    z.object({ action: z.literal('edit'), target: z.string().min(1), patch: SetPatchSchema }).strict(),
  ]);
  proposal('propose_lesson_settings', '提议调整当前这节课的材料、学习集或教法，学生确认后修改同一节课。先用read_lesson查看当前内容。archived只表示把这节课归入归档，不是结束这节课；收课小结与结束状态要用propose_handoff。', CoursePatchSchema, async (args, execution) => {
    const context = await teacherContext(host, execution), target = courseRecordRef(context.sessionId!);
    return { title: '调整本课设置', items: [{ target, baseline: await observedVersion(host, execution, target), effect: { kind: 'lesson-edit', patch: CoursePatchSchema.parse(args) } }] };
  });
  proposal('propose_set', '提议新建或调整指定学习集，学生确认后才生效；既有成员与材料只作显式增删。', setInput, async (args, execution) => {
    const input = setInput.parse(args);
    if (input.action === 'create') return { title: input.content.name, items: [{ target: null, baseline: null, effect: { kind: 'set-create', content: input.content } }] };
    const baseline = await observedVersion(host, execution, input.target);
    return { title: '调整学习集', items: [{ target: input.target, baseline, effect: { kind: 'set-edit', patch: input.patch } }] };
  });
  const planInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), content: PlanContentSchema }).strict(),
    z.object({ action: z.literal('edit'), target: z.string().min(1), patch: PlanPatchSchema }).strict(),
  ]);
  proposal('propose_plan', '提议新增计划或调整明确的已有计划。create的kind=book需要materialId与entries；kind=campaign只有title、dailyCount、start、end必填，learningSetRef/tags/cards/schedule都可省略，省略即按null与空数组保存，和学生确认后的形状一致。schedule非空表示学生明确的整份日程，此时dailyCount不再决定取卡；schedule省略或为空表示不排具体日子，按每天dailyCount张的额度选卡。edit用target加patch，先read_plan看清当前内容；日期与日程照学生实际选择，不自动顺延。', planInput, async (args, execution) => {
    const input = planInput.parse(args);
    if (input.action === 'create') return { title: input.content.title, items: [{ target: null, baseline: null, effect: { kind: 'plan-create', content: input.content } }] };
    return { title: '调整计划', items: [{ target: input.target, baseline: await observedVersion(host, execution, input.target), effect: { kind: 'plan-edit', patch: input.patch } }] };
  });
  const routeInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('add'), nodes: z.array(RouteNodeInputSchema.omit({ study: true }).extend({
      parentIndex: z.number().int().nonnegative().optional().describe('本批前面节点的下标，从0开始；有此字段时parent留空'),
    }).strict()).min(1) }).strict(),
    z.object({ action: z.literal('edit'), nodeId: z.string().min(1), patch: RouteNodePatchSchema }).strict(),
  ]);
  proposal('propose_route', '提议计划课程：可以无材料或带混合材料，学生确认后仍未开课。先read_route看清现有节点与真实已开课绑定。action=add时每个节点的parent写read_route里已存在的节点标识，新起一支或没有可挂节点时写parent:null；要把本批前面刚加的新节点当父，就改用它在本次数组里的下标parentIndex（从0开始），此时parent必须为null。action=edit用节点标识nodeId加patch。', routeInput, async (args, execution) => {
    const input = routeInput.parse(args);
    const study = routeStudyContext(host, await teacherContext(host, execution));
    if (input.action === 'add') return { title: '接下来的课程', items: input.nodes.map(({ parentIndex, ...content }, index) => {
      if (parentIndex !== undefined && (parentIndex >= index || content.parent !== null)) throw rejected('同批父节点必须在本节点前面，不能同时指定已有parent');
      return { target: null, baseline: null, effect: { kind: 'route-add' as const, content: { ...content, ...(study ? { study } : {}) },
        ...(parentIndex === undefined ? {} : { parentItem: `item-${parentIndex + 1}` }) } };
    }) };
    return { title: '调整课程', items: [{ target: 'route:tree', baseline: await observedVersion(host, execution, 'route:tree'), effect: { kind: 'route-edit', nodeId: input.nodeId, patch: input.patch } }] };
  });
  const skeletonInput = z.object({ materialId: z.string().min(1), change: SkeletonChangeSchema }).strict();
  proposal('propose_skeleton', '提议增补目录或明确改径；未列出的兄弟章节保留。删除有依赖时先向学生说明影响，明确选择解除绑定才可保存。', skeletonInput, async (args, execution) => {
    const input = skeletonInput.parse(args), target = 'skeleton:' + input.materialId;
    await assertRefinedReads(host, execution, input.change.nodes.filter(node => node.detail === 'refined').flatMap(node => node.sources));
    return { title: '整理目录', items: [{ target, baseline: await observedVersion(host, execution, target), effect: { kind: 'skeleton-save', ...input } }] };
  });
  const atlasInput = z.object({ change: AtlasChangeSchema }).strict();
  proposal('propose_atlas', '提议增补或重整工作区知识地图(atlas)：跨书层次归属树，与某本书的骨架无关。卡的topic字段挂到这些路径上；未列出的兄弟层保留。repath会原子级联所有挂靠卡的topic；删除有依赖的层时先向学生说明影响，明确选择解除绑定才可保存。refined节点的sources必须来自本会话真实读过的范围。', atlasInput, async (args, execution) => {
    const input = atlasInput.parse(args);
    await assertRefinedReads(host, execution, input.change.nodes.filter(node => node.detail === 'refined').flatMap(node => node.sources ?? []));
    return { title: '整理知识地图', items: [{ target: ATLAS_REF, baseline: await observedVersion(host, execution, ATLAS_REF), effect: { kind: 'atlas-save', ...input } }] };
  });
}
