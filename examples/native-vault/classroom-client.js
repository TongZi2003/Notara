import { createVaultClient } from './remote-client.js';
import { createDraftStore } from './draft-client.js';
import { SOLVER_MAX_TOKENS, SOLVER_MIN_TOKENS, SOLVER_TOKEN_LIMIT, preferredSolverEffort, validSolverBudget } from './solver-policy.js';
import { workerPreset } from './worker-catalog.js';

/**
 * 独立“教室”bench：一位主教师、五位后台工作员与它们各自的后台任务。
 *
 * This bench is not a second chat and not a worldbook form. It renders exactly
 * the facts the Host already owns — who is teaching, which worker can run and
 * what that worker's background tasks are doing — and sends exactly three
 * requests back (`classroom` / `configureSolver` / `cancelSolver`). Raw
 * questions, analyses and child sessions never reach this projection: they stay
 * in the background lane, so a student reading this pane cannot read the
 * answer, the task id or the child agent.
 *
 * One preset is configured at a time, and every preset keeps its own route and
 * tool scope; nothing here collapses the five roles into one shared setting.
 */

export const CLASSROOM_VIEW = 'notara-vault-classroom';

/** One row of the background lane: status only, never a task id or a result. */
const TASK_STATUS = {
  running: { label: '分析中', tone: 'run' },
  completed: { label: '分析完成', tone: 'done' },
  failed: { label: '分析失败', tone: 'fail' },
  canceled: { label: '已停止', tone: 'idle' },
  interrupted: { label: '已中断', tone: 'idle' },
};

const text = value => (typeof value === 'string' ? value : '');

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/** The saved independent model route and its optional generation allowance. */
export function normalizeRoute(route) {
  const raw = record(route);
  if (!raw) return null;
  const provider = text(raw.provider).trim(), model = text(raw.model).trim();
  if (!provider || !model) return null;
  return {
    provider,
    model,
    ...(text(raw.reasoningEffort).trim() ? { reasoningEffort: text(raw.reasoningEffort).trim() } : {}),
    ...(validSolverBudget(raw.maxTokens) ? { maxTokens: raw.maxTokens } : {}),
  };
}

/** The models the Host says this classroom can run, in the order it sent them. */
export function modelChoices(value) {
  const rows = Array.isArray(value?.models) ? value.models : [];
  const choices = [], seen = new Set();
  for (const row of rows) {
    const entry = record(row);
    if (!entry) continue;
    const provider = text(entry.provider).trim(), model = text(entry.model).trim();
    if (!provider || !model || seen.has(`${provider}\u0000${model}`)) continue;
    seen.add(`${provider}\u0000${model}`);
    choices.push({
      provider,
      model,
      label: text(entry.label).trim() || model,
      reasoningEfforts: [...new Set((Array.isArray(entry.reasoningEfforts) ? entry.reasoningEfforts : []).map(item => text(item).trim()).filter(Boolean))],
    });
  }
  return choices;
}

/** The one tool scope a worker may be given: no tools, or read-only material. */
export function normalizeTools(value) {
  return text(value) === 'read' ? 'read' : 'none';
}

/**
 * The teacher-facing wording for one worker's tool scope. `read` really lets
 * that worker open the scoped原文 with read/glob/grep/read_image; `none` only
 * receives what the teacher handed over — the two are never described the same.
 */
export function workerScopeLabel(worker) {
  const tools = text(worker?.tools);
  if (tools === 'read') return '可读取原文、搜索资料和查看图片';
  if (tools === 'none') return '不读文件，只用老师交付的材料';
  return '';
}

/** One draft per session AND per preset: two workers never share a form. */
export function workerDraftKey(sessionId, presetId) {
  return `${text(sessionId)}\u0000${text(presetId)}`;
}

/**
 * The five workers exactly as the Host describes them, in the Host's order.
 *
 * A worker the Host did not send is not invented here: the bench renders the
 * real rows, so a deployment that mounts three presets shows three. The name
 * falls back to the shared catalog only when the Host sent none — it is a role
 * label, never a model-facing string.
 */
export function workerRows(value) {
  const rows = Array.isArray(value?.workers) ? value.workers : [];
  return rows
    .map(row => record(row))
    .filter(Boolean)
    .map(row => {
      const id = text(row.id).trim();
      const catalog = workerPreset(id);
      const ready = row.ready === true;
      return {
        id,
        // The catalog name is the trusted role label; a Host-sent name only fills a
        // preset this build does not know, so no arbitrary string becomes the label.
        name: catalog?.name || text(row.name).trim() || '后台工作员',
        description: text(row.description).trim() || catalog?.description || '',
        preferredModel: text(row.preferredModel).trim(),
        route: normalizeRoute(row.route),
        ready,
        // A reason is only shown when it explains a real refusal; ready work never
        // claims a model it did not get.
        reason: ready ? '' : text(row.reason).trim(),
        tools: normalizeTools(row.tools),
      };
    })
    .filter(row => row.id);
}

