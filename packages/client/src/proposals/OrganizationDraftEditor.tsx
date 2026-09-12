/**
 * P6.4 the student's own edit of one organisation proposal.
 *
 * A proposal item freezes three things: the object it would write, the version
 * it was proposed against, and the teacher's draft. This editor only ever
 * replaces the *effect* — the描述学生真正确认的内容 — and hands it back through
 * `onSave`. It never touches the object itself and never calls a Remote: saving
 * is `studyforgeProposals.edit` on the original item, which is the owner's job.
 *
 * What the editor will not let the student lose is provenance. Every real anchor
 * the teacher's draft carried (`sources`, a card's own `cardVersion`, the same
 * batch's `parentItem`) travels through unchanged: the student edits the date,
 * the chapter path, the policy, the members or the mixed materials, and the
 * quoted originals stay exactly the ones the proposal was made from. A new
 * anchor is never invented here — there is nothing to read a page or a card body
 * from — so a line that could only be valid *with* a new anchor is shown as
 * facts the student may drop, not as a field to fill in.
 *
 * Every draft is validated against the same `ProposalEffectSchema` the owner
 * will parse, so a malformed edit is refused here with one readable line instead
 * of becoming a failed write.
 */
import { ProposalEffectSchema, type ProposalEffect } from '@studyforge/contracts/proposals';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { useState } from 'react';

/**
 * Every shape below is derived from `ProposalEffect` itself rather than imported
 * beside it: an effect's payload is the only thing this editor may hand back, so
 * naming it any other way would risk editing a look-alike type instead of the
 * one the owner will really parse.
 */
type SetCreate = Extract<ProposalEffect, { kind: 'set-create' }>['content'];
type SetPatch = Extract<ProposalEffect, { kind: 'set-edit' }>['patch'];
type RouteNodeInput = Extract<ProposalEffect, { kind: 'route-add' }>['content'];
type RouteNodePatch = Extract<ProposalEffect, { kind: 'route-edit' }>['patch'];
type RouteDecl = RouteNodeInput['decl'];
type RouteMaterial = RouteNodeInput['materials']['materials'][number];
type PlanContent = Extract<ProposalEffect, { kind: 'plan-create' }>['content'];
type PlanPatch = Extract<ProposalEffect, { kind: 'plan-edit' }>['patch'];
type BookPlanEntry = Extract<PlanContent, { kind: 'book' }>['entries'][number];
type CampaignDay = Extract<PlanContent, { kind: 'campaign' }>['schedule'][number];
type SkeletonChange = Extract<ProposalEffect, { kind: 'skeleton-save' }>['change'];
type SkeletonPath = SkeletonChange['nodes'][number]['path'];
type LessonPatch = Extract<ProposalEffect, { kind: 'lesson-edit' }>['patch'];

/**
 * The catalogs the owner may hand over so the student picks a real object by
 * name. They are structural on purpose: any Host view that can name a card or an
 * original fits, and a missing catalog only changes the control, never the
 * identity that gets written.
 */
export interface OrganizationMaterialOption {
  readonly materialId: string;
  readonly title: string;
  readonly versions: readonly { readonly versionId: string; readonly fileName: string }[];
}
export interface OrganizationCardOption {
  readonly ref: string;
  readonly version: number;
  readonly content: { readonly title: string };
}

/** The proposal kinds this editor owns; a card or review draft belongs elsewhere. */
export const ORGANIZATION_DRAFT_KINDS = ['set-create', 'set-edit', 'route-add', 'route-edit', 'plan-create', 'plan-edit', 'skeleton-save', 'lesson-edit'] as const;
export type OrganizationDraftKind = (typeof ORGANIZATION_DRAFT_KINDS)[number];
export function isOrganizationDraft(kind: string): kind is OrganizationDraftKind {
  return (ORGANIZATION_DRAFT_KINDS as readonly string[]).includes(kind);
}

/**
 * The catalogs are optional on purpose: with them the student picks a real card
 * or original by name, without them the same field takes an identity the student
 * already has. Neither form invents a target — the owner still validates it.
 */
export interface OrganizationDraftEditorProps {
  readonly effect: ProposalEffect;
  readonly original: ProposalEffect;
  readonly materials?: readonly OrganizationMaterialOption[];
  readonly cards?: readonly OrganizationCardOption[];
  /**
   * The teaching configurations the Host really has, so the choice names the
   * installed one by its own title. Absent only changes the control, never the
   * field: an empty choice means this proposal does not change 教学方式.
   */
  readonly teachingChoices?: readonly TeachingChoice[];
  readonly pending?: boolean;
  onSave(effect: ProposalEffect): void;
  onCancel(): void;
}

/**
 * One editor per draft revision: the owner should key this component by
 * `item.draft.revision` so a newer draft replaces the form instead of being
 * edited blind on a stale baseline.
 */
export function OrganizationDraftEditor(props: OrganizationDraftEditorProps): React.JSX.Element | null {
  const [problem, setProblem] = useState('');
  const { effect } = props;
  const commit = (next: ProposalEffect): void => {
    const parsed = ProposalEffectSchema.safeParse(next);
    if (!parsed.success) { setProblem('这一版还差一点：' + (parsed.error.issues[0]?.message ?? '格式不对')); return; }
    setProblem('');
    props.onSave(parsed.data);
  };
  return <div className="sf-org-form" data-testid="organization-draft-editor" data-draft-kind={effect.kind}>
    {renderForm(props, commit)}
    {problem !== '' && <p className="sf-notice" role="status" data-testid="organization-draft-problem">{problem}</p>}
  </div>;
}

