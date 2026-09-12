/**
 * P7 live lane fixture: the real formal Host, booted by the released launcher
 * with the real provider — never the scripted `[tool]` test model.
 *
 * Read sides, both real:
 *  - product Remotes (`studyforgeProposals`, `studyforgeLearning`, …): what the
 *    student would actually see after the model's tool calls;
 *  - the native session log through the public `session/page` RPC. `throughSeq`
 *    is the inclusive log cut, so it is discovered from the page RPC's own
 *    "past cursor N" refusal instead of guessing (the fixture never scrapes a
 *    JSONL on disk, and the live runtime does not persist one where a test
 *    could see it).
 *
 * Without `DEEPSEEK_API_KEY` the lane cannot reach a model at all, so every
 * scenario is skipped with an explicit BLOCKED reason in its own title; a
 * missing credential is never reported as a pass.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'vitest';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue, SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import { startIsolated, type IsolatedRuntime } from '../../scripts/dev-isolated.ts';
import { connectRuntime } from './http-runtime.ts';
import type { VersionToken } from '@studyforge/contracts';
import type { CardView } from '@studyforge/contracts/cards';
import type { CourseView } from '@studyforge/contracts/courses';
import type { MaterialView } from '@studyforge/contracts/material-records';
import type { ProposalView } from '@studyforge/contracts/proposals';

/** The one external credential the real model lane needs. */
export const LIVE_BLOCKED = 'BLOCKED: no DEEPSEEK_API_KEY, so no real model request can be made';

export function hasLiveCredential(): boolean {
  const key = process.env.DEEPSEEK_API_KEY;
  return key !== undefined && key.trim().length > 0;
}

export function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

export type LiveClient = Awaited<ReturnType<typeof connectRuntime>>;

export interface LiveClassroom {
  readonly runtime: IsolatedRuntime;
  readonly client: LiveClient;
  stop(): Promise<void>;
}

/** One real formal Host over the released launcher (`testModel: false`). */
export async function openLiveClassroom(): Promise<LiveClassroom> {
  const runtime = await startIsolated({ testModel: false });
  try {
    const client = await connectRuntime(runtime);
    return { runtime, client, stop: () => runtime.stop() };
  } catch (error) { await runtime.stop(); throw error; }
}

/**
 * Declare one live scenario. The BLOCKED reason is part of the title, so the
 * live report always names what was not verified and why.
 */
export function liveTest(name: string, run: (classroom: LiveClassroom) => Promise<void>): void {
  const blocked = !hasLiveCredential();
  test.skipIf(blocked)(blocked ? `${name} · ${LIVE_BLOCKED}` : name, async () => {
    const classroom = await openLiveClassroom();
    try { await run(classroom); } finally { await classroom.stop(); }
  }, 300_000);
}

export type LiveAddress =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'subagent'; readonly parentSessionId: string; readonly childSessionId: string; readonly mode: 'one-shot' | 'continuable' };

export interface NativeEvent { readonly seq: number; readonly type: string; readonly data: unknown; }

/** One page request at an impossible cut; the refusal names the real cursor. */
async function probeCut(classroom: LiveClassroom, address: LiveAddress): Promise<{ cursor: number } | { refused: string }> {
  const probe = await classroom.client.rpc<SessionPage>('session/page', {
    request: { address, throughSeq: 1_000_000, maxMessages: 1 },
  });
  if (probe.ok) return { cursor: -1 };
  const match = /past cursor (-?\d+)/.exec(probe.error?.message ?? '');
  if (match?.[1] === undefined) return { refused: `${probe.error?.code ?? 'unknown'}: ${probe.error?.message ?? ''}` };
  return { cursor: Number(match[1]) };
}