/** The teacher and the five workers exactly as the Host describes them. */
export function classroomSummary(value) {
  const teacher = record(value?.teacher);
  return {
    revision: Number.isInteger(value?.revision) ? value.revision : 0,
    teacher: { name: text(teacher?.name).trim(), description: text(teacher?.description).trim() },
    workers: workerRows(value),
    models: modelChoices(value),
  };
}

/** One worker row, or null when the Host does not run that preset. */
export function workerById(view, id) {
  return (view?.workers ?? []).find(row => row.id === text(id)) ?? null;
}

/** The route most worth offering first: the exact preferred model, never a substitute. */
export function preferredCandidate(worker, choices) {
  const preferred = text(worker?.preferredModel).trim();
  const rows = Array.isArray(choices) ? choices : [];
  return preferred ? rows.find(choice => choice.model === preferred) ?? null : null;
}

/** The route the classroom can really run, resolved against the advertised models. */
export function availableRoute(worker, choices) {
  const route = normalizeRoute(worker?.route);
  if (!route) return null;
  return (Array.isArray(choices) ? choices : []).find(choice => choice.provider === route.provider && choice.model === route.model) ?? null;
}

/**
 * The one line a student may read about one worker's model. It names the
 * preferred model only when the Host really offers it; otherwise it reports the
 * gap instead of quietly teaching with the teacher's own model.
 */
export function workerRouteNotice(worker, choices) {
  const route = normalizeRoute(worker?.route);
  const ready = availableRoute(worker, choices);
  // `ready` is the Host's own verdict on the route in force, so it decides first:
  // 保存过的选择失效时先讲原因，绝不宣称正在使用某个模型。route 已不在候选列表
  // 里（例如模型被移除）同样是不可用，不能因为同名候选还在就报成可用。
  if (route && (!worker?.ready || !ready)) return worker.reason || `后台模型 ${route.model} 现在不可用，老师可以重新选择。`;
  // 没有 route 但 Host 说不可用：这里同样只讲原因，不再编“稍后重试”。
  if (!worker?.ready && worker?.reason) return worker.reason;
  const chosen = ready ?? route;
  if (chosen) {
    const effort = chosen.reasoningEffort;
    const label = ready?.label ?? chosen.model;
    return `后台分析使用 ${label}${effort ? ` · ${effort}` : ''}。`;
  }
  const preferred = preferredCandidate(worker, choices);
  if (!worker?.ready) return preferred ? '后台分析暂时不可用。' : `后台模型 ${worker?.preferredModel || '（未指定）'} 当前没有接入。`;
  return `后台分析会自动匹配 ${worker.preferredModel}。`;
}

/** The one line under a worker row, in the same vocabulary as the route notice. */
export function workerFootnote(worker, choices) {
  // `ready` already means the Host can run the route in force (saved, or its own
  // auto-matched default), so the gap notice only shows when neither holds.
  if (availableRoute(worker, choices) || worker?.ready) return '后台结果只交给老师，老师会用自己的方式讲给你。';
  return `请在教室设置里接入 ${worker?.preferredModel || '后台模型'}；老师自己的模型不会用来代替它。`;
}

/** Whether one recorded task can be opened in its own native child session. */
export function canInspectTask(row) {
  const task = record(row);
  return task?.inspectable === true;
}

/** The same judgement the task row uses before offering 查看分析. */
export function showsInspectAction(row) {
  return row?.inspectable === true;
}

/** The Host's trusted Chinese label for one preset id, if it is a known preset. */
export function presetLabel(id) {
  return workerPreset(text(id).trim())?.name ?? '';
}

export function taskRows(value) {
  const rows = Array.isArray(value?.tasks) ? value.tasks : [];
  const order = { running: 0, completed: 1, failed: 2, canceled: 3, interrupted: 4 };
  return rows
    .map(row => record(row))
    .filter(Boolean)
    .map(row => {
      const preset = text(row.preset).trim();
      return {
        id: text(row.id),
        preset,
        // Same rule as the worker rows: the catalog's preset name wins, and the
        // Host's own label is only used when this build does not know the preset.
        name: presetLabel(preset) || text(row.name).trim() || '后台任务',
        status: Object.hasOwn(TASK_STATUS, row.status) ? row.status : 'interrupted',
        startedAt: text(row.startedAt),
        inspectable: row.inspectable === true,
      };
    })
    .filter(row => row.id)
    .sort((left, right) => (order[left.status] ?? 9) - (order[right.status] ?? 9) || right.startedAt.localeCompare(left.startedAt))
    .slice(0, 6)
    .map(row => ({
      id: row.id,
      preset: row.preset,
      name: row.name,
      status: row.status,
      label: TASK_STATUS[row.status].label,
      tone: TASK_STATUS[row.status].tone,
      cancelable: row.status === 'running',
      // 只有已经真的 spawn 出子会话的任务才能打开：准备瞬间的按钮会报错。
      inspectable: row.inspectable === true,
    }));
}