function renderForm(props: OrganizationDraftEditorProps, commit: (effect: ProposalEffect) => void): React.JSX.Element {
  const { effect } = props;
  switch (effect.kind) {
    case 'set-create': return <SetCreateForm content={effect.content} {...props} onCommit={next => { commit({ kind: 'set-create', content: next }); }} />;
    case 'set-edit': return <SetEditForm patch={effect.patch} {...props} onCommit={next => { commit({ kind: 'set-edit', patch: next }); }} />;
    // `parentItem` (this batch's own edge) rides the effect, not the node input,
    // and is rebuilt explicitly rather than spread back: the effect is a union,
    // so the one field that must survive stays visible in the literal.
    case 'route-add': return <RouteAddForm content={effect.content} {...props} onCreate={next => {
      commit(effect.parentItem === undefined
        ? { kind: 'route-add', content: next }
        : { kind: 'route-add', content: next, parentItem: effect.parentItem });
    }} />;
    case 'route-edit': return <RouteEditForm nodeId={effect.nodeId} patch={effect.patch} {...props} onEdit={next => { commit({ kind: 'route-edit', nodeId: effect.nodeId, patch: next }); }} />;
    case 'plan-create': return <PlanCreateForm content={effect.content} {...props} onCommit={next => { commit({ kind: 'plan-create', content: next }); }} />;
    case 'plan-edit': return <PlanEditForm patch={effect.patch} {...props} onCommit={next => { commit({ kind: 'plan-edit', patch: next }); }} />;
    case 'skeleton-save': return <SkeletonForm materialId={effect.materialId} change={effect.change} {...props} onCommit={next => { commit({ kind: 'skeleton-save', materialId: effect.materialId, change: next }); }} />;
    case 'lesson-edit': return <LessonEditForm patch={effect.patch} {...props} onCommit={next => { commit({ kind: 'lesson-edit', patch: next }); }} />;
    default: return <p className="sf-note">这一类提案不在课程/计划的编辑范围里。</p>;
  }
}

// ---- sets ----------------------------------------------------------------

function SetCreateForm({ content, materials, cards, pending, onCommit, onCancel }: {
  readonly content: SetCreate;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly pending?: boolean | undefined;
  onCommit(next: SetCreate): void;
  onCancel(): void;
}): React.JSX.Element {
  const [name, setName] = useState(content.name);
  const [subjects, setSubjects] = useState(content.subjects.join('、'));
  const [ladder, setLadder] = useState(content.ladder === null ? '' : content.ladder.join(','));
  const [materialIds, setMaterialIds] = useState<readonly string[]>(content.materials);
  const [members, setMembers] = useState<readonly string[]>(content.members);
  return <>
    <label><span>学习集名</span>
      <input data-testid="draft-set-name" value={name} onChange={event => { setName(event.target.value); }} /></label>
    <label><span>学科（可选，顿号隔开）</span>
      <input data-testid="draft-set-subjects" value={subjects} onChange={event => { setSubjects(event.target.value); }} /></label>
    <label><span>复习梯子（天数，逗号隔开；留空＝不设自己的政策）</span>
      <input data-testid="draft-set-ladder" value={ladder} placeholder="1,2,4,7" onChange={event => { setLadder(event.target.value); }} /></label>
    <IdList label="书（原件）" testId="draft-set-materials" values={materialIds} options={(materials ?? []).map(item => ({ id: item.materialId, label: item.title }))} onChange={setMaterialIds} />
    <IdList label="先放进去的卡" testId="draft-set-members" values={members} options={(cards ?? []).map(item => ({ id: item.ref, label: item.content.title }))} onChange={setMembers} />
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      onCommit({
        name: name.trim(), subjects: splitList(subjects), ladder: parseLadder(ladder), materials: [...materialIds], members: [...members],
      });
    }} onCancel={onCancel} />
  </>;
}

function SetEditForm({ patch, materials, cards, pending, onCommit, onCancel }: {
  readonly patch: SetPatch;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly pending?: boolean | undefined;
  onCommit(next: SetPatch): void;
  onCancel(): void;
}): React.JSX.Element {
  const [name, setName] = useState(patch.name ?? '');
  const [subjects, setSubjects] = useState(patch.subjects === undefined ? '' : patch.subjects.join('、'));
  const [ladder, setLadder] = useState(patch.ladder === null ? '' : patch.ladder === undefined ? '' : patch.ladder.join(','));
  const [clearLadder, setClearLadder] = useState(patch.ladder === null);
  const [addMaterials, setAddMaterials] = useState<readonly string[]>(patch.materials_add);
  const [removeMaterials, setRemoveMaterials] = useState<readonly string[]>(patch.materials_remove);
  const [addMembers, setAddMembers] = useState<readonly string[]>(patch.members_add);
  const [removeMembers, setRemoveMembers] = useState<readonly string[]>(patch.members_remove);
  const [reason, setReason] = useState(patch.reason ?? '');
  return <>
    <label><span>改成什么名字（留空＝不改）</span>
      <input data-testid="draft-set-name" value={name} onChange={event => { setName(event.target.value); }} /></label>
    <label><span>学科（留空＝不改）</span>
      <input data-testid="draft-set-subjects" value={subjects} onChange={event => { setSubjects(event.target.value); }} /></label>
    <label><span>复习梯子（留空＝不改）</span>
      <input data-testid="draft-set-ladder" value={ladder} disabled={clearLadder} onChange={event => { setLadder(event.target.value); }} /></label>
    <label className="sf-org-check">
      <input type="checkbox" data-testid="draft-set-ladder-clear" checked={clearLadder} onChange={event => { setClearLadder(event.target.checked); }} />不设自己的梯子（跟着默认走）</label>
    <IdList label="加进来的书" testId="draft-set-materials-add" values={addMaterials} options={(materials ?? []).map(item => ({ id: item.materialId, label: item.title }))} onChange={setAddMaterials} />
    <IdList label="移出去的书" testId="draft-set-materials-remove" values={removeMaterials} options={(materials ?? []).map(item => ({ id: item.materialId, label: item.title }))} onChange={setRemoveMaterials} />
    <IdList label="加进来的卡" testId="draft-set-members-add" values={addMembers} options={(cards ?? []).map(item => ({ id: item.ref, label: item.content.title }))} onChange={setAddMembers} />
    <IdList label="移出去的卡" testId="draft-set-members-remove" values={removeMembers} options={(cards ?? []).map(item => ({ id: item.ref, label: item.content.title }))} onChange={setRemoveMembers} />
    <ReasonField value={reason} onChange={setReason} />
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      // A field the student left empty is a field the student did not decide:
      // it stays out of the patch, so the stored name/policy survives.
      const next: SetPatch = {
        materials_add: [...addMaterials], materials_remove: [...removeMaterials],
        members_add: [...addMembers], members_remove: [...removeMembers],
      };
      if (name.trim() !== '') next.name = name.trim();
      if (subjects.trim() !== '') next.subjects = splitList(subjects);
      if (clearLadder) next.ladder = null;
      else { const parsed = parseLadder(ladder); if (parsed !== undefined) next.ladder = parsed; }
      if (reason.trim() !== '') next.reason = reason.trim();
      onCommit(next);
    }} onCancel={onCancel} />
  </>;
}

