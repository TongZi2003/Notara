/**
 * P6.2 one planned node's editor.
 *
 * The form edits exactly what the contracts let a student own: the title, the
 * ordered teaching references (mixed kinds, none at all, and the one that opens
 * first), the civil day, the parent edge on creation, and the short declaration
 * the lesson inherits. It never names a session, an opening key or a revision —
 * those belong to the Host — and it never writes a second kind of schedule.
 *
 * A local write is one operation id kept in a ref while the same draft is
 * retried, so a lost acknowledgement re-sends the same effect instead of
 * planning a second node. A refusal re-reads the route and keeps the draft.
 */
import type { CardView } from '@studyforge/contracts/cards';
import type { LessonMaterial } from '@studyforge/contracts/lesson-materials';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { RouteDecl, RouteNode, RouteNodeInputDraft, RouteNodePatchDraft, RouteView } from '@studyforge/contracts/routes';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { useRef, useState } from 'react';
import { effectiveDecl, materialLabel, mountCandidates } from './format.ts';

export interface RouteEditorProps {
  /** The whole route, so a new node can name a real parent and a cycle is never offered. */
  readonly route: RouteView;
  /** The node being edited, or `null` while planning a new one. */
  readonly node: RouteNode | null;
  readonly materials: readonly MaterialView[];
  readonly cards: readonly CardView[];
  readonly choices: readonly TeachingChoice[];
  readonly pending: boolean;
  readonly notice: string;
  /** One new node, with its parent edge, in one write. */
  onCreate(draft: RouteNodeInputDraft): void;
  /** One content edit of an existing node; the edge has its own entry point. */
  onEdit(patch: RouteNodePatchDraft): void;
  onCancel(): void;
}

/** One ordered teaching reference while the student is still arranging it. */
interface MaterialDraft {
  readonly key: string;
  readonly material: LessonMaterial;
}

