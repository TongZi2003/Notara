/**
 * P5 shared vocabulary for the card surfaces.
 *
 * Presentation labels only describe how a card is displayed; they never say
 * anything about mastery, and a freshly created card has no review row at all.
 * Refusal codes arrive inside the Remote failure message (the same carrier the
 * materials page reads), so every branch here names a code the Host really
 * throws. A carrier failure is different in kind: it carries `gateway/*`, which
 * means no business answer came back at all.
 */
import type { CardContent, CardPatch, CardView } from '@studyforge/contracts/cards';
import type { Actor } from '@studyforge/contracts/core';

/** Display kinds in the product's own order. */
export const PRESENTATIONS = ['problem', 'flashcard', 'insight', 'note'] as const;

export const PRESENTATION_LABELS: Record<CardContent['presentation'], string> = {
  problem: '题卡',
  flashcard: '记忆卡',
  insight: '洞察',
  note: '笔记',
};

/** The refusal code the Host put on the wire; the code is what the UI branches on. */
export function codeOf(message: string): string {
  const match = /\b(?:card_[a-z_]+|knowledge_[a-z_]+|version_conflict|operation_conflict|record_corrupt|workspace_mismatch|learning_session_required)\b/u.exec(message);
  return match?.[0] ?? message.trim();
}

/** The failure's own code when the carrier put one on the wire; the message otherwise. */
export function failureCode(error: { readonly code?: unknown; readonly message: string }): string {
  const refusal = /\b(?:card_[a-z_]+|knowledge_[a-z_]+|memory_[a-z_]+|review_[a-z_]+|version_conflict|operation_conflict|record_missing|workspace_mismatch|learning_session_required|same_occurrence_requires_correction)\b/u.exec(error.message);
  if (refusal) return refusal[0];
  return typeof error.code === 'string' && error.code !== '' ? error.code : codeOf(error.message);
}

/**
 * The call never produced a business answer, so the service may already have
 * stored the write. `gateway/internal` is what the Connection carrier folds a
 * failed transport into (`dsh-client-connection` `transportError`), so it is a
 * lost answer rather than a refusal; `gateway/cancelled` is the carrier aborting
 * an invocation that may have run, and `gateway/result-invalid` is an answer
 * that could not be used. Every other code — business refusals and the gateway's
 * own pre-write validation — is a definite "nothing was stored".
 */
export function answerLost(code: string): boolean {
  return code === 'gateway/internal' || code === 'gateway/cancelled' || code === 'gateway/result-invalid';
}

/** Turn one refused save into the next action; a stale baseline is the common one. */
export function saveFailureCopy(message: string): string {
  switch (codeOf(message)) {
    case 'card_math_invalid': return '正文里的公式写错了，修好再保存（其它字段不会丢）。';
    case 'card_chapter_missing': return '这个章节不在当前骨架里，换一个或先清空。';
    case 'card_link_unresolved': return '关联的卡已经不在了，去掉这一条再保存。';
    case 'card_link_unverifiable': return '现在不能核对关联的卡，稍后再保存。';
    case 'card_links_remove_forbidden': return '这一条关联现在只能由你删，老师那边删不掉。';
    case 'knowledge_public_source_missing': return '引用的公开教法版本已经不在了，去掉它再保存。';
    case 'learning_session_required': return '这节课的状态不能写学习内容，回到课堂再改。';
    case 'record_corrupt': return '这份内容读不出来了，先按最新版核对一遍再保存。';
    default: return '这次没有保存成功，稍后再试一次。';
  }
}

/** One author-facing draft; the editor's own state, never a stored shape. */
export interface CardDraft {
  readonly title: string;
  readonly presentation: CardContent['presentation'];
  readonly front: string;
  readonly sections: readonly { readonly heading: string; readonly body: string }[];
  readonly notes: string;
  readonly tags: readonly string[];
  readonly chapter: string;
  readonly links: readonly string[];
}