// ---- route ---------------------------------------------------------------

/**
 * The fields a route node really has, shared by "add" and "edit" so the two forms
 * differ only in what they are allowed to write: an add owns its title, date,
 * materials and declaration; an edit may also *clear* the date or the
 * declaration, which is a different effect from leaving it alone.
 */
function useRouteFields(seed: { readonly title: string; readonly date: string | null | undefined; readonly decl: RouteDecl; readonly materials: RouteNodeInput['materials'] }) {
  const [title, setTitle] = useState(seed.title);
  const [date, setDate] = useState<string>(seed.date ?? '');
  const [decl, setDecl] = useState<RouteDecl>(seed.decl);
  const [list, setList] = useState<readonly RouteMaterial[]>(seed.materials.materials);
  const [initialIndex, setInitialIndex] = useState<number | undefined>(seed.materials.initialIndex);
  return { title, setTitle, date, setDate, decl, setDecl, list, setList, initialIndex, setInitialIndex };
}

function RouteAddForm({ content, materials, cards, pending, onCreate, onCancel }: {
  readonly content: RouteNodeInput;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly pending?: boolean | undefined;
  onCreate(next: RouteNodeInput): void;
  onCancel(): void;
}): React.JSX.Element {
  const fields = useRouteFields(content);
  return <>
    <label><span>课名</span>
      <input data-testid="draft-route-title" value={fields.title} onChange={event => { fields.setTitle(event.target.value); }} /></label>
    <label><span>安排在哪天（可留空）</span>
      <input type="date" data-testid="draft-route-date" value={fields.date} onChange={event => { fields.setDate(event.target.value); }} /></label>
    <MixedMaterials list={fields.list} initialIndex={fields.initialIndex} materials={materials} cards={cards} onChange={fields.setList} onInitial={fields.setInitialIndex} />
    <DeclFields decl={fields.decl} onChange={fields.setDecl} />
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      // The same batch's edge rides `parentItem` on the effect, never this input:
      // it is spread back untouched by the caller.
      onCreate({
        ...content, title: fields.title.trim(), date: fields.date === '' ? null : fields.date,
        materials: materialContext(fields.list, fields.initialIndex), decl: fields.decl,
      });
    }} onCancel={onCancel} />
  </>;
}

function RouteEditForm({ nodeId, patch, materials, cards, pending, onEdit, onCancel }: {
  readonly nodeId: string;
  readonly patch: RouteNodePatch;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly pending?: boolean | undefined;
  onEdit(next: RouteNodePatch): void;
  onCancel(): void;
}): React.JSX.Element {
  const fields = useRouteFields({ title: patch.title ?? '', date: patch.date, decl: patch.decl ?? {}, materials: patch.materials ?? { materials: [] } });
  const [clearDate, setClearDate] = useState(patch.date === null);
  const [clearDecl, setClearDecl] = useState(patch.decl === null);
  const [reason, setReason] = useState(patch.reason ?? '');
  return <>
    <p className="sf-note" data-testid="draft-route-node">改的是这条路线上的这一节。</p>
    <label><span>课名</span>
      <input data-testid="draft-route-title" value={fields.title} onChange={event => { fields.setTitle(event.target.value); }} /></label>
    <label><span>安排在哪天</span>
      <input type="date" data-testid="draft-route-date" value={fields.date} disabled={clearDate} onChange={event => { fields.setDate(event.target.value); }} /></label>
    <label className="sf-org-check">
      <input type="checkbox" data-testid="draft-route-date-clear" checked={clearDate} onChange={event => { setClearDate(event.target.checked); }} />不安排具体日期</label>
    <MixedMaterials list={fields.list} initialIndex={fields.initialIndex} materials={materials} cards={cards} onChange={fields.setList} onInitial={fields.setInitialIndex} />
    <DeclFields decl={fields.decl} onChange={fields.setDecl} />
    <label className="sf-org-check">
      <input type="checkbox" data-testid="draft-route-decl-clear" checked={clearDecl} onChange={event => { setClearDecl(event.target.checked); }} />不再单独声明（跟着上一节）</label>
    <ReasonField value={reason} onChange={setReason} />
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      onEdit({
        ...patch, title: fields.title.trim(), materials: materialContext(fields.list, fields.initialIndex),
        date: clearDate ? null : fields.date === '' ? (patch.date ?? null) : fields.date,
        decl: clearDecl ? null : fields.decl,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      });
    }} onCancel={onCancel} />
  </>;
}

