import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { SessionCreateValue, SessionListValue, SessionPage } from '@deepseek-ai/dsh-api-session-controller';
import { readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { VaultRuntime } from '../../scripts/dev-isolated.ts';

/**
 * Test-only native HTTP transport for the isolated Vault runtime. It talks to a
 * real DSH Host over `/api` and answers the Host's own Agent-scoped Remote Event
 * stream, so native writes stay behind the native approval waterfall instead of
 * being called around it. Credentials stay in memory and are refreshed by
 * reconnecting after a restart.
 */

/** One scripted reply, mirroring scripts/fixtures/vault-test-model.ts. */
export interface ScriptedCall { name: string; arguments?: unknown }
export type ScriptedReply = string | ScriptedCall | ScriptedCall[] | { text?: string; calls?: ScriptedCall[] };

/** One `approval/request` waterfall frame, as the Host projects it to a client. */
export interface ApprovalPrompt { toolName: string; callId?: string; reason?: string }
/** The interactive outcomes the composer exposes (allow oncce / reject). */
export type ApprovalDecision = 'allowed-once' | 'rejected';

export interface AssembledBlock { type: string; text?: string; id?: string; name?: string; arguments?: string; attachment?: { attachmentId?: string } }
export interface AssembledMessage { role: string; source?: { kind?: string; plugin?: string; form?: string; entries?: { name?: string }[] }; content: AssembledBlock[] }
export interface AssembledRequest {
  sessionId: string | null;
  purpose: string | null;
  provider: string;
  model: string;
  messages: AssembledMessage[];
  toolSchemas: unknown[];
  at: string;
}

/** One `tool/result` in a real session, paired with its requesting tool call. */
export interface ToolOutcome { callId?: string; name?: string; failed: boolean; text: string }

export interface SessionRow { sessionId: string; running?: boolean; agentPreset?: string; projections?: { values?: { title?: string } } }

export interface VaultHarness {
  readonly root: string;
  readonly origin: string;
  readonly workspace: string;
  readonly vault: string;
  rpc<T>(method: string, args: unknown): Promise<RemoteResult<T>>;
  value<T>(result: RemoteResult<T>): T;
  /** Create a native session in this instance's only workspace. */
  createSession(agentPreset?: string): Promise<string>;
  rename(sessionId: string, title: string): Promise<void>;
  sessions(): Promise<SessionRow[]>;
  archivedSessionIds(): Promise<string[]>;
  /** Send one natural user message and wait for the turn to settle. */
  ask(sessionId: string, text: string, script?: Record<string, ScriptedReply>): Promise<AssembledRequest[]>;
  /** Wait until the session has produced a new main request and is idle again. */
  waitForTurn(sessionId: string, before: number): Promise<void>;
  /** Every assembled main request (purpose null) of one session, in order. */
  turns(sessionId: string): Promise<AssembledRequest[]>;
  requests(): Promise<AssembledRequest[]>;
  outcomes(sessionId: string): Promise<ToolOutcome[]>;
  /** Replace the whole scripted reply table for the synthetic adapter. */
  script(replies: Record<string, ScriptedReply>): Promise<void>;
  /** Set one scripted reply, keeping the others. */
  scriptOne(text: string, reply: ScriptedReply): Promise<void>;
  readVaultFile(path: string): Promise<string>;
  writeVaultFile(path: string, content: string): Promise<void>;
  vaultExists(path: string): Promise<boolean>;
  vaultFiles(prefix?: string): Promise<string[]>;
  approvals: {
    readonly seen: ApprovalPrompt[];
    /** Queue one decision for the next request; extra requests use the last one. */
    answer(decision: ApprovalDecision): void;
    /** Decision used when the queue is empty. */
    auto(decision: ApprovalDecision): void;
  };
  close(): Promise<void>;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Canonical JSON of a tool result, when the tool returned a JSON payload. */
export function outcomeJson<T = Record<string, unknown>>(outcome: ToolOutcome): T | undefined {
  try {
    const parsed: unknown = JSON.parse(outcome.text);
    return parsed !== null && typeof parsed === 'object' ? parsed as T : undefined;
  } catch { return undefined; }
}

/** Tool names the Host offered to the model in one assembled request. */
export function toolNames(request: AssembledRequest): string[] {
  const names: string[] = [];
  for (const entry of request.toolSchemas) {
    if (entry === null || typeof entry !== 'object') continue;
    const name = (entry as { name?: unknown }).name;
    if (typeof name === 'string') names.push(name);
  }
  return names;
}

/** Every content block the provider actually received, including the blocks a
 * tool result carries inside itself (an image attachment is nested there). */
export function blocks(request: AssembledRequest): AssembledBlock[] {
  const flat: AssembledBlock[] = [];
  const visit = (list: AssembledBlock[] | undefined): void => {
    for (const block of list ?? []) {
      flat.push(block);
      visit((block as { content?: AssembledBlock[] }).content);
    }
  };
  for (const message of request.messages) visit(message.content);
  return flat;
}

/** Text of every tool result the provider actually received in one request. */
export function toolResultTexts(request: AssembledRequest): string[] {
  return blocks(request)
    .filter(block => block.type === 'tool-result')
    .flatMap(block => ((block as { content?: AssembledBlock[] }).content ?? []).filter(inner => inner.type === 'text').map(inner => inner.text ?? ''));
}

/** The system prompt snapshot that is in effect for this request: the Host
 * updates the prompt in-history, so a switched setting appends a new snapshot
 * and the earlier one stays in the retained history. */
export function effectiveSystemText(request: AssembledRequest): string {
  const snapshots = request.messages.filter(message => message.role === 'system');
  return (snapshots.at(-1)?.content ?? []).map(block => block.text ?? '').join('');
}

/** Skill names the Host offered to the model in one assembled request. */
export function skillNames(request: AssembledRequest): string[] {
  const names: string[] = [];
  for (const message of request.messages) {
    for (const entry of message.source?.entries ?? []) if (typeof entry.name === 'string') names.push(entry.name);
  }
  return names;
}

export async function connectVault(runtime: VaultRuntime): Promise<VaultHarness> {
  const origin = new URL(runtime.authUrl).origin;
  const login = await fetch(runtime.authUrl, { redirect: 'manual', headers: { connection: 'close' } });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const root = runtime.root;
  const workspace = await realpath(join(root, 'workspace'));
  const vault = join(workspace, 'vault');
  const repliesPath = join(root, 'teacher-replies.json');
  const requestsPath = join(root, 'model-requests.jsonl');

  async function rpc<T>(method: string, args: unknown): Promise<RemoteResult<T>> {
    // One socket per call: undici does not retry a POST dispatched onto a
    // pooled connection the server has already decided to close.
    const response = await fetch(origin + '/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json', cookie, connection: 'close' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload: { args } }) });
    if (response.status !== 200) throw new Error(`native ${method} HTTP ${response.status}`);
    const body: unknown = await response.json();
    if (body === null || typeof body !== 'object' || !('result' in body)) throw new Error('Invalid native response envelope');
    const result = (body as { result: unknown }).result;
    if (result === null || typeof result !== 'object' || !('ok' in result)) throw new Error('Invalid native response envelope');
    return result as RemoteResult<T>;
  }

  function value<T>(result: RemoteResult<T>): T {
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
    return result.value;
  }

  // The Host forwards `approval/request` as an Agent-scoped Remote Event
  // waterfall over the same mux socket the browser uses. Answers ride the
  // unary HTTP carrier (`$events/result`), exactly like a real client's.
  const seen: ApprovalPrompt[] = [];
  const queued: ApprovalDecision[] = [];
  let standing: ApprovalDecision = 'allowed-once';
  let clientId = '';
  const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/api/remote.mux', { headers: { cookie } } as unknown as string[]);
  socket.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as { type?: string; value?: { type?: string; clientId?: string; event?: string; eventId?: string; request?: ApprovalPrompt } };
    if (frame.type !== 'item' || frame.value === undefined) return;
    const item = frame.value;
    if (item.type === 'ready' && typeof item.clientId === 'string') { clientId = item.clientId; return; }
    if (item.type !== 'waterfall' || item.event !== 'approval/request' || item.request === undefined || item.eventId === undefined) return;
    seen.push(item.request);
    const decision = queued.shift() ?? standing;
    void rpc('$events/result', { clientId, eventId: item.eventId, outcome: { kind: 'result', value: decision } });
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve());
    socket.addEventListener('error', () => reject(new Error('native Remote event socket failed')));
    setTimeout(() => reject(new Error('native Remote event socket timed out')), 15_000);
  });
  socket.send(JSON.stringify({ type: 'open', streamId: 'events', endpoint: '$events', payload: { args: {} } }));
  const readyDeadline = Date.now() + 15_000;
  while (clientId === '') {
    if (Date.now() > readyDeadline) throw new Error('native Remote event stream was never ready');
    await delay(20);
  }

  async function requests(): Promise<AssembledRequest[]> {
    const raw = await readFile(requestsPath, 'utf8').catch(() => '');
    const rows: AssembledRequest[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line) as AssembledRequest); } catch { /* a torn tail line is not a request */ }
    }
    return rows;
  }
  const turns = async (sessionId: string) => (await requests()).filter(row => row.sessionId === sessionId && row.purpose === null);

  async function records(sessionId: string): Promise<SessionPage['records']> {
    const address = { kind: 'session' as const, sessionId };
    const end = await rpc<SessionPage>('session/page', { request: { address, throughSeq: 1_000_000, maxMessages: 1 } });
    const cursor = end.ok ? -1 : Number(/past cursor (-?\d+)/.exec(end.error.message)?.[1] ?? -1);
    return value(await rpc<SessionPage>('session/page', { request: { address, throughSeq: cursor, maxMessages: 1000 } })).records;
  }

  async function outcomes(sessionId: string): Promise<ToolOutcome[]> {
    // Pair each tool result with the tool call that produced it: the call
    // identity only exists in the assembled assistant message.
    const byCallId = new Map<string, string>();
    for (const request of await turns(sessionId)) {
      for (const block of blocks(request)) if (block.type === 'tool-call' && block.id !== undefined && block.name !== undefined) byCallId.set(block.id, block.name);
    }
    const rows: ToolOutcome[] = [];
    for (const record of await records(sessionId)) {
      if (record.type !== 'event' || record.event.type !== 'tool/result') continue;
      const message = (record.event.data as { message: { content: { isError?: boolean; toolCallId?: string; content: { type: string; text?: string }[] }[] } }).message;
      const first = message.content[0];
      if (first === undefined) continue;
      rows.push({
        ...(first.toolCallId === undefined ? {} : { callId: first.toolCallId }),
        ...(first.toolCallId === undefined || !byCallId.has(first.toolCallId) ? {} : { name: byCallId.get(first.toolCallId) as string }),
        failed: first.isError === true,
        text: first.content.find(block => block.type === 'text')?.text ?? '',
      });
    }
    return rows;
  }

  async function sessions(): Promise<SessionRow[]> {
    return value(await rpc<SessionListValue>('session/list', { _request: {} })).items as unknown as SessionRow[];
  }

  async function waitForTurn(sessionId: string, before: number, timeoutMs = 120_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = (await sessions()).find(item => item.sessionId === sessionId);
      const started = (await turns(sessionId)).length > before;
      if (started && row?.running !== true) return;
      if (Date.now() > deadline) throw new Error(`session ${sessionId} did not settle: started=${String(started)} running=${String(row?.running)}`);
      await delay(150);
    }
  }

  async function script(replies: Record<string, ScriptedReply>): Promise<void> {
    await writeFile(repliesPath, `${JSON.stringify(replies, null, 2)}\n`);
  }
  async function scriptOne(text: string, reply: ScriptedReply): Promise<void> {
    const raw = await readFile(repliesPath, 'utf8').catch(() => '{}');
    let current: Record<string, unknown> = {};
    try { const parsed: unknown = JSON.parse(raw); if (parsed !== null && typeof parsed === 'object') current = parsed as Record<string, unknown>; } catch { /* rewrite a torn file */ }
    current[text] = reply;
    await script(current as Record<string, ScriptedReply>);
  }

  async function createSession(agentPreset = 'notara-teacher'): Promise<string> {
    return value(await rpc<SessionCreateValue>('session/create', { request: { cwd: workspace, agentPreset } })).sessionId;
  }

  const harness: VaultHarness = {
    root, origin, workspace, vault, rpc, value, createSession,
    async rename(sessionId, title) { value(await rpc('session/rename', { request: { sessionId, title } })); },
    sessions,
    async archivedSessionIds() {
      const storage = JSON.parse(await readFile(join(root, 'home/storages/workspace.json'), 'utf8')) as { global?: { archivedSessionIds?: string[] } };
      return storage.global?.archivedSessionIds ?? [];
    },
    async ask(sessionId, text, replies) {
      if (replies !== undefined) await script(replies);
      const before = (await turns(sessionId)).length;
      value(await rpc('session/prompt', { request: { sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text }] } }));
      await waitForTurn(sessionId, before);
      return (await turns(sessionId)).slice(before);
    },
    turns, requests, outcomes, script, scriptOne, waitForTurn,
    async readVaultFile(path) { return readFile(join(vault, path), 'utf8'); },
    async writeVaultFile(path, content) { await writeFile(join(vault, path), content); },
    async vaultExists(path) { return stat(join(vault, path)).then(() => true, () => false); },
    async vaultFiles(prefix = '') {
      const walk = async (relative: string): Promise<string[]> => {
        const directory = join(vault, relative);
        const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
        const files: string[] = [];
        for (const entry of entries) {
          const next = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.isDirectory()) files.push(...await walk(next));
          else if (next.startsWith(prefix)) files.push(next);
        }
        return files;
      };
      return walk('');
    },
    approvals: { seen, answer(decision) { queued.push(decision); }, auto(decision) { standing = decision; } },
    async close() { socket.close(); },
  };
  return harness;
}