/** Every durable native event of one address, read through the public RPC. */
export async function nativeEvents(classroom: LiveClassroom, address: LiveAddress): Promise<NativeEvent[]> {
  const probed = await probeCut(classroom, address);
  if ('refused' in probed) throw new Error(`session/page refused ${JSON.stringify(address)}: ${probed.refused}`);
  if (probed.cursor < 0) return [];
  const page = value(await classroom.client.rpc<SessionPage>('session/page', {
    request: { address, throughSeq: probed.cursor, maxMessages: 300 },
  }));
  return page.records
    .filter(record => record.type === 'event')
    .map(record => ({ seq: Number(record.event.seq), type: String(record.event.type), data: record.event.data }));
}

/** A subagent log needs its durable parent address; the mode is proven, not guessed. */
export async function subagentAddress(classroom: LiveClassroom, parentSessionId: string, childSessionId: string): Promise<LiveAddress> {
  let last = '';
  for (const mode of ['one-shot', 'continuable'] as const) {
    const address: LiveAddress = { kind: 'subagent', parentSessionId, childSessionId, mode };
    const probed = await probeCut(classroom, address);
    if (!('refused' in probed)) return address;
    last = probed.refused;
    if (!/unauthorized|mode/.test(probed.refused)) throw new Error(`subagent log refused: ${probed.refused}`);
  }
  throw new Error(`no readable subagent address for ${childSessionId}: ${last}`);
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(part => textOf(part)).join('\n');
  if (value !== null && typeof value === 'object' && 'text' in value) return textOf((value as { text: unknown }).text);
  return '';
}

/** The rendered system prompt the model really received: the latest `system/message`. */
export function preparedSystemPrompt(events: readonly NativeEvent[]): string {
  const last = events.filter(event => event.type === 'system/message').at(-1);
  if (last === undefined) return '';
  return textOf((last.data as { message?: { content?: unknown } } | null)?.message?.content);
}

/** Model-visible assistant text of one log window, newest last. */
export function assistantText(events: readonly NativeEvent[]): string {
  return events.filter(event => event.type === 'assistant/message')
    .map(event => textOf((event.data as { message?: { content?: unknown } } | null)?.message?.content)).join('\n');
}

/** Real tool names the model really called, in order. */
export function calledTools(events: readonly NativeEvent[]): string[] {
  return events.filter(event => event.type === 'tool/call').map(event => String((event.data as { name?: unknown }).name ?? ''));
}

/** The model-facing results of real tool calls, in order. */
export function toolResults(events: readonly NativeEvent[]): string[] {
  return events.filter(event => event.type === 'tool/result').map(event => JSON.stringify(event.data));
}

/** Poll one condition until it holds; the failure message carries the Host log. */
export async function until<T>(classroom: LiveClassroom, what: string, probe: () => Promise<T | undefined>, timeoutMs = 240_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = await probe();
    if (found !== undefined) return found;
    if (Date.now() > deadline) throw new Error(`live timeout: ${what}\n--- host log ---\n${classroom.runtime.log()}`);
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
}

export interface LiveTurn { readonly anchor: number; readonly events: readonly NativeEvent[]; }

/**
 * Send one ordinary Chinese task and wait for the turn it really started.
 *
 * The anchor is the accepted `user/message` itself, never "the log grew": a
 * queued prompt waits behind whatever was running, so a `turn/end` that lands
 * after the RPC but belongs to the earlier turn must not be read as ours.
 */
export async function turn(classroom: LiveClassroom, sessionId: string, text: string): Promise<LiveTurn> {
  const address: LiveAddress = { kind: 'session', sessionId };
  const before = await nativeEvents(classroom, address);
  const beforeSeq = before.length === 0 ? -1 : Math.max(...before.map(event => event.seq));
  const accepted = await classroom.client.rpc('session/prompt', {
    request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] },
  });
  if (!accepted.ok) throw new Error(JSON.stringify(accepted.error));
  const marker = text.slice(0, 12);
  const anchor = await until(classroom, `accepted prompt never entered ${sessionId}`, async () => {
    const events = await nativeEvents(classroom, address);
    const message = events.find(event => event.seq > beforeSeq && event.type === 'user/message'
      && textOf((event.data as { content?: unknown }).content).includes(marker));
    return message?.seq;
  });
  // Only a `turn/end` strictly after our own user message ends our turn.
  const events = await until(classroom, `turn of ${sessionId} did not finish`, async () => {
    const current = await nativeEvents(classroom, address);
    if (!current.some(event => event.type === 'turn/end' && event.seq > anchor)) return undefined;
    const running = value(await classroom.client.rpc<SessionListValue>('session/list', { _request: {} }))
      .items.find(item => item.sessionId === sessionId)?.running;
    return running === true ? undefined : current;
  });
  return { anchor, events };
}