function DeclFields({ decl, onChange }: { readonly decl: RouteDecl; onChange(next: RouteDecl): void }): React.JSX.Element {
  return <>
    <label><span>教学方式（留空＝跟着上一节）</span>
      <input data-testid="draft-route-teaching" value={decl.teachingRef ?? ''} onChange={event => { onChange({ ...decl, ...(event.target.value === '' ? { teachingRef: undefined } : { teachingRef: event.target.value }) }); }} /></label>
    <label><span>这一节抓什么</span>
      <textarea data-testid="draft-route-stance" rows={2} value={decl.stance ?? ''} onChange={event => { onChange({ ...decl, ...(event.target.value === '' ? { stance: undefined } : { stance: event.target.value }) }); }} /></label>
    <label><span>这一节的名字（可留空）</span>
      <input data-testid="draft-route-decl-name" value={decl.name ?? ''} onChange={event => { onChange({ ...decl, ...(event.target.value === '' ? { name: undefined } : { name: event.target.value }) }); }} /></label>
  </>;
}

// ---- one lesson's own settings -------------------------------------------

/**
 * P6.4 the lesson a proposal is about: how it teaches, what was asked of it this
 * time, and which material it opens with. A field the student did not really
 * change stays out of the patch, so the lesson keeps what it already had — the
 * teacher's draft never silently empties a list it did not propose to change, and
 * a draft that proposed no materials at all leaves the stored ones alone until
 * the student actually adds or drops something.
 */
/**
 * One lesson-settings draft.
 *
 * The draft starts from the proposal's own patch, because a teacher may have
 * proposed more than teaching prose — the material list and the learning set
 * are part of the same edit, and rewriting the patch from the form's fields
 * would silently drop them. Only the fields the student really moved are
 * written: 教学方式 empty means "do not change this field", while 要求/重点 are
 * prose the proposal itself sets, so clearing one sends `''` (a real value in
 * the schema) instead of looking like "not mentioned".
 */
function LessonEditForm({ patch, materials, cards, teachingChoices, pending, onCommit, onCancel }: {
  readonly patch: LessonPatch;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly teachingChoices?: readonly TeachingChoice[] | undefined;
  readonly pending?: boolean | undefined;
  onCommit(next: LessonPatch): void;
  onCancel(): void;
}): React.JSX.Element {
  const [teachingRef, setTeachingRef] = useState(patch.teachingRef ?? '');
  const [instructions, setInstructions] = useState(patch.temporaryInstructions ?? '');
  const [stance, setStance] = useState(patch.stance ?? '');
  const proposed = patch.lessonMaterials;
  const [list, setList] = useState<readonly RouteMaterial[]>(proposed?.materials ?? []);
  const [initialIndex, setInitialIndex] = useState<number | undefined>(proposed?.initialIndex);
  return <>
    <label><span>这一节怎么教</span>
      <select data-testid="draft-lesson-teaching" value={teachingRef} onChange={event => { setTeachingRef(event.target.value); }}>
        <option value="">不改这一项</option>
        {teachingChoices?.map(choice => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
      </select></label>
    <label><span>这一节特别的要求（清空＝去掉原来这条）</span>
      <textarea rows={2} data-testid="draft-lesson-instructions" value={instructions} onChange={event => { setInstructions(event.target.value); }} /></label>
    <label><span>这一节的重点（清空＝去掉原来这条）</span>
      <textarea rows={2} data-testid="draft-lesson-stance" value={stance} onChange={event => { setStance(event.target.value); }} /></label>
    <MixedMaterials list={list} initialIndex={initialIndex} materials={materials} cards={cards} onChange={setList} onInitial={setInitialIndex} />
    <p className="sf-note" data-testid="draft-lesson-keep">没动过的字段照原提案保存：资料、学习集和这一节原来的设置都还在。</p>
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      // Keep everything the proposal already said, including the fields this
      // form never shows (`learningSetRef`, `archived`, …).
      const next: LessonPatch = { ...patch };
      if (teachingRef !== '') next.teachingRef = teachingRef;
      else delete next.teachingRef;
      if (instructions !== (patch.temporaryInstructions ?? '')) next.temporaryInstructions = instructions;
      if (stance !== (patch.stance ?? '')) next.stance = stance;
      if (materialsChanged(proposed, list, initialIndex)) next.lessonMaterials = materialContext(list, initialIndex);
      onCommit(next);
    }} onCancel={onCancel} />
  </>;
}

/** Did the student really touch the material list, against what the draft had? */
function materialsChanged(proposed: LessonPatch['lessonMaterials'], list: readonly RouteMaterial[], initialIndex: number | undefined): boolean {
  if (proposed === undefined) return list.length > 0 || initialIndex !== undefined;
  if (proposed.initialIndex !== initialIndex) return true;
  if (proposed.materials.length !== list.length) return true;
  return proposed.materials.some((item, at) => JSON.stringify(item) !== JSON.stringify(list[at]));
}

// ---- plans ---------------------------------------------------------------