export function RouteEditor({ route, node, materials, cards, choices, pending, notice, onCreate, onEdit, onCancel }: RouteEditorProps): React.JSX.Element {
  const inherited = node === null ? {} : effectiveDecl(route.nodes, node);
  const [title, setTitle] = useState(node?.title ?? '');
  const [parent, setParent] = useState<string>(node?.parent ?? '');
  const [date, setDate] = useState(node?.date ?? '');
  const [materialsDraft, setDraft] = useState<MaterialDraft[]>(() => (node?.materials.materials ?? []).map((material, index) => ({ key: `kept-${index}`, material })));
  const [initialIndex, setInitialIndex] = useState<number | undefined>(node?.materials.initialIndex);
  // The student's own declared fields, never the inherited ones: opening this
  // editor and saving must not pin a value the node only borrowed.
  const [teachingRef, setTeachingRef] = useState(node?.decl?.teachingRef ?? '');
  const [stance, setStance] = useState(node?.decl?.stance ?? '');
  const [declName, setDeclName] = useState(node?.decl?.name ?? '');
  const [source, setSource] = useState('');
  const [card, setCard] = useState('');
  const counter = useRef(0);

  const move = (from: number, to: number): void => {
    setDraft(current => {
      if (to < 0 || to >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (moved === undefined) return current;
      next.splice(to, 0, moved);
      return next;
    });
    setInitialIndex(current => (current === from ? to : current === to ? from : current));
  };

  const add = (material: LessonMaterial): void => {
    counter.current += 1;
    setDraft(current => [...current, { key: `new-${counter.current}`, material }]);
  };

  const remove = (key: string): void => {
    setDraft(current => current.filter(item => item.key !== key));
    setInitialIndex(undefined);
  };

  function submit(): void {
    const list = materialsDraft.map(item => item.material);
    const decl: RouteDecl = {
      ...(declName.trim() === '' ? {} : { name: declName.trim() }),
      ...(teachingRef === '' ? {} : { teachingRef }),
      ...(stance.trim() === '' ? {} : { stance: stance.trim() }),
    };
    const built = {
      ...(list.length === 0 ? {} : { initialIndex: initialIndex === undefined || initialIndex >= list.length ? 0 : initialIndex }),
      materials: list,
    };
    if (node === null) {
      onCreate({
        title: title.trim(),
        parent: parent === '' ? null : parent,
        materials: built,
        date: date === '' ? null : date,
        decl,
      } satisfies RouteNodeInputDraft);
      return;
    }
    onEdit({
      title: title.trim(),
      materials: built,
      date: date === '' ? null : date,
      decl: Object.keys(decl).length === 0 ? null : decl,
    } satisfies RouteNodePatchDraft);
  }

  const mountable = node === null ? route.nodes : mountCandidates(route.nodes, node.id);
  const sourceOptions: { id: string; label: string }[] = materials.flatMap(material =>
    material.versions.map(version => ({ id: `${material.materialId}|${version.versionId}`, label: `${material.title} · ${version.fileName}` })));

  return <form className="sf-route-editor" data-testid="route-editor" onSubmit={event => { event.preventDefault(); submit(); }}>
    <h3 data-testid="route-editor-heading">{node === null ? '新排一节课' : '改这一节'}</h3>
    <label>课名
      <input data-testid="route-editor-title" value={title} onChange={event => { setTitle(event.target.value); }} placeholder="例如：二次函数顶点式" />
    </label>
    <label>{node === null ? '接在哪一节后面' : '上一节（不改就留空）'}
      <select data-testid="route-editor-parent" value={parent} onChange={event => { setParent(event.target.value); }}>
        <option value="">（新的一支）</option>
        {mountable.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
      </select>
    </label>
    <label>安排在哪天
      <input type="date" data-testid="route-editor-date" value={date} onChange={event => { setDate(event.target.value); }} />
    </label>
    <fieldset>
      <legend>这一节用什么</legend>
      <p className="sf-note">可以一样都不用；用了就按下面的顺序摆在课堂上，点开头那颗点亮的就是先打开的那一份。</p>
      <ol className="sf-route-materials sf-linear-tree" data-testid="route-editor-materials">
        {materialsDraft.map((item, index) => <li key={item.key} data-testid="route-editor-material">
          <label className="sf-route-material-first">
            <input type="radio" name="route-editor-initial" checked={initialIndex === index || (initialIndex === undefined && index === 0)}
              onChange={() => { setInitialIndex(index); }} />先打开
          </label>
          <span className="sf-route-material-label" data-testid="route-editor-material-label">{materialLabel(item.material, materials, cards)}</span>
          <span className="sf-route-material-actions">
            <button type="button" className="sf-quiet" disabled={index === 0} onClick={() => { move(index, index - 1); }}>上移</button>
            <button type="button" className="sf-quiet" disabled={index === materialsDraft.length - 1} onClick={() => { move(index, index + 1); }}>下移</button>
            <button type="button" className="sf-quiet" onClick={() => { remove(item.key); }}>去掉</button>
          </span>
        </li>)}
      </ol>
      <div className="sf-route-add">
        <select data-testid="route-editor-source" value={source} onChange={event => { setSource(event.target.value); }}>
          <option value="">选一份资料…</option>
          {sourceOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
        <button type="button" className="sf-quiet" data-testid="route-editor-add-source" disabled={source === ''}
          onClick={() => {
            const [materialId, versionId] = source.split('|');
            if (materialId === undefined || versionId === undefined) return;
            add({ kind: 'source', source: { materialId, versionId } });
            setSource('');
          }}>加资料</button>
      </div>
      <div className="sf-route-add">
        <select data-testid="route-editor-card" value={card} onChange={event => { setCard(event.target.value); }}>
          <option value="">选一张卡…</option>
          {cards.map(item => <option key={item.ref} value={`${item.ref}|${String(item.version)}`}>{item.content.title}</option>)}
        </select>
        <button type="button" className="sf-quiet" data-testid="route-editor-add-card" disabled={card === ''}
          onClick={() => {
            const [cardRef, version] = card.split('|');
            if (cardRef === undefined) return;
            add({ kind: 'card', cardRef, ...(version === undefined ? {} : { cardVersion: Number(version) }) });
            setCard('');
          }}>加卡片</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>这节课怎么上</legend>
      {node !== null && (inherited.teachingRef !== undefined || inherited.stance !== undefined) && <p className="sf-note" data-testid="route-editor-inherited">
        不填就跟上一节一样：{[inherited.teachingRef === undefined ? '' : choices.find(choice => choice.id === inherited.teachingRef)?.title ?? '已有设置', inherited.stance ?? ''].filter(part => part !== '').join(' · ')}
      </p>}
      <label>教学方式
        <select data-testid="route-editor-teaching" value={teachingRef} onChange={event => { setTeachingRef(event.target.value); }}>
          <option value="">（跟着上一节）</option>
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
        </select>
      </label>
      <label>这一节抓什么
        <textarea data-testid="route-editor-stance" rows={3} value={stance} onChange={event => { setStance(event.target.value); }}
          placeholder="例如：先看清顶点和对称轴，再决定怎么配方。" />
      </label>
      <label>给这一节起个名（可留空）
        <input data-testid="route-editor-decl-name" value={declName} onChange={event => { setDeclName(event.target.value); }} />
      </label>
    </fieldset>
    <div className="sf-route-editor-actions">
      <button type="submit" className="sf-action" data-testid="route-editor-save" disabled={pending || title.trim() === ''}>{node === null ? '排上' : '保存这一节'}</button>
      <button type="button" className="sf-action sf-action-quiet" data-testid="route-editor-cancel" onClick={onCancel}>先不改</button>
    </div>
    {notice !== '' && <p className="sf-notice" role="status" data-testid="route-editor-notice">{notice}</p>}
  </form>;
}