export function hasRunningTask(value) {
  return taskRows(value).some(row => row.status === 'running');
}

// ---------------------------------------------------------------------------
// 学生安全投影: the teaching conversation's own tool rows
// ---------------------------------------------------------------------------

/**
 * The teacher's private lane, named by the durable tools that carry it. The new
 * model-facing tool is `ask_worker`; `ask_solver` stays listed only so rows an
 * older classroom already wrote still render through the same projection. No
 * new model tool may be registered under the retired name.
 */
export const WORKER_TOOL_NAME = 'ask_worker';
export const WORKER_TOOL_NAMES = Object.freeze(['ask_worker', 'ask_solver', 'subagent', 'subagent_fork', 'subagent_spawn']);

/** Whether a durable tool name belongs to the projected background lane. */
export function isWorkerTool(name) {
  return WORKER_TOOL_NAMES.includes(text(name));
}

/** The pinned status vocabulary ask_worker rows may show. */
export const WORKER_STATUS = Object.freeze({ running: '正在分析', handed: '已交给老师', refused: '暂时不能分析', stopped: '已停止' });

/** The label a worker row falls back to when the preset is unknown or absent. */
export const WORKER_FALLBACK_NAME = '后台工作员';

/**
 * The tool arguments are teacher-private, so only one field may leave them: the
 * preset id, and only when it names a preset this build knows. The returned
 * string is the catalog's own Chinese role name, never a copy of model text.
 */
export function workerPresetLabel(block) {
  const node = record(block);
  const raw = text(node?.argsRaw) || text(node?.call?.argsRaw);
  if (!raw) return WORKER_FALLBACK_NAME;
  let args = null;
  try { args = record(JSON.parse(raw)); } catch { return WORKER_FALLBACK_NAME; }
  return presetLabel(args?.preset) || WORKER_FALLBACK_NAME;
}

/**
 * Project one ask_worker Tool call into what a student may read.
 *
 * `block` is the durable call/result node the native Chat renderer receives
 * (`{callId, name, argsRaw, turn, step, time, subCalls}` for a live call, or
 * `{kind: 'tool-result', call, isError, ...}` once settled). The projection is
 * total by construction: it returns fixed wording plus the trusted preset name,
 * and it never copies `content`, the child session or any preview the run
 * produced. The only state that leaves this function is one of the pinned status
 * keys, so no raw field can leak through it.
 */
export function workerRowProjection(block) {
  const node = record(block);
  const name = workerPresetLabel(node);
  if (!node) return { lane: 'worker', name, state: 'running', text: `正在请${name}处理这次任务。` };
  const settled = node.kind === 'tool-result';
  const error = settled && (node.isError === true || node.error !== undefined);
  if (!settled) return { lane: 'worker', name, state: 'running', text: `正在请${name}处理这次任务，结果只会交给老师。` };
  if (error) return { lane: 'worker', name, state: 'refused', text: `${name}这次没有完成，老师会换一种方式带你。` };
  return { lane: 'worker', name, state: 'handed', text: `${name}的结果已经交给老师，由老师决定怎么讲。` };
}

/** Same projection for a native conversation tool call the teacher ran. */
export function toolRowProjection(node) {
  const block = record(node)?.block;
  return workerRowProjection(block);
}

/** The empty pick: an unconfigured worker stays unconfigured until a real choice. */
export const WORKER_MODEL_PLACEHOLDER = '请选择已接入的解题模型';

/**
 * The route the settings form opens with for one worker. A route the teacher
 * already saved wins, because it is the setting that is really in force. With
 * nothing saved, only the exact preferred model is offered as the initial value
 * — a real option list with no match is left unpicked (`''`) instead of silently
 * preselecting some other model.
 */
export function candidateRouteFor(worker, choices) {
  const rows = Array.isArray(choices) ? choices : [];
  if (!rows.length) return null;
  const saved = normalizeRoute(worker?.route);
  const kept = saved ? rows.find(choice => choice.provider === saved.provider && choice.model === saved.model) : undefined;
  if (kept) {
    const effort = kept.reasoningEfforts.includes(saved.reasoningEffort ?? '') ? saved.reasoningEffort : preferredSolverEffort(kept.reasoningEfforts);
    return { ...saved, ...(effort ? { reasoningEffort: effort } : {}) };
  }
  const preferred = text(worker?.preferredModel).trim();
  const exact = preferred ? rows.find(choice => choice.model === preferred) : undefined;
  if (!exact) return null;
  const effort = preferredSolverEffort(exact.reasoningEfforts);
  return { provider: exact.provider, model: exact.model, ...(effort ? { reasoningEffort: effort } : {}) };
}