function PlanCreateForm({ content, materials, cards, pending, onCommit, onCancel }: {
  readonly content: PlanContent;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly pending?: boolean | undefined;
  onCommit(next: PlanContent): void;
  onCancel(): void;
}): React.JSX.Element {
  const [title, setTitle] = useState(content.title);
  const [tags, setTags] = useState(content.kind === 'campaign' ? content.tags.join('、') : '');
  const [dailyCount, setDailyCount] = useState(content.kind === 'campaign' ? String(content.dailyCount) : '10');
  const [start, setStart] = useState(content.kind === 'campaign' ? content.start : '');
  const [end, setEnd] = useState(content.kind === 'campaign' ? content.end : '');
  const [planCards, setPlanCards] = useState<readonly string[]>(content.kind === 'campaign' ? content.cards : []);
  const [entries, setEntries] = useState(content.kind === 'book' ? content.entries : []);
  const [schedule, setSchedule] = useState(content.kind === 'campaign' ? content.schedule : []);
  return <>
    <label><span>{content.kind === 'book' ? '这份安排叫什么' : '这份复习计划叫什么'}</span>
      <input data-testid="draft-plan-title" value={title} onChange={event => { setTitle(event.target.value); }} /></label>
    {content.kind === 'campaign' ? <>
      <label><span>标签（顿号隔开）</span>
        <input data-testid="draft-plan-tags" value={tags} onChange={event => { setTags(event.target.value); }} /></label>
      <label><span>每天几张（自由取到期卡用）</span>
        <input type="number" min={1} data-testid="draft-plan-daily" value={dailyCount} onChange={event => { setDailyCount(event.target.value); }} /></label>
      <label><span>从哪天</span>
        <input type="date" data-testid="draft-plan-start" value={start} onChange={event => { setStart(event.target.value); }} /></label>
      <label><span>到哪天</span>
        <input type="date" data-testid="draft-plan-end" value={end} onChange={event => { setEnd(event.target.value); }} /></label>
      <IdList label="点名的卡" testId="draft-plan-cards" values={planCards} options={(cards ?? []).map(item => ({ id: item.ref, label: item.content.title }))} onChange={setPlanCards} />
      <ScheduleList schedule={schedule} onChange={next => { setSchedule([...next]); }} />
    </> : <>
      <p className="sf-note" data-testid="draft-plan-book">{bookName(materials, content.materialId)}的排课行；每一行都带着当时读到的锚点。</p>
      <BookEntries entries={entries} onChange={next => { setEntries([...next]); }} />
      <p className="sf-note">这里只改日子和章节；要新增一行得先有真实锚点，所以不在这里凭空加。</p>
    </>}
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      if (content.kind === 'campaign') {
        onCommit({
          kind: 'campaign', title: title.trim(), learningSetRef: content.learningSetRef, tags: splitList(tags),
          cards: [...planCards], dailyCount: Number(dailyCount), start, end, schedule: [...schedule],
        });
        return;
      }
      onCommit({ kind: 'book', title: title.trim(), materialId: content.materialId, entries: [...entries] });
    }} onCancel={onCancel} />
  </>;
}

function PlanEditForm({ patch, cards, pending, onCommit, onCancel }: {
  readonly patch: PlanPatch;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  readonly pending?: boolean | undefined;
  onCommit(next: PlanPatch): void;
  onCancel(): void;
}): React.JSX.Element {
  const [title, setTitle] = useState(patch.title ?? '');
  const [tags, setTags] = useState(patch.tags === undefined ? '' : patch.tags.join('、'));
  const [dailyCount, setDailyCount] = useState(patch.dailyCount === undefined ? '' : String(patch.dailyCount));
  const [start, setStart] = useState(patch.start ?? '');
  const [end, setEnd] = useState(patch.end ?? '');
  const [planCards, setPlanCards] = useState<readonly string[] | undefined>(patch.cards);
  const [entries, setEntries] = useState(patch.entries);
  const [schedule, setSchedule] = useState(patch.schedule);
  return <>
    {patch.title !== undefined && <label><span>名字</span>
      <input data-testid="draft-plan-title" value={title} onChange={event => { setTitle(event.target.value); }} /></label>}
    {patch.tags !== undefined && <label><span>标签</span>
      <input data-testid="draft-plan-tags" value={tags} onChange={event => { setTags(event.target.value); }} /></label>}
    {patch.dailyCount !== undefined && <label><span>每天几张</span>
      <input type="number" min={1} data-testid="draft-plan-daily" value={dailyCount} onChange={event => { setDailyCount(event.target.value); }} /></label>}
    {patch.start !== undefined && <label><span>从哪天</span>
      <input type="date" data-testid="draft-plan-start" value={start} onChange={event => { setStart(event.target.value); }} /></label>}
    {patch.end !== undefined && <label><span>到哪天</span>
      <input type="date" data-testid="draft-plan-end" value={end} onChange={event => { setEnd(event.target.value); }} /></label>}
    {planCards !== undefined && <IdList label="点名的卡（整份清单）" testId="draft-plan-cards" values={planCards} options={(cards ?? []).map(item => ({ id: item.ref, label: item.content.title }))} onChange={setPlanCards} />}
    {entries !== undefined && <BookEntries entries={entries} onChange={next => { setEntries([...next]); }} />}
    {schedule !== undefined && <ScheduleList schedule={schedule} onChange={next => { setSchedule([...next]); }} />}
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      const next: PlanPatch = { ...patch };
      if (patch.title !== undefined) next.title = title.trim();
      if (patch.tags !== undefined) next.tags = splitList(tags);
      if (patch.dailyCount !== undefined) next.dailyCount = Number(dailyCount);
      if (patch.start !== undefined) next.start = start;
      if (patch.end !== undefined) next.end = end;
      if (planCards !== undefined) next.cards = [...planCards];
      if (entries !== undefined) next.entries = [...entries];
      if (schedule !== undefined) next.schedule = [...schedule];
      onCommit(next);
    }} onCancel={onCancel} />
  </>;
}