/** The draft one stored card opens with. */
export function draftOf(content: CardContent): CardDraft {
  return {
    title: content.title,
    presentation: content.presentation,
    front: content.front,
    sections: content.sections.map(section => ({ heading: section.heading, body: section.body })),
    notes: content.notes,
    tags: [...content.tags],
    chapter: content.chapter ?? '',
    links: [...content.links],
  };
}

/** A brand-new card's draft: nothing is prefilled that the student did not type. */
export function emptyDraft(): CardDraft {
  return { title: '', presentation: 'problem', front: '', sections: [], notes: '', tags: [], chapter: '', links: [] };
}

/**
 * The patch one edit really is: only fields the student changed, so an omitted
 * field keeps the stored text, the sources and the tags. Relations move by
 * increment — a removal is never sent as a whole-list replacement, because that
 * would clobber links another author added in between.
 */
export function patchFor(baseline: CardContent, draft: CardDraft): CardPatch {
  const patch: {
    title?: string; presentation?: CardContent['presentation']; front?: string;
    sections?: CardContent['sections']; notes?: string; tags?: string[]; chapter?: string | null;
    links_add: string[]; links_remove: string[];
  } = { links_add: [], links_remove: [] };
  if (draft.title.trim() !== baseline.title) patch.title = draft.title.trim();
  if (draft.presentation !== baseline.presentation) patch.presentation = draft.presentation;
  if (draft.front !== baseline.front) patch.front = draft.front;
  if (draft.notes !== baseline.notes) patch.notes = draft.notes;
  if (draft.chapter !== (baseline.chapter ?? '')) patch.chapter = draft.chapter === '' ? null : draft.chapter;
  if (draft.tags.join('\u0000') !== baseline.tags.join('\u0000')) patch.tags = [...draft.tags];
  const before = baseline.sections.map(section => `${section.heading}\u0000${section.body}`).join('\u0001');
  const after = draft.sections.map(section => `${section.heading}\u0000${section.body}`).join('\u0001');
  if (before !== after) patch.sections = draft.sections.map(section => ({ heading: section.heading, body: section.body }));
  const added = draft.links.filter(link => !baseline.links.includes(link));
  const removed = baseline.links.filter(link => !draft.links.includes(link));
  if (added.length > 0) patch.links_add = added;
  if (removed.length > 0) patch.links_remove = removed;
  return patch as CardPatch;
}

/** Whether the draft differs from the version it was taken from. */
export function draftChanged(baseline: CardContent, draft: CardDraft): boolean {
  const patch = patchFor(baseline, draft);
  return patch.title !== undefined || patch.presentation !== undefined || patch.front !== undefined
    || patch.notes !== undefined || patch.chapter !== undefined || patch.tags !== undefined
    || patch.sections !== undefined || patch.links_add.length > 0 || patch.links_remove.length > 0;
}

/** The card version the student is looking at, in one line. */
export function versionLabel(view: CardView): string {
  return `第 ${String(view.version)} 版`;
}

/**
 * One name per field a change or a patch can touch, so a stored key like
 * `links_add` never reaches the student. Change projections report authored
 * fields (`title`/`front`/`back`/`notes`) and mechanical ones (`presentation`,
 * `sources`, `chapter`, `tags`, `links`); both read the same table.
 */
export const CARD_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: '标题', presentation: '类型', front: '卡面', sections: '卡背', back: '卡背',
  notes: '笔记', tags: '标签', chapter: '章节', links: '关联',
  links_add: '新关联', links_remove: '去掉关联', sources: '来源',
};

export function cardFieldLabel(key: string): string {
  return CARD_FIELD_LABELS[key] ?? key;
}

/** Who really wrote one revision, in the student's own words. */
export function actorLabel(actor: Actor): string {
  switch (actor) {
    case 'student': return '你自己改的';
    case 'teacher': return '老师改的';
    case 'system': return '系统整理的';
  }
}
