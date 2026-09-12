/**
 * Pure presentation helpers for the P6 course surface.
 *
 * Nothing here owns a fact: a node, a declaration and a material reference all
 * arrive from the Host's own reply. These functions only turn opaque identity
 * into something a student can read, and give the roadmap one deterministic
 * shape — insertion order wins, a node always sits under the parent it names.
 */
import type { LessonMaterial } from '@studyforge/contracts/lesson-materials';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { RouteDecl, RouteNode } from '@studyforge/contracts/routes';

/** The civil day of one instant in the zone the caller names, never a UTC slice. */
export function civilDayIn(zone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(at);
  const read = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** `2026-09-12` reads as `9月12日`; an unknown shape stays as it came. */
export function dayLabel(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return day;
  return `${Number(match[2])}月${Number(match[3])}日`;
}

/** One planned node's own date, or the plan is simply undated. */
export function nodeDate(node: RouteNode): string | undefined {
  return node.date;
}

/** The teaching configuration a node (or its nearest ancestor) really declared. */
export function effectiveDecl(nodes: readonly RouteNode[], node: RouteNode): RouteDecl {
  const byId = new Map(nodes.map(candidate => [candidate.id, candidate] as const));
  const merged: RouteDecl = {};
  const chain: RouteNode[] = [];
  const seen = new Set<string>();
  let cursor: RouteNode | undefined = node;
  while (cursor !== undefined && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parent === undefined ? undefined : byId.get(cursor.parent);
  }
  for (const step of chain) {
    if (step.decl?.name !== undefined) merged.name = step.decl.name;
    if (step.decl?.teachingRef !== undefined) merged.teachingRef = step.decl.teachingRef;
    if (step.decl?.stance !== undefined) merged.stance = step.decl.stance;
  }
  return merged;
}

/**
 * One teaching reference in words a student can read. An unknown identity never
 * leaks as a raw id: an unresolved card reads as "一张卡", and an unresolved
 * original keeps the title the material list already gave it.
 */
export function materialLabel(
  material: LessonMaterial,
  materials: readonly MaterialView[],
  cards: readonly { readonly ref: string; readonly content: { readonly title: string } }[] = [],
): string {
  if (material.kind === 'card') {
    const title = cards.find(card => card.ref === material.cardRef)?.content.title ?? '一张卡';
    return material.cardVersion === undefined ? title : `${title} · 第 ${material.cardVersion} 版`;
  }
  const version = material.source.versionId;
  const known = materials.find(candidate => candidate.versions.some(item => item.versionId === version));
  const title = known?.title ?? '一份资料';
  const locator = material.source.locator;
  if (locator === undefined) return title;
  if (locator.kind === 'pdf') return `${title} · 第 ${locator.page} 页`;
  if (locator.kind === 'image') return `${title} · 图片`;
  if (locator.kind === 'docx') return `${title} · ${locator.part}`;
  return `${title} · L${locator.start.line}`;
}

/** One depth-first walk in stored order; a cycle can never be reached twice. */
export function walkRoute(nodes: readonly RouteNode[]): { readonly node: RouteNode; readonly depth: number }[] {
  const children = new Map<string | undefined, RouteNode[]>();
  for (const node of nodes) {
    const list = children.get(node.parent) ?? [];
    list.push(node);
    children.set(node.parent, list);
  }
  const out: { node: RouteNode; depth: number }[] = [];
  const seen = new Set<string>();
  const visit = (node: RouteNode, depth: number): void => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({ node, depth });
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
  };
  for (const node of nodes) if (node.parent === undefined || !nodes.some(candidate => candidate.id === node.parent)) visit(node, 0);
  for (const node of nodes) visit(node, 0);
  return out;
}

/** Every id a mount could legally take: the node itself and nothing below it. */
export function mountCandidates(nodes: readonly RouteNode[], nodeId: string): RouteNode[] {
  const allowed = new Set(nodes.map(node => node.id));
  const banned = new Set<string>([nodeId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parent !== undefined && banned.has(node.parent) && !banned.has(node.id)) {
        banned.add(node.id);
        grew = true;
      }
    }
  }
  return nodes.filter(node => allowed.has(node.id) && !banned.has(node.id));
}

/**
 * The refusal code a Remote failure really carries. A domain refusal is folded
 * into one carrier failure, so the Host's own code travels inside the message
 * (`route_node_conflict: node-3`); `gateway/*` means no business answer came
 * back at all. The code is what the UI branches on — never the raw message.
 */
const REFUSAL_CODE = /\b(?:route_[a-z_]+|set_[a-z_]+|plan_[a-z_]+|material_[a-z_]+|skeleton_[a-z_]+|course_[a-z_]+|version_conflict|operation_conflict|record_missing|record_corrupt|workspace_mismatch|learning_session_required|target_invalid)\b/u;

export function refusalCode(error: { readonly code?: unknown; readonly message: string }): string {
  const match = REFUSAL_CODE.exec(error.message);
  if (match !== null) return match[0];
  return typeof error.code === 'string' && error.code !== '' ? error.code : error.message.trim();
}