/** Book plan lines: the anchors are the teacher's real ones, so only date and chapter move. */
function BookEntries({ entries, onChange }: {
  readonly entries: readonly BookPlanEntry[];
  onChange(next: readonly BookPlanEntry[]): void;
}): React.JSX.Element {
  return <fieldset className="sf-draft-list" data-testid="draft-plan-entries">
    <legend>书上的排课行</legend>
    {entries.length === 0 && <p className="sf-note">还没有行。</p>}
    <ul>{entries.map((entry, index) => <li key={index} data-testid="draft-plan-entry">
      <input type="date" data-testid="draft-plan-entry-date" value={entry.date}
        onChange={event => { onChange(entries.map((item, at) => at === index ? { ...item, date: event.target.value } : item)); }} />
      <input data-testid="draft-plan-entry-chapter" placeholder="章节路径（可留空）" value={entry.chapter ?? ''}
        onChange={event => {
          const text = event.target.value;
          onChange(entries.map((item, at) => at === index ? { ...item, ...(text.trim() === '' ? { chapter: undefined } : { chapter: text.trim() }) } : item));
        }} />
      <span className="sf-meta" data-testid="draft-plan-entry-sources">{String(entry.sources.length)} 处锚点（不可改）</span>
      <button type="button" className="sf-quiet" data-testid="draft-plan-entry-remove" onClick={() => { onChange(entries.filter((_, at) => at !== index)); }}>去掉</button>
    </li>)}</ul>
  </fieldset>;
}

/** Explicit per-day card lists: shown as the teacher wrote them, droppable but never invented. */
function ScheduleList({ schedule, onChange }: {
  readonly schedule: readonly CampaignDay[];
  onChange(next: readonly CampaignDay[]): void;
}): React.JSX.Element {
  return <fieldset className="sf-draft-list" data-testid="draft-plan-schedule">
    <legend>已经点好日子的那几天</legend>
    {schedule.length === 0 && <p className="sf-note">没有点名具体日子，按每天张数自由取。</p>}
    <ul>{schedule.map((day, index) => <li key={`${day.date}:${String(index)}`} data-testid="draft-plan-schedule-day">
      <span>{day.date}</span><span className="sf-meta">{String(day.cards.length)} 张</span>
      <button type="button" className="sf-quiet" data-testid="draft-plan-schedule-remove" onClick={() => { onChange(schedule.filter((_, at) => at !== index)); }}>去掉这天</button>
    </li>)}</ul>
  </fieldset>;
}

// ---- skeleton ------------------------------------------------------------

/**
 * The book's own structure: the student may move a section's path or drop one,
 * but every node keeps the anchors it was really read from — a tree node without
 * a source is a guess, so this editor never lets one be created here.
 */
function SkeletonForm({ materialId, materials, change, pending, onCommit, onCancel }: {
  readonly materialId: string;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly change: SkeletonChange;
  readonly pending?: boolean | undefined;
  onCommit(next: SkeletonChange): void;
  onCancel(): void;
}): React.JSX.Element {
  const [nodes, setNodes] = useState(change.nodes);
  const [replaceExisting, setReplaceExisting] = useState(change.replaceExisting);
  const [removePaths, setRemovePaths] = useState<readonly SkeletonPath[]>(change.removePaths);
  const [repath, setRepath] = useState(change.repath);
  const [detachDependents, setDetachDependents] = useState(change.detachDependents);
  const [typedPath, setTypedPath] = useState('');
  const [fromPath, setFromPath] = useState('');
  const [toPath, setToPath] = useState('');
  return <>
    <p className="sf-note" data-testid="draft-skeleton-book">{bookName(materials, materialId)}的目录</p>
    <label className="sf-org-check">
      <input type="checkbox" data-testid="draft-skeleton-replace" checked={replaceExisting} onChange={event => { setReplaceExisting(event.target.checked); }} />按这份目录整本替换</label>
    <fieldset className="sf-draft-list" data-testid="draft-skeleton-nodes">
      <legend>目录路径</legend>
      {nodes.length === 0 && <p className="sf-note">这份改动没有新增章节。</p>}
      <ul>{nodes.map((node, index) => <li key={node.path} data-testid="draft-skeleton-node">
        <input data-testid="draft-skeleton-path" value={node.path}
          onChange={event => { const text = event.target.value; if (text.trim() === '') return; setNodes(nodes.map((item, at) => at === index ? { ...item, path: text.trim() } : item)); }} />
        <span className="sf-meta" data-testid="draft-skeleton-sources">{String(node.sources.length)} 处锚点（不可改）</span>
        <button type="button" className="sf-quiet" data-testid="draft-skeleton-node-remove" onClick={() => { setNodes(nodes.filter((_, at) => at !== index)); }}>去掉</button>
      </li>)}</ul>
    </fieldset>
    <fieldset className="sf-draft-list" data-testid="draft-skeleton-remove">
      <legend>删掉的章节</legend>
      <ul>{removePaths.map(path => <li key={path} data-testid="draft-skeleton-remove-row">
        <span>{path}</span>
        <button type="button" className="sf-quiet" data-testid="draft-skeleton-remove-undo" onClick={() => { setRemovePaths(removePaths.filter(item => item !== path)); }}>不删了</button>
      </li>)}</ul>
      <div className="sf-draft-typed">
        <input data-testid="draft-skeleton-remove-typed" placeholder="要删的语义路径" value={typedPath} onChange={event => { setTypedPath(event.target.value); }} />
        <button type="button" className="sf-quiet" data-testid="draft-skeleton-remove-add" disabled={typedPath.trim() === ''}
          onClick={() => { const value = typedPath.trim(); if (value !== '' && !removePaths.includes(value)) setRemovePaths([...removePaths, value]); setTypedPath(''); }}>加上</button>
      </div>
    </fieldset>
    <fieldset className="sf-draft-list" data-testid="draft-skeleton-repath">
      <legend>改路径</legend>
      <ul>{repath.map((pair, index) => <li key={`${pair.from}:${String(index)}`} data-testid="draft-skeleton-repath-row">
        <span>{pair.from} →</span>
        <input data-testid="draft-skeleton-repath-to" value={pair.to}
          onChange={event => { const text = event.target.value; setRepath(repath.map((item, at) => at === index ? { ...item, to: text } : item)); }} />
        <button type="button" className="sf-quiet" data-testid="draft-skeleton-repath-remove" onClick={() => { setRepath(repath.filter((_, at) => at !== index)); }}>去掉</button>
      </li>)}</ul>
      <div className="sf-draft-typed">
        <input data-testid="draft-skeleton-repath-from" placeholder="旧路径" value={fromPath} onChange={event => { setFromPath(event.target.value); }} />
        <input data-testid="draft-skeleton-repath-new" placeholder="新路径" value={toPath} onChange={event => { setToPath(event.target.value); }} />
        <button type="button" className="sf-quiet" data-testid="draft-skeleton-repath-add" disabled={fromPath.trim() === '' || toPath.trim() === ''}
          onClick={() => { setRepath([...repath, { from: fromPath.trim(), to: toPath.trim() }]); setFromPath(''); setToPath(''); }}>加上</button>
      </div>
    </fieldset>
    <label className="sf-org-check">
      <input type="checkbox" data-testid="draft-skeleton-detach" checked={detachDependents} onChange={event => { setDetachDependents(event.target.checked); }} />相关卡与安排先摘下来（不连带删除）</label>
    <Buttons pending={pending} testId="draft-save" onSave={() => {
      onCommit({ nodes: [...nodes], replaceExisting, removePaths: [...removePaths], repath: [...repath], detachDependents });
    }} onCancel={onCancel} />
  </>;
}