/** Import a small source document as a real immutable material version. */
export async function importText(classroom: LiveClassroom, title: string, fileName: string, text: string): Promise<MaterialView> {
  return value(await classroom.client.rpc<MaterialView>('studyforgeMaterials/import', {
    input: {
      operationId: crypto.randomUUID(),
      material: { title, fileName, mediaType: fileName.endsWith('.md') ? 'text/markdown' : 'text/plain' },
      base64: Buffer.from(text).toString('base64'),
    },
  }));
}

export async function createLesson(classroom: LiveClassroom): Promise<string> {
  const created = value(await classroom.client.rpc<SessionCreateValue>('session/create', {
    request: { cwd: join(classroom.runtime.root, 'classroom'), agentPreset: 'studyforge-learning' },
  }));
  value(await classroom.client.rpc('session/selectModel', { request: {
    sessionId: created.sessionId, provider: 'deepseek-official',
    model: process.env.STUDYFORGE_LIVE_MODEL ?? 'deepseek-v4.1-flash',
  } }));
  return created.sessionId;
}

export async function readCourse(classroom: LiveClassroom, sessionId: string): Promise<CourseView> {
  return value(await classroom.client.rpc<CourseView>('studyforgeCourses/read', { input: { sessionId } }));
}

/** Apply one lesson setting through the product Remote, not by writing storage. */
export async function patchCourse(classroom: LiveClassroom, sessionId: string, patch: unknown): Promise<CourseView> {
  const course = await readCourse(classroom, sessionId);
  return value(await classroom.client.rpc<CourseView>('studyforgeCourses/update', {
    input: { sessionId, operationId: crypto.randomUUID(), expectedVersion: course.version, patch },
  }));
}

/** The real teaching-configuration body the prepared prompt must carry. */
export async function teachingPresetBody(classroom: LiveClassroom, id: string): Promise<string> {
  const dir = join(classroom.runtime.root, 'plugins/host/lib/teaching-resources');
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as { choices: { id: string; file: string }[] };
  const choice = manifest.choices.find(candidate => candidate.id === id);
  if (choice === undefined) throw new Error(`teaching configuration ${id} is not installed`);
  return readFile(join(dir, 'presets', choice.file), 'utf8');
}

/** One distinctive body line, so the assertion names real teaching text. */
export function firstBodyLine(text: string): string {
  const line = text.split('\n').map(entry => entry.trim()).find(entry => entry.length > 12 && !entry.startsWith('#'));
  if (line === undefined) throw new Error('teaching configuration body has no assertion line');
  return line;
}

export async function proposals(classroom: LiveClassroom, sessionId: string): Promise<ProposalView[]> {
  return value(await classroom.client.rpc<ProposalView[]>('studyforgeProposals/list', { input: { sessionId } }));
}

export async function cards(classroom: LiveClassroom): Promise<CardView[]> {
  return value(await classroom.client.rpc<CardView[]>('studyforgeLearning/cards', {}));
}

/** Confirm exactly the item the student saw, through the real decision Remote. */
export async function confirmItems(classroom: LiveClassroom, proposal: ProposalView,
  items: readonly { itemId: string; draft: number; digest: string; target: string | null; baseline: VersionToken | null }[]): Promise<ProposalView> {
  return value(await classroom.client.rpc<ProposalView>('studyforgeProposals/confirm', {
    input: { operationId: crypto.randomUUID(), target: proposal.ref, selection: { revision: proposal.version, items } },
  }));
}
