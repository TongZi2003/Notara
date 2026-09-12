import type { Context } from '@deepseek-ai/cordis';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { SetCreateSchema, SetPatchSchema, SetViewSchema } from '@studyforge/contracts/sets';
import { RouteNodeInputSchema, RouteNodePatchSchema, RouteViewSchema } from '@studyforge/contracts/routes';
import { PlanContentSchema, PlanPatchSchema, PlanViewSchema, SkeletonChangeSchema } from '@studyforge/contracts/plans';
import { SkeletonViewSchema } from '@studyforge/contracts/skeleton';
import type { ProposalInput } from '@studyforge/contracts/proposals';
import { teacherContext, observedVersion } from './learning-context.ts';
import { existingProposal, proposeFromTool, proposalOutput } from './proposal-tools.ts';
import { toolSchema } from './tool-schema.ts';
import { CoursePatchSchema, CourseViewSchema } from '@studyforge/contracts/courses';
import { courseRecordRef } from '@studyforge/domain/courses';

/** Authoring is a proposal; reads and expansion never change plans or open lessons. */
export function registerOrganizationTools(host: Context): void {
  const ref = z.object({ target: z.string().min(1) }).strict();
  function read(name: string, description: string, input: z.ZodType, output: z.ZodType, run: (args: unknown, execution: ToolRunContext) => Promise<unknown>): void {
    host.effect(() => host.tools.register({ name, description, parameters: toolSchema(input),
      output: { schema: toolSchema(output), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
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
  read('read_lesson', '读取当前课的材料、学习集和教学方式；修改之前先读，不能借此关闭课堂。', z.object({}).strict(), CourseViewSchema.extend({ ref: z.string() }),
    async (_args, execution) => { const context = await teacherContext(host, execution); return { ref: courseRecordRef(context.sessionId!), ...host.studyforgeCourseMetadata.read(context) }; });

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
  proposal('propose_lesson_settings', '提议调整当前这节课的材料、学习集或教法，学生确认后修改同一节课。先用read_lesson查看当前内容。', CoursePatchSchema, async (args, execution) => {
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
  proposal('propose_plan', '提议新增计划或调整明确的已有计划。日期、日程保留学生的选择；确认后保存。', planInput, async (args, execution) => {
    const input = planInput.parse(args);
    if (input.action === 'create') return { title: input.content.title, items: [{ target: null, baseline: null, effect: { kind: 'plan-create', content: input.content } }] };
    return { title: '调整计划', items: [{ target: input.target, baseline: await observedVersion(host, execution, input.target), effect: { kind: 'plan-edit', patch: input.patch } }] };
  });
  const routeInput = z.discriminatedUnion('action', [
    z.object({ action: z.literal('add'), nodes: z.array(RouteNodeInputSchema.extend({
      parentIndex: z.number().int().nonnegative().optional().describe('本批前面节点的下标，从0开始；有此字段时parent留空'),
    }).strict()).min(1) }).strict(),
    z.object({ action: z.literal('edit'), nodeId: z.string().min(1), patch: RouteNodePatchSchema }).strict(),
  ]);
  proposal('propose_route', '提议计划课程：可以无材料或带混合材料。parent引用已有节点；同批树可用parentIndex引用前面的节点，从0开始。学生确认后仍未开课。', routeInput, async (args, execution) => {
    const input = routeInput.parse(args);
    if (input.action === 'add') return { title: '接下来的课程', items: input.nodes.map(({ parentIndex, ...content }, index) => {
      if (parentIndex !== undefined && (parentIndex >= index || content.parent !== null)) throw new Error('同批父节点必须在本节点前面，不能同时指定已有parent。');
      return { target: null, baseline: null, effect: { kind: 'route-add' as const, content,
        ...(parentIndex === undefined ? {} : { parentItem: `item-${parentIndex + 1}` }) } };
    }) };
    return { title: '调整课程', items: [{ target: 'route:tree', baseline: await observedVersion(host, execution, 'route:tree'), effect: { kind: 'route-edit', nodeId: input.nodeId, patch: input.patch } }] };
  });
  const skeletonInput = z.object({ materialId: z.string().min(1), change: SkeletonChangeSchema }).strict();
  proposal('propose_skeleton', '提议增补目录或明确改径；未列出的兄弟章节保留。删除有依赖时先向学生说明影响，明确选择解除绑定才可保存。', skeletonInput, async (args, execution) => {
    const input = skeletonInput.parse(args), target = 'skeleton:' + input.materialId;
    return { title: '整理目录', items: [{ target, baseline: await observedVersion(host, execution, target), effect: { kind: 'skeleton-save', ...input } }] };
  });
}
