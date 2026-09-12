import type { Context } from '@deepseek-ai/cordis';
import type { SourceAnchor } from '@studyforge/contracts/materials';
import { CardDetail } from '../cards/CardDetail.tsx';
import { KnowledgeEditor } from '../cards/KnowledgeEditor.tsx';
import { MemoryEditor } from '../memory/MemoryEditor.tsx';
import { useEffect, useState } from 'react';
import { MarkdownBody } from '../cards/MarkdownBody.tsx';
import { PlanEditor } from '../planning/PlanEditor.tsx';

/** Open the exact saved object a projection named, without guessing a current list row. */
export function LearningObject({ ctx, target, sessionId, onBack, onSource }: {
  ctx: Context; target: string; sessionId?: string; onBack(): void; onSource?: (source: SourceAnchor) => void;
}): React.JSX.Element {
  const bound = sessionId ? { sessionId } : {};
  const [record, setRecord] = useState<{ title: string; body: string }>(), [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let live = true; setRecord(undefined); setUnavailable(false);
    void (async () => {
      let value: { title: string; body: string } | undefined;
      if (target.startsWith('set:')) {
        const result = await ctx.remote.studyforgeOrganization.set({ ref: target });
        if (result.ok) value = { title: result.value.name, body: `${result.value.subjects.join(' · ')}\n\n复习间隔：${result.value.ladder?.join(' → ') ?? '默认'}\n\n${result.value.materials.length} 份资料，${result.value.members.length} 张指定卡片。` };
      } else if (target.startsWith('plan:')) {
        const result = await ctx.remote.studyforgeOrganization.plan({ ref: target });
        if (result.ok) { const plan = result.value.content; value = { title: plan.title, body: plan.kind === 'book'
          ? plan.entries.map(row => `${row.date} · ${row.chapter ?? '书中选段'}`).join('\n\n')
          : `${plan.start} 至 ${plan.end}\n\n每天 ${plan.dailyCount} 张\n\n` + plan.schedule.map(row => `${row.date} · ${row.cards.length} 张`).join('\n\n') }; }
      } else if (target.startsWith('route:')) {
        const result = await ctx.remote.studyforgeOrganization.route();
        if (result.ok) value = { title: '课程安排', body: result.value.nodes.map(node => `${node.title}${node.date ? ' · ' + node.date : ''}${node.session ? ' · 已开课' : ''}`).join('\n\n') };
      } else if (target.startsWith('skeleton:')) {
        const result = await ctx.remote.studyforgeMaterials.skeleton({ materialId: target.slice(9) });
        if (result.ok) value = { title: '目录', body: result.value.nodes.map(node => node.path).join('\n\n') };
      } else if (target.startsWith('handoff:')) {
        const result = await ctx.remote.studyforgeHandoffs.read({ ref: target });
        if (result.ok) value = { title: result.value.title, body: result.value.body };
      } else if (target.startsWith('course:') && sessionId) {
        const result = await ctx.remote.studyforgeCourses.read({ sessionId });
        if (result.ok) value = { title: '本课设置', body: `${result.value.data.lessonMaterials.materials.length} 项教学资料。\n\n${result.value.data.stance ?? ''}\n\n${result.value.data.temporaryInstructions ?? ''}` };
      } else return;
      if (!live) return;
      if (value) setRecord(value); else setUnavailable(true);
    })().catch(() => { if (live) setUnavailable(true); });
    return () => { live = false; };
  }, [ctx, target, sessionId]);
  return <section className="sf-learning-object" data-testid="learning-object">
    <button className="sf-quiet" onClick={onBack}>返回</button>
    {target.startsWith('card:') ? <CardDetail key={target} ctx={ctx} target={target} {...bound} {...(onSource ? { onSource } : {})} />
      : target.startsWith('knowledge:') ? <KnowledgeEditor key={target} ctx={ctx} target={target} {...bound} onSaved={onBack} />
      : target.startsWith('memory:') ? <MemoryEditor key={target} ctx={ctx} target={target} {...bound} onSaved={onBack} onCancel={onBack} />
      : target.startsWith('plan:') ? <PlanEditor key={target} ctx={ctx} target={target} {...bound} />
      : record ? <><h3>{record.title}</h3><MarkdownBody text={record.body} /></> : <p>{unavailable ? '这份记录暂时无法读取。' : '正在读取…'}</p>}
  </section>;
}