// ---- shared fields -------------------------------------------------------

/**
 * The name a book is shown by. The owner hands over the real catalog; without
 * it there is no name to show, and the stored id is an internal reference the
 * student never reads — so the copy says "this book" instead of printing it.
 */
function bookName(materials: readonly OrganizationMaterialOption[] | undefined, materialId: string): string {
  return (materials ?? []).find(item => item.materialId === materialId)?.title ?? '这本书';
}

/**
 * A list of real identities. Only a catalog may add one: without it the student
 * would have to copy an internal reference out of somewhere, which is exactly
 * the thing this screen must never ask for, so the control says it is not
 * available instead of offering a text field. Identities the draft already
 * carries stay visible and removable.
 */
function IdList({ label, testId, values, options, onChange }: {
  readonly label: string;
  readonly testId: string;
  readonly values: readonly string[];
  readonly options: readonly { readonly id: string; readonly label: string }[];
  onChange(next: readonly string[]): void;
}): React.JSX.Element {
  const known = new Map(options.map(option => [option.id, option.label] as const));
  return <fieldset className="sf-draft-list" data-testid={testId}>
    <legend>{label}</legend>
    {values.length === 0 && <p className="sf-note">还没有。</p>}
    <ul>{values.map(id => <li key={id} data-testid={`${testId}-row`}>
      <span>{known.get(id) ?? '暂时看不出是哪一项'}</span>
      <button type="button" className="sf-quiet" data-testid={`${testId}-remove`} onClick={() => { onChange(values.filter(item => item !== id)); }}>去掉</button>
    </li>)}</ul>
    {options.length > 0
      ? <select data-testid={`${testId}-pick`} defaultValue="" onChange={event => {
          const value = event.target.value;
          if (value !== '' && !values.includes(value)) onChange([...values, value]);
          event.target.value = '';
        }}>
          <option value="">选一个…</option>
          {options.filter(option => !values.includes(option.id)).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      : <p className="sf-note" data-testid={`${testId}-unavailable`}>暂时读不到可选项，先不能在这里加。</p>}
  </fieldset>;
}

/**
 * A node's ordered teaching references: mixed kinds, in the order the lesson
 * would really open them. A card keeps the version the proposal pinned.
 */
export function MixedMaterials({ list, initialIndex, materials, cards, onChange, onInitial }: {
  readonly list: readonly RouteMaterial[];
  readonly initialIndex: number | undefined;
  readonly materials?: readonly OrganizationMaterialOption[] | undefined;
  readonly cards?: readonly OrganizationCardOption[] | undefined;
  onChange(next: readonly RouteMaterial[]): void;
  onInitial(next: number | undefined): void;
}): React.JSX.Element {
  const [pick, setPick] = useState('');
  const [cardPick, setCardPick] = useState('');
  const sources = (materials ?? []).flatMap(item => item.versions.map(version => ({ id: `${item.materialId}|${version.versionId}`, label: `${item.title} · ${version.fileName}` })));
  const removeAt = (index: number): void => {
    onChange(list.filter((_, at) => at !== index));
    onInitial(initialIndex === undefined ? undefined : initialIndex === index ? undefined : initialIndex > index ? initialIndex - 1 : initialIndex);
  };
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    if (moved === undefined) return;
    next.splice(to, 0, moved);
    onChange(next);
    onInitial(initialIndex === from ? to : initialIndex === to ? from : initialIndex);
  };
  return <fieldset className="sf-draft-list" data-testid="draft-route-materials">
    <legend>这一节用什么（按顺序）</legend>
    {list.length === 0 && <p className="sf-note">一样都不用也合法，这是一节先聊方向。</p>}
    <ul>{list.map((material, index) => <li key={`${material.kind}:${String(index)}`} data-testid="draft-route-material">
      <label className="sf-org-check">
        <input type="radio" name="draft-route-initial" data-testid="draft-route-material-initial" checked={initialIndex === index || (initialIndex === undefined && index === 0)}
          onChange={() => { onInitial(index); }} />先打开</label>
      <span>{materialName(material, materials, cards)}</span>
      {material.kind === 'card' && material.cardVersion !== undefined && <span className="sf-meta">第 {material.cardVersion} 版</span>}
      <button type="button" className="sf-quiet" disabled={index === 0} data-testid="draft-route-material-up" onClick={() => { move(index, index - 1); }}>上移</button>
      <button type="button" className="sf-quiet" disabled={index === list.length - 1} data-testid="draft-route-material-down" onClick={() => { move(index, index + 1); }}>下移</button>
      <button type="button" className="sf-quiet" data-testid="draft-route-material-remove" onClick={() => { removeAt(index); }}>去掉</button>
    </li>)}</ul>
    {sources.length > 0 && <div className="sf-draft-typed">
      <select data-testid="draft-route-source" value={pick} onChange={event => { setPick(event.target.value); }}>
        <option value="">加一份资料…</option>
        {sources.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <button type="button" className="sf-quiet" data-testid="draft-route-source-add" disabled={pick === ''}
        onClick={() => {
          const [materialId, versionId] = pick.split('|');
          if (materialId === undefined || versionId === undefined) return;
          onChange([...list, { kind: 'source', source: { materialId, versionId } }]);
          setPick('');
        }}>加上</button>
    </div>}
    {(cards ?? []).length > 0 && <div className="sf-draft-typed">
      <select data-testid="draft-route-card" value={cardPick} onChange={event => { setCardPick(event.target.value); }}>
        <option value="">加一张卡…</option>
        {(cards ?? []).map(card => <option key={card.ref} value={`${card.ref}|${String(card.version)}`}>{card.content.title}</option>)}
      </select>
      <button type="button" className="sf-quiet" data-testid="draft-route-card-add" disabled={cardPick === ''}
        onClick={() => {
          const [cardRef, version] = cardPick.split('|');
          if (cardRef === undefined) return;
          onChange([...list, { kind: 'card', cardRef, ...(version === undefined ? {} : { cardVersion: Number(version) }) }]);
          setCardPick('');
        }}>加上</button>
    </div>}
    {sources.length === 0 && (cards ?? []).length === 0
      && <p className="sf-note" data-testid="draft-route-materials-unavailable">暂时读不到可以选的书或卡，只能调整已经选好的。</p>}
  </fieldset>;
}

/**
 * What one chosen material is called on screen. The catalog names it; without
 * one the row still says a real thing ("一份资料" / "一张卡") and never falls
 * back to printing the stored id.
 */
function materialName(material: RouteMaterial, materials: readonly OrganizationMaterialOption[] | undefined, cards: readonly OrganizationCardOption[] | undefined): string {
  switch (material.kind) {
    case 'card': return (cards ?? []).find(card => card.ref === material.cardRef)?.content.title ?? '一张卡';
    case 'source': {
      const item = (materials ?? []).find(entry => entry.materialId === material.source.materialId);
      if (item === undefined) return '一份资料';
      const version = item.versions.find(entry => entry.versionId === material.source.versionId);
      return version === undefined ? item.title : item.title + ' · ' + version.fileName;
    }
  }
}

function ReasonField({ value, onChange }: { readonly value: string; onChange(next: string): void }): React.JSX.Element {
  return <label><span>说明（可留空）</span>
    <input data-testid="draft-reason" value={value} onChange={event => { onChange(event.target.value); }} /></label>;
}

function Buttons({ pending, testId, onSave, onCancel }: {
  readonly pending?: boolean | undefined;
  readonly testId: string;
  onSave(): void;
  onCancel(): void;
}): React.JSX.Element {
  return <div className="sf-org-actions" data-testid="organization-draft-actions">
    <button type="button" className="sf-action" data-testid={testId} disabled={pending === true} onClick={onSave}>保存这一版</button>
    <button type="button" className="sf-quiet" data-testid="draft-cancel" onClick={onCancel}>先不改</button>
  </div>;
}

/** 顿号 / 逗号 / 空白分隔的自由文本列表。 */
function splitList(text: string): string[] {
  return text.split(/[、,，\s]+/u).filter(item => item !== '');
}

/** A policy ladder, or `null` for "no policy of my own" when nothing usable was typed. */
function parseLadder(text: string): number[] | null {
  const numbers = splitList(text).map(Number).filter(value => Number.isFinite(value)).map(value => Math.trunc(value));
  return numbers.length === 0 ? null : numbers;
}

/** `initialIndex` only survives while it still points at a real item. */
function materialContext(list: readonly RouteMaterial[], initialIndex: number | undefined): { readonly materials: RouteMaterial[]; readonly initialIndex?: number } {
  return initialIndex !== undefined && initialIndex < list.length
    ? { materials: [...list], initialIndex }
    : { materials: [...list] };
}