/** The form state a dialog opens with for one worker: the real choice, never an invention. */
export function workerDraft(worker, choices) {
  const suggested = candidateRouteFor(worker, choices);
  // The picker shows the route in force first: an unavailable saved model stays on
  // screen (disabled) instead of being replaced by a suggestion the teacher never
  // chose. With nothing saved it opens on the exact preferred model, because that
  // is the Host's own automatic default — never some other model.
  const shown = normalizeRoute(worker?.route) ?? suggested;
  return {
    provider: shown?.provider ?? '',
    model: shown?.model ?? '',
    reasoningEffort: shown?.reasoningEffort ?? '',
    maxTokens: shown?.maxTokens ?? SOLVER_MAX_TOKENS,
    // The tool scope is the worker's own saved setting, defaulting to none.
    tools: normalizeTools(worker?.tools),
  };
}

/**
 * What 保存 sends, and what 恢复默认自动匹配 sends.
 *
 * `draftRoute` never invents an on/off switch: a complete pick is an explicit
 * route, and an empty pick is `null`, which means "clear my choice and let the
 * Host auto-match its default". `null` is therefore a restore, not a disable,
 * and the UI must not describe it as turning the worker off.
 */
export function draftRoute(draft) {
  const maxTokens = draft?.maxTokens === undefined ? undefined : Number(draft.maxTokens);
  if (maxTokens !== undefined && !validSolverBudget(maxTokens)) return null;
  return normalizeRoute({ provider: draft?.provider, model: draft?.model, reasoningEffort: draft?.reasoningEffort, maxTokens });
}

/** The tool scope one save sends: the worker's own pick, never a global default. */
export function draftTools(draft) {
  return normalizeTools(draft?.tools);
}

/** Whole minutes since a task started, for a status line that carries no id. */
export function elapsedLabel(startedAt, now = Date.now()) {
  const started = Date.parse(text(startedAt));
  if (!Number.isFinite(started)) return '';
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  if (minutes < 1) return '刚刚开始';
  return minutes < 60 ? `已进行 ${minutes} 分钟` : `已进行 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

/** Completed receipts use their recorded end time; old interrupted tasks have no duration. */
export function taskElapsedLabel(task, now = Date.now()) {
  if (task?.status === 'running') return elapsedLabel(task.startedAt, now);
  const start = Date.parse(text(task?.startedAt)), end = Date.parse(text(task?.finishedAt));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  const seconds = Math.floor((end - start) / 1000), minutes = Math.floor(seconds / 60);
  if (seconds < 60) return `用时 ${seconds} 秒`;
  return minutes < 60 ? `用时 ${minutes} 分钟` : `用时 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
}

export const CLASSROOM_CSS = `
.nv-classroom{display:flex;flex-direction:column;gap:18px;padding:20px;overflow:auto;flex:1;min-height:0}
.nv-classroom-head{display:flex;align-items:center;gap:8px}
.nv-classroom-head strong{font-size:16px;letter-spacing:.02em}
.nv-classroom-head .nv-classroom-note{color:var(--dsw-alias-label-secondary);font-size:12px;margin-left:auto}
.nv-members{display:grid;gap:8px}
.nv-member{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;gap:10px;padding:12px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.nv-member strong{font-size:14px}
.nv-member p{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7}
.nv-member-role{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.nv-member-state{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.nv-member-state[data-tone=run]{color:var(--dsw-alias-state-business-primary)}
.nv-member-state[data-tone=warn]{color:var(--dsw-alias-state-warn-primary)}
.nv-lane{display:grid;gap:8px}
.nv-lane-head{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}
.nv-lane-head .nv-icon{margin-left:auto}
.nv-tasks{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.nv-task{display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
.nv-task-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-caption);flex:none}
.nv-task[data-tone=run] .nv-task-dot{background:var(--dsw-alias-state-business-primary)}
.nv-task[data-tone=done] .nv-task-dot{background:var(--dsw-alias-state-success-primary,var(--dsw-alias-state-business-primary))}
.nv-task[data-tone=fail] .nv-task-dot{background:var(--dsw-alias-state-error-primary)}
.nv-task-time{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:12px;white-space:nowrap}
.nv-classroom-empty{color:var(--dsw-alias-label-secondary);font-size:12px;padding:14px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;line-height:1.8}
.nv-classroom-error{padding:10px 12px;border:1px solid var(--dsw-alias-state-error-primary);border-radius:8px;font-size:12px;color:var(--dsw-alias-label-primary)}
.nv-worker-row{display:flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px}
.nv-worker-row strong{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.nv-worker-row[data-state=running] .nv-task-dot{background:var(--dsw-alias-state-business-primary)}
.nv-worker-picker{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
@media(max-width:520px){.nv-classroom{padding:14px}.nv-member{grid-template-columns:auto minmax(0,1fr)}.nv-member-state{grid-column:2}}
`;

