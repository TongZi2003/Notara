import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import { CourseViewSchema, LearningGoalSchema, type LearningContext, type LearningPath } from '@studyforge/contracts/courses';
import { studyOf } from '@studyforge/domain/routes';
import { courseRecordRef } from '@studyforge/domain/courses';
import { teacherContext, observedVersion, rejected } from '../tools/learning-context.ts';
import { toolSchema } from '../tools/tool-schema.ts';

/** One diagnostic course owns the goal; confirmed handoff and route are existing records. */
export function routeStudyContext(host: Context, ctx: HostContext): LearningContext | undefined {
  if (!ctx.sessionId) return undefined;
  const course = host.studyforgeCourseMetadata.read(ctx).data;
  if (course.learningContext) return course.learningContext;
  if (!course.guided) return undefined;
  if (!course.learningGoal) throw rejected('路线需要先有学生实际目标：先用note_learning_goal记录目标和时间条件');
  if (!course.closure?.handoffVersion) throw rejected('正式路线需要诊断小结先经学生确认：用propose(method=handoff)提出诊断小结，等学生在界面上确认后再重新提交propose(method=route)；若界面显示小结已确认，说明上次提交被拒没有留下提案，直接重新提交即可，不要让用户重复确认');
  const study = { originSessionId: ctx.sessionId, goal: course.learningGoal,
    diagnosis: { ref: course.closure.handoffRef, version: course.closure.handoffVersion } };
  validateStudy(host, ctx, study);
  return study;
}

export function validateStudy(host: Context, ctx: HostContext, study: LearningContext): void {
  const handoff = host.studyforgeHandoffService.readPinned(ctx, study.diagnosis);
  const origin = host.studyforgeCourseMetadata.read({ ...ctx, sessionId: study.originSessionId }).data;
  if (!origin.guided || handoff.sessionId !== study.originSessionId || origin.closure?.handoffRef !== study.diagnosis.ref
    || origin.closure.handoffVersion !== study.diagnosis.version || JSON.stringify(origin.learningGoal) !== JSON.stringify(study.goal)) {
    throw rejected('本课绑定的诊断小结或目标已经变化，旧路线上下文失效；先与学生核对当前目标与所属路线');
  }
}

export function learningPaths(host: Context, ctx: HostContext): LearningPath[] {
  const courses = host.studyforgeCourseMetadata.list(ctx), bySession = new Map(courses.map(row => [row.data.sessionId, row.data]));
  const route = host.studyforgeRouteService.read(ctx);
  return courses.filter(row => row.data.guided && !row.data.archived).map(({ data: course }) => {
    const nodes = route.nodes.filter(node => studyOf(route.nodes, node.id)?.originSessionId === course.sessionId);
    const lessons = nodes.map(node => {
      // A continued lesson retains its route task; an active continuation must
      // not be skipped merely because its preceding classroom already closed.
      const chain = new Set(node.session ? [node.session.sessionId] : []);
      let changed = true;
      while (changed) {
        changed = false;
        for (const { data } of courses) if (!chain.has(data.sessionId) && data.learningContext?.nodeId === node.id && data.continuation
          && [...chain].some(id => bySession.get(id)?.closure?.handoffRef === data.continuation!.ref)) { chain.add(data.sessionId); changed = true; }
      }
      const active = [...chain].find(id => !bySession.get(id)?.closure);
      return { nodeId: node.id, title: node.title,
        ...(active ?? node.session?.sessionId ? { sessionId: active ?? node.session!.sessionId } : {}), ...(node.date ? { date: node.date } : {}),
        closed: chain.size > 0 && !active };
    });
    const title = course.learningGoal?.title ?? '新的学习路线';
    if (!course.closure) return { originSessionId: course.sessionId, title, status: 'diagnosing' as const,
      next: { title: '继续诊断', sessionId: course.sessionId }, lessons };
    if (!nodes.length) return { originSessionId: course.sessionId, title, status: 'planning' as const,
      next: { title: '安排学习路线', sessionId: course.sessionId }, lessons };
    const unfinished = lessons.filter(lesson => !lesson.closed);
    const active = unfinished.find(lesson => lesson.sessionId);
    const ready = unfinished.filter(lesson => {
      const parent = nodes.find(node => node.id === lesson.nodeId)?.parent;
      return !parent || !nodes.some(node => node.id === parent) || lessons.some(item => item.nodeId === parent && item.closed);
    }).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
    const next = active ?? ready[0];
    return { originSessionId: course.sessionId, title, status: unfinished.length ? 'learning' as const : 'complete' as const,
      ...(next ? { next: { title: next.title, ...(next.sessionId ? { sessionId: next.sessionId } : { nodeId: next.nodeId }), ...(next.date ? { date: next.date } : {}) } } : {}), lessons };
  });
}

export function registerGuidedLearning(host: Context): void {
  host.effect(() => host.tools.register({ name: 'note_learning_goal',
    description: '记录学生实际提出的学习目标和时间条件，进入完整诊断。先read_lesson；title写目标，deadline/dailyMinutes只在学生提供时填写。只更新本课目标，不代表诊断完成或安排已经保存；诊断收课后目标固定，新的目标另开课。',
    parameters: toolSchema(LearningGoalSchema),
    output: { schema: toolSchema(CourseViewSchema), render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, execution) {
      const goal = LearningGoalSchema.parse(args), ctx = await teacherContext(host, execution);
      const current = host.studyforgeCourseMetadata.read(ctx);
      if (current.data.learningContext) throw rejected('本课已属于既有学习路线；调整后续安排用propose(method=route)，新目标另开一节诊断课');
      if (current.data.closure) {
        if (JSON.stringify(current.data.learningGoal) === JSON.stringify(goal)) return current;
        throw rejected('诊断小结已确认，旧目标保持；新目标请从首页开始一条新的学习路线');
      }
      return host.studyforgeCourseMetadata.update({ ...ctx, expectedVersion: await observedVersion(host, execution, courseRecordRef(ctx.sessionId!)) },
        { guided: true, learningGoal: goal });
    },
  }));
}

export function guidedBrief(host: Context, ctx: HostContext): string {
  const course = host.studyforgeCourseMetadata.read(ctx).data;
  if (course.learningContext) {
    const study = course.learningContext, handoff = host.studyforgeHandoffService.readPinned(ctx, study.diagnosis);
    const path = learningPaths(host, ctx).find(item => item.originSessionId === study.originSessionId);
    return `本课所属学习目标：${JSON.stringify(study.goal)}\n制定路线时确认的诊断小结《${handoff.title}》（固定第${study.diagnosis.version}版）：\n${handoff.body}\n当前路线实际状态：${JSON.stringify(path ?? null)}\n本课按自己的重点教学与检验。收课时对照目标说明实际结果；需补练或改期用现有路线/计划提案调整未来节点，保留已开展课程。`;
  }
  if (!course.guided) return '';
  return `学生选择了完整诊断后的路线学习。当前目标：${JSON.stringify(course.learningGoal ?? null)}。\n${course.closure ? '诊断小结已由学生确认，可以读取路线并提出接下来的学习任务和日程。' : '尚未确认诊断结束。围绕目标完成较完整诊断，不能提前生成正式路线。'}`;
}