export function createVaultClassroom(React, { STYLE, IconButton, Dialog, resolveSlotLabel = label => typeof label === 'string' ? label : undefined }) {
  const h = React.createElement;
  const { useState, useEffect, useMemo, useRef } = React;
  // An unsaved model choice survives pane switches, a reload and a CAS conflict;
  // it is a draft, not a setting, so it never becomes classroom state by itself.
  // Drafts are keyed per session AND per preset, so one worker's draft never
  // overwrites another's.
  const drafts = createDraftStore('classroom-worker-draft');
  const presentations = new Map();

  function useClassroom(vault, visible) {
    const [state, setState] = useState({ value: null, loading: true, error: '' });
    const generation = useRef(0);
    // Every 教室 call answers with the same value shape, so a write is rendered
    // straight from its own response instead of a follow-up read that could
    // publish an older snapshot than the write already committed.
    const apply = value => { generation.current++; setState({ value, loading: false, error: '' }); };
    const call = useRef(async () => {});
    call.current = async () => {
      const ticket = ++generation.current;
      try {
        const result = await vault.classroom({});
        if (!result?.ok) throw new Error('read');
        if (ticket === generation.current) setState({ value: result.value, loading: false, error: '' });
      } catch { if (ticket === generation.current) setState(previous => ({ ...previous, loading: false, error: '暂时读不出教室状态，请稍后重试。' })); }
    };
    useEffect(() => {
      if (!visible) return undefined;
      void call.current();
      const timer = setInterval(() => { void call.current(); }, 2500);
      const refresh = () => { void call.current(); };
      window.addEventListener('notara-vault-changed', refresh);
      window.addEventListener('focus', refresh);
      return () => { generation.current++; clearInterval(timer); window.removeEventListener('notara-vault-changed', refresh); window.removeEventListener('focus', refresh); };
    }, [vault, visible]);
    return [state, () => call.current(), apply];
  }

  /** 教室设置: one dialog, one worker at a time; nothing about the student. */
  function WorkerDialog({ sessionId, view, onClose, onSave, onReload, busy, error }) {
    const key = id => workerDraftKey(sessionId, id);
    const workers = view.workers;
    const fresh = id => ({ ...workerDraft(workers.find(row => row.id === id) ?? null, view.models), expectedRevision: view.revision });
    const existing = id => {
      const saved = drafts.get(key(id));
      return saved && Number.isSafeInteger(saved.expectedRevision) ? saved : fresh(id);
    };
    const [presetId, setPresetId] = useState(() => workers[0]?.id ?? '');
    const [draft, setDraft] = useState(() => existing(workers[0]?.id ?? ''));
    const worker = workers.find(row => row.id === presetId) ?? workers[0] ?? null;
    const choose = id => {
      setPresetId(id);
      setDraft(existing(id));
    };
    const edit = next => { setDraft(next); drafts.set(key(presetId), next); };
    // A saved model that this deployment no longer offers must stay visible: the
    // picker shows the real setting instead of pretending it changed.
    const savedRoute = normalizeRoute(worker?.route);
    const savedMissing = !!savedRoute && !!draft.model && !view.models.some(choice => choice.provider === draft.provider && choice.model === draft.model);
    const choiceValue = (choice) => `${choice.provider}\u0000${choice.model}`;
    const selectValue = savedMissing ? '__saved__' : draft.provider && draft.model ? `${draft.provider}\u0000${draft.model}` : '';
    const current = view.models.find(choice => choice.provider === draft.provider && choice.model === draft.model) ?? null;
    const route = draftRoute(draft);
    const submit = async value => {
      // Polling can refresh view.revision while this draft still contains older
      // settings. Only the revision the draft was based on may authorize its save.
      const saved = await onSave({ preset: presetId, tools: draftTools(draft), route: value, expectedRevision: draft.expectedRevision });
      if (saved) setDraft({ ...workerDraft(saved.workers.find(row => row.id === presetId), modelChoices(saved)), expectedRevision: saved.revision });
    };
    return h(Dialog, { title: '教室设置', onClose },
      h('form', { onSubmit: event => { event.preventDefault(); if (route) submit(route); } },
        h('p', { style: { ...STYLE.notice, margin: '4px 0 0' } }, '每位后台工作员各有自己的模型与资料范围。课堂默认显示进度，也可以从任务记录打开完整分析。'),
        h('fieldset', { disabled: busy, style: { border: 0, margin: '14px 0 0', padding: 0 } },
          h('legend', { style: { ...STYLE.notice, padding: 0 } }, '工作员'),
          h('div', { className: 'nv-worker-picker', role: 'group', 'aria-label': '选择工作员' },
            workers.map(row => h('button', {
              key: row.id, type: 'button', style: STYLE.quiet, 'aria-pressed': row.id === presetId,
              onClick: () => choose(row.id),
            }, row.name))),
          worker?.description && h('p', { style: { ...STYLE.notice, marginTop: 8 } }, worker.description)),
        h('fieldset', { disabled: busy, style: { border: 0, margin: '14px 0 0', padding: 0 } },
          h('legend', { style: { ...STYLE.notice, padding: 0 } }, '后台模型'),
          (view.models.length
            ? h(React.Fragment, null,
                h('label', { style: { display: 'block', marginTop: 8 } }, '模型',
                  h('select', { 'aria-label': '后台模型', style: { ...STYLE.templateInput, width: '100%' }, value: selectValue, onChange: event => { if (event.target.value === '') { edit({ ...draft, provider: '', model: '', reasoningEffort: '' }); return; } const [provider, model] = event.target.value.split('\u0000'); const picked = view.models.find(row => row.provider === provider && row.model === model); edit({ ...draft, provider, model, reasoningEffort: preferredSolverEffort(picked?.reasoningEfforts) ?? '' }); } },
                    savedMissing ? h('option', { key: '__saved__', value: '__saved__', disabled: true }, `${savedRoute.model}（已保存，但当前没有接入）`) : null,
                    h('option', { key: '__none__', value: '' }, WORKER_MODEL_PLACEHOLDER),
                    view.models.map(choice => h('option', { key: choiceValue(choice), value: choiceValue(choice) }, choice.model === worker?.preferredModel ? `${choice.label}（默认）` : choice.label)))),
                preferredCandidate(worker, view.models) || savedMissing ? null : h('p', { role: 'status', style: { ...STYLE.notice, marginTop: 8 } }, `当前没有接入 ${worker?.preferredModel || '默认模型'}，可以接入后再用，或明确选择另一个后台模型。`),
                current && current.reasoningEfforts.length > 1 && h('label', { style: { display: 'block', marginTop: 8 } }, '推理等级',
                  h('select', { 'aria-label': '推理等级', style: { ...STYLE.templateInput, width: '100%' }, value: draft.reasoningEffort, onChange: event => edit({ ...draft, reasoningEffort: event.target.value }) },
                    current.reasoningEfforts.map(effort => h('option', { key: effort, value: effort }, effort)))))
            : h('p', { role: 'status', style: { ...STYLE.notice, marginTop: 8 } }, '当前运行环境没有可用的模型，后台分析暂时无法规划。'))),
        h('label', { style: { display: 'block', marginTop: 8 } }, '每次分析的生成上限',
          h('input', { disabled: busy, type: 'number', 'aria-label': '每次分析的生成上限', min: SOLVER_MIN_TOKENS, max: SOLVER_TOKEN_LIMIT, step: 1, required: true, style: { ...STYLE.templateInput, width: '100%' }, value: draft.maxTokens ?? SOLVER_MAX_TOKENS, onChange: event => edit({ ...draft, maxTokens: event.target.value }) })),
        h('p', { style: { ...STYLE.notice, marginTop: 8 } }, '单位为 token，默认 32768。上限不代表实际用量；推理与输出的计数方式取决于所选模型。'),
        h('label', { style: { display: 'block', marginTop: 8 } }, '资料范围',
          h('select', { disabled: busy, 'aria-label': '资料范围', style: { ...STYLE.templateInput, width: '100%' }, value: draftTools(draft), onChange: event => edit({ ...draft, tools: event.target.value }) },
            h('option', { key: 'none', value: 'none' }, workerScopeLabel({ tools: 'none' })),
            h('option', { key: 'read', value: 'read' }, workerScopeLabel({ tools: 'read' })))),
        h('p', { style: { ...STYLE.notice, marginTop: 8 } }, '这里的选择只影响这位工作员，不改变老师使用的模型，也不影响其他工作员。'),
        worker?.reason && h('p', { role: 'status', style: { ...STYLE.notice, marginTop: 8 } }, worker.reason),
        error && h('p', { role: 'alert', style: { ...STYLE.notice, marginTop: 8, color: 'var(--dsw-alias-state-error-primary)' } }, error),
        draft.expectedRevision !== view.revision && h('button', { type: 'button', style: STYLE.quiet, disabled: busy, onClick: () => { drafts.delete(key(presetId)); setDraft(fresh(presetId)); onReload(); } }, '载入最新设置'),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 18 } },
          h('button', { type: 'submit', style: STYLE.quiet, disabled: busy || savedMissing || !route }, busy ? '正在保存…' : '保存'),
          h('button', { type: 'button', style: STYLE.quiet, disabled: busy, onClick: () => submit(null) }, '恢复默认自动匹配'),
          // The shared Dialog already renders its own header 关闭 button, so the
          // footer keeps 取消 to stay a distinct, unambiguous control.
          h('button', { type: 'button', style: STYLE.quiet, onClick: onClose }, '取消'))));
  }

  function ClassroomView(props) {
    const entries = React.useSyncExternalStore(
      React.useCallback(callback => props.ctx.slots.subscribe('notara.classroom.view', callback), [props.ctx.slots]),
      React.useCallback(() => props.ctx.slots.entries('notara.classroom.view'), [props.ctx.slots]),
      () => props.ctx.slots.entries('notara.classroom.view'));
    const [presentation, setPresentation] = useState(() => presentations.get(props.sessionId) ?? 'pixel');
    const activePresentation = entries.some(entry => entry.options.id === presentation) ? presentation : 'list';
    const native = props.useSession(value => value);
    const vault = useMemo(() => createVaultClient(props.ctx, props.sessionId), [props.ctx, props.sessionId]);
    const [state, refresh, apply] = useClassroom(vault, props.visible);
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const [stopping, setStopping] = useState(''), [opening, setOpening] = useState('');
    const view = state.value ? classroomSummary(state.value) : null;
    const rows = state.value ? taskRows(state.value) : [];
    const running = rows.some(row => row.status === 'running');

    const write = async input => {
      if (!view) return;
      setBusy(true); setError(''); setNotice('');
      try {
        const result = await vault.configureSolver(input);
        if (result?.ok) {
          drafts.delete(workerDraftKey(props.sessionId, input.preset));
          setNotice(input.route ? '已保存，下一次后台分析会用这个模型。' : '已恢复默认模型匹配。');
          apply(result.value); return result.value;
        }
        // A CAS conflict keeps the draft: the newest state is re-read, the form stays.
        setError('教室设置已经在别处更新，已读到最新内容；你的选择仍然保留。');
        await refresh();
      } catch { setError('保存失败，你的选择仍然保留在窗口里。'); }
      finally { setBusy(false); }
    };
    // 查看分析: the backend returns the real child binding for this task and the
    // view opens that native child session; the student never reads the report
    // inline, and no second chat is created here.
    const openAnalysis = async row => {
      if (!view || opening) return;
      setOpening(row.id); setError('');
      try {
        const binding = await vault.solverTask({ taskId: row.id });
        const value = binding?.ok ? binding.value : null;
        const child = text(value?.childSessionId), parent = text(value?.parentSessionId);
        if (!child || !parent || parent !== props.sessionId || value?.mode !== 'one-shot') { setError('这次分析没有可查看的记录。'); return; }
        await props.ctx.sessions.refreshSubagents(parent);
        props.ctx.sessions.openSubagent({ parentSessionId: parent, childSessionId: child, mode: 'one-shot' });
      } catch { setError('现在打不开这次分析，请稍后再试。'); }
      finally { setOpening(''); }
    };
    const stop = async row => {
      if (!view || stopping) return;
      setStopping(row.id); setError('');
      try {
        // cancelSolver takes exactly the running task: no revision, no question text.
        const result = await vault.cancelSolver({ taskId: row.id });
        if (!result?.ok) throw new Error('cancel');
        setNotice('已停止这次后台分析。');
        apply(result.value);
      } catch { setError('这次分析没有停下来，请稍后再试。'); }
      finally { setStopping(''); }
    };

    const workerState = worker => {
      const busyRow = rows.find(row => row.status === 'running' && row.preset === worker.id);
      if (busyRow) return { tone: 'run', label: '分析中' };
      if (!worker.ready) return { tone: 'warn', label: '未启用' };
      const route = worker.route;
      const model = route ? view?.models.find(choice => choice.provider === route.provider && choice.model === route.model)?.label ?? route.model : '';
      return { tone: 'idle', label: model ? `待命 · ${model}` : '待命' };
    };
    const snapshot = { version: 1, loading: state.loading && !view, error: state.error, visible: props.visible,
      title: '当前课堂', teacher: view ? { ...view.teacher, active: native?.running === true, error: native?.lastAgentError ? '本轮授课遇到问题，请回到对话查看。' : '' } : null,
      workers: view ? view.workers.map(worker => ({
        id: worker.id, name: worker.name, description: worker.description, ready: worker.ready, tools: worker.tools,
        preferredModel: worker.preferredModel, route: worker.route, reason: worker.reason,
        notice: workerRouteNotice(worker, view.models),
        active: rows.some(row => row.status === 'running' && row.preset === worker.id),
      })) : [],
      tasks: rows.map(row => ({ ...row, time: taskElapsedLabel(state.value?.tasks?.find(task => task.id === row.id)) })), opening, stopping };
    const pickPresentation = id => { presentations.set(props.sessionId, id); setPresentation(id); };
    return h('div', { className: 'nv-classroom', style: { ...STYLE.page, ...(activePresentation !== 'list' ? { padding: 0, gap: 0, overflow: 'hidden' } : {}) } }, h('style', null, CLASSROOM_CSS),
      h('header', { className: 'nv-classroom-head', style: activePresentation !== 'list' ? { padding: '8px 14px' } : undefined },
        h('strong', null, '教室'),
        h('span', { className: 'nv-classroom-note', role: 'status' }, state.loading && !view ? '正在读取…' : running ? '后台任务进行中' : '课堂进行中'),
        entries.length > 0 && h('div', { role: 'group', 'aria-label': '教室视图', style: { display: 'flex', gap: 4 } },
          h('button', { type: 'button', style: STYLE.quiet, 'aria-pressed': activePresentation === 'list', onClick: () => pickPresentation('list') }, '列表'),
          entries.map(entry => h('button', { key: entry.options.id, type: 'button', style: STYLE.quiet, 'aria-pressed': activePresentation === entry.options.id, onClick: () => pickPresentation(entry.options.id) }, resolveSlotLabel(entry.options.label) ?? entry.options.id))),
        h(IconButton, { icon: 'sliders', label: '教室设置', disabled: !view, onClick: () => setOpen(true) })),
      state.error && h('p', { role: 'alert', className: 'nv-classroom-error' }, state.error),
      notice && h('p', { role: 'status', style: { ...STYLE.notice, margin: 0 } }, notice),
      activePresentation !== 'list' && h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } }, props.renderSlot('notara.classroom.view', {
        snapshot, onInspect: id => { const row = rows.find(task => task.id === id); if (row?.inspectable) void openAnalysis(row); },
        onCancel: id => { const row = rows.find(task => task.id === id); if (row?.cancelable) void stop(row); },
        onRefresh: refresh, onConfigure: () => setOpen(true),
      }, { only: activePresentation })),
      activePresentation === 'list' && view && h(React.Fragment, null, h('div', { className: 'nv-members' },
        h('div', { className: 'nv-member' },
          h('span', { className: 'nv-member-role' }, '老师'),
          h('div', null, h('strong', null, view.teacher.name || '老师'), view.teacher.description && h('p', null, view.teacher.description)),
          h('span', { className: 'nv-member-state' }, '在课堂上')),
        view.workers.map(worker => h('div', { className: 'nv-member', key: worker.id },
          h('span', { className: 'nv-member-role' }, '后台'),
          h('div', null, h('strong', null, worker.name), worker.description && h('p', null, worker.description),
            h('p', { 'data-scope': worker.tools }, workerScopeLabel(worker))),
          h('span', { className: 'nv-member-state', 'data-tone': workerState(worker).tone }, workerState(worker).label))))),
      activePresentation === 'list' && view && h('section', { className: 'nv-lane', 'aria-label': '后台任务' },
        h('div', { className: 'nv-lane-head' }, h('span', null, '后台任务'),
          h(IconButton, { icon: 'refresh', label: '刷新后台任务', onClick: () => { void refresh(); } })),
        rows.length
          ? h('ul', { className: 'nv-tasks' }, rows.map(row => h('li', { className: 'nv-task', key: row.id, 'data-tone': row.tone, 'data-preset': row.preset || undefined },
              h('span', { className: 'nv-task-dot', 'aria-hidden': true }),
              h('span', null, `${row.name} · ${row.label}`),
              showsInspectAction(row) && h('button', { type: 'button', style: STYLE.quiet, disabled: !!opening, onClick: () => { void openAnalysis(row); } }, opening === row.id ? '正在打开…' : '查看分析（含完整解法）'),
              row.cancelable && h('button', { type: 'button', style: STYLE.quiet, disabled: !!stopping, onClick: () => { void stop(row); } }, stopping === row.id ? '正在停止…' : '停止'),
              h('span', { className: 'nv-task-time' }, taskElapsedLabel(state.value?.tasks?.find(task => task.id === row.id))))))
          : h('p', { className: 'nv-classroom-empty' }, '还没有后台任务。课堂上需要独立分析时，老师会把它交给后台，这里只显示进度。')),
      open && view && h(WorkerDialog, { sessionId: props.sessionId, view, busy, error, onClose: () => setOpen(false), onReload: () => setError(''), onSave: write }));
  }

  /**
   * The teaching preset's own background lane: its raw arguments and its raw
   * analysis are teacher-only material, so the student row is a fixed status
   * line plus the trusted preset name even while the call is still streaming.
   * Both `ask_worker` and the retired `ask_solver` render through it, so an older
   * classroom's transcript still reads as a status row.
   */
  function WorkerToolRow({ toolName, block }) {
    const row = workerRowProjection(block);
    return h('div', { className: 'nv-worker-row', 'data-tool': toolName, 'data-state': row.state },
      h('span', { className: 'nv-task-dot', 'aria-hidden': true }),
      h('strong', null, row.name),
      h('span', null, row.text));
  }

  return { ClassroomView, WorkerToolRow, SolverToolRow: WorkerToolRow };
}
