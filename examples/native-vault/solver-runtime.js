import { pluginEventType } from './plugin-events.js';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { appendTeachingEvent, readTeachingSettings } from './teaching-state.js';
import { teachingResource, teachingManifest } from './teaching-catalog.js';
import { WORKER_PRESETS, WORKER_TOOLS, workerPreset } from './worker-catalog.js';
import { readWorkerDefaults, workerDefaultsPath, writeWorkerDefault } from './worker-defaults.js';
import { SOLVER_MAX_TOKENS, validSolverBudget } from './solver-policy.js';
import { SOLVER_SOURCE_LIMIT, solverSources, solverSourceBlocks } from './solver-sources.js';
import { PERSONA_TEXT_LIMIT, personaText, workerPersona } from './persona.js';
import { activeUserSkills } from './user-skills.js';
import { resolveVaultRoot } from './vault.js';
import { CHATGPT_AUTHENTICATED_EVENT } from './chatgpt-contract.js';

const workerSkills = [...teachingManifest.choices, ...teachingManifest.skills.filter(item => item.id.startsWith('subject-'))];
const LIMITS = Object.freeze({ problem: 18000, focus: 4000, title: 200, excerpt: 12000, materials: 24000, items: 12 });
const CONFIG_EVENT = 'notara/worker-settings', TASK_EVENT = 'notara/worker-task';
/** Workers one classroom may run at the same time, background or not. */
export const WORKER_CONCURRENCY = 5;
const guidance = {
  solver_canceled: '本次后台任务已停止，没有完整结果；不要自动重新派工，等待用户的新输入。',
  solver_paused: '本轮任务已被停止；保留清单与已完成产物，等用户新输入后再继续。',
  solver_busy: `本课堂已有${WORKER_CONCURRENCY}个工作员任务在运行，等其中一个返回后再安排下一项，不循环重试。`,
  solver_background_unavailable: '当前课堂不能在后台运行工作员，本次未启动任务；改为不带 run_in_background 的同步调用，或说明暂时无法后台处理。',
  solver_analysis_empty: '后台任务未交付正文；不视为研究或核验完成，说明缺口后再决定下一步。',
};
const fail = code => { throw new Error(guidance[code] ? `${code}: ${guidance[code]}` : code); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
/**
 * The provider's own failure text for a child that ended on an error. Remote
 * providers fill `diagnostic`; the in-process spawn leaves it empty, and the
 * reason is the child's last `turn/end` (the LLM error's code and message,
 * which DSH keeps free of credentials).
 */
function childFailureDetail(run, result) {
  if (typeof result?.diagnostic === 'string' && result.diagnostic.trim()) return result.diagnostic;
  try {
    const end = run?.localAgent?.session?.snapshotEvents().findLast(event => event.type === 'turn/end');
    const error = end?.data?.reason?.kind === 'error' ? end.data.reason.error : undefined;
    return typeof error?.message === 'string' ? `${typeof error.code === 'string' ? error.code + ' ' : ''}${error.message}` : '';
  } catch { return ''; }
}

/** Prefer the child's structured failure code; remote diagnostics retain a code prefix. */
function childFailureCode(run, result) {
  try {
    const end = run?.localAgent?.session?.snapshotEvents().findLast(event => event.type === 'turn/end');
    const error = end?.data?.reason?.kind === 'error' ? end.data.reason.error : undefined;
    if (typeof error?.code === 'string') return error.code;
  } catch { /* Remote children may expose only the diagnostic text. */ }
  return /^([A-Z][A-Z0-9_-]+)(?::|\s|$)/.exec(result?.diagnostic ?? '')?.[1];
}
const authenticationFailure = (run, result) => ['AUTH', 'MISSING_CREDENTIAL', 'INVALID_CREDENTIAL'].includes(childFailureCode(run, result));
/**
 * Name why a child run ended early. A route that cannot be called at all fails
 * every retry the same way, so it is reported as a model problem the student
 * fixes in the classroom settings, not as a failed analysis.
 */
export function workerFailure(result, preset, run) {
  const detail = childFailureDetail(run, result).replace(/\s+/g, ' ').trim().slice(0, 300);
  if (authenticationFailure(run, result)) return `solver_model_unavailable: ${preset.name}的模型账号需要重新登录或检查凭据（${detail}）。请告诉学生到设置中修复登录或凭据；不要原样重试，也不要换别的预设重试。`;
  if (/not configured|missing_credential|credential|api[ _-]?key|unauthori[sz]ed|\b40[13]\b/i.test(detail)) return `solver_model_unavailable: ${preset.name}的模型调用不了（${detail}）。这是模型配置问题：请告诉学生到教室设置为${preset.name}选一个已配置的模型；不要原样重试，也不要换别的预设重试，同一路由都会失败。`;
  return detail ? `solver_analysis_failed: ${preset.name}没有完成（${detail}）。` : 'solver_analysis_failed';
}
const latestInput = session => session.snapshotEvents().filter(event => event.seq >= (session.inheritedEventCount ?? 0) && event.type === 'user/message' && event.data.source?.kind === 'user').at(-1)?.data.id ?? null;
function invalid(field, expected) {
  fail(`solver_input_invalid: ${field} ${expected}；修正该字段后再提交，本次未启动任务。`);
}
function exact(value, keys, field = 'arguments') {
  // The native loop deliberately preserves malformed model JSON as a string.
  // Diagnose that boundary without quoting private material or guessing repairs.
  if (typeof value === 'string') {
    try { JSON.parse(value); } catch {
      invalid(field, '不是合法 JSON；请正确转义正文中的双引号、反斜杠和换行，保留题目原意');
    }
    invalid(field, '必须直接传对象，不要再次 JSON 编码成字符串');
  }
  if (!record(value)) invalid(field, '必须是对象');
  if (Object.keys(value).some(key => !keys.includes(key))) invalid(field, `只接受 ${keys.join(', ')}，不要增加 arguments 包装层`);
}
function text(value, max, required = true, field = 'goal') {
  if (!required && value === undefined) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(field, `必须是1到${max}字符的非空文本`);
  return value.trim();
}
function requirePreset(value) {
  const preset = workerPreset(value);
  if (!preset) invalid('preset', `只接受 ${WORKER_PRESETS.map(item => item.id).join(', ')}`);
  return preset;
}
/** Built-in teaching and subject skills, plus the skills the student adopted for this classroom. */
function selectedSkills(value = [], adopted = []) {
  if (!Array.isArray(value) || value.length > 4) invalid('skills', '必须是至多4个已公布教法、学科或已启用的学习集/学科层 Skill 名的数组');
  const offered = [
    ...workerSkills.map(item => ({ name: `notara-${item.id}`, id: item.id, text: () => teachingResource(item.file) })),
    ...adopted.map(row => ({ name: row.name, id: row.name.slice('notara-'.length), text: () => row.body })),
  ];
  return [...new Set(value)].map(name => {
    const skill = offered.find(item => item.name === name);
    if (!skill) invalid('skills', `只接受 ${offered.map(item => item.name).join(', ')}；学生尚未启用的 Skill 不能交给工作员`);
    return skill;
  });
}
/** 角色任务正文：共同规则、该预设角色与按需原则。独立人格另由 persona.js 拼在它之后。 */
function workerRole(preset, skills) {
  return [teachingResource('workers/base.md'), teachingResource(`workers/${preset.id}.md`),
    ...skills.map(item => `## 按需原则 ${item.name}\n\n${item.text()}`)].join('\n\n');
}

/** 一个 preset 真实生效的设置：它自己的 route/tools/persona；缺省沿用旧事件里的教室默认。 */
/** A shared default read from disk is trusted only in the shape configure writes. */
function sharedSettings(value) {
  if (!record(value)) return undefined;
  const route = record(value.route) && typeof value.route.provider === 'string' && typeof value.route.model === 'string' ? value.route : null;
  return { route, tools: Object.hasOwn(WORKER_TOOLS, value.tools ?? '') ? value.tools : 'none', persona: value.persona };
}
/**
 * The settings in force for one worker: this lesson's own override, then an old
 * lesson-wide solver route, then the machine-wide default, then nothing saved
 * (follow the teacher's model, deliver materials only).
 */
function workerSettings(state, presetId, defaults) {
  const lesson = state.settings[presetId], legacy = state.route ? { route: state.route, tools: 'none' } : undefined, shared = sharedSettings(defaults?.presets?.[presetId]);
  const saved = lesson ?? legacy ?? shared ?? { route: null, tools: 'none' };
  return { route: saved.route ?? null, tools: saved.tools ?? 'none', persona: personaText(saved.persona), scope: lesson || legacy ? 'lesson' : shared ? 'default' : 'none' };
}
/** The model the teacher's current request runs on: the session's latest request header. */
export function teacherRoute(agent) {
  const events = agent?.session?.snapshotEvents?.() ?? [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const config = events[index].type === 'request/header' ? events[index].data?.header?.config : undefined;
    if (typeof config?.provider === 'string' && typeof config?.model === 'string') return { provider: config.provider, model: config.model, ...(typeof config.reasoningEffort === 'string' ? { reasoningEffort: config.reasoningEffort } : {}) };
  }
  return null;
}
const routeKey = route => `${route.provider}\u0000${route.model}`;
export function solverState(session) {
  let revision = 0, route = null;
  const tasks = new Map(), settings = {};
  for (const event of session.snapshotEvents()) {
    if (event.seq < (session.inheritedEventCount ?? 0)) continue;
    // Read old settings and task records without rewriting private session history.
    const type = pluginEventType(event.type);
    if (type === 'notara/solver-settings') { revision = Math.max(revision, event.data.revision); route = event.data.route; }
    if (type === CONFIG_EVENT) {
      revision = Math.max(revision, event.data.revision);
      // An inherit record drops this lesson's override: the shared default applies again.
      if (event.data.inherit === true) delete settings[event.data.preset];
      else settings[event.data.preset] = { route: event.data.route, tools: event.data.tools, persona: event.data.persona };
    }
    if ([TASK_EVENT, 'notara/solver-task'].includes(type)) tasks.set(event.data.id, { ...tasks.get(event.data.id), ...event.data });
  }
  return { revision, route, settings, tasks: [...tasks.values()] };
}

/** Native one-shot spawn owns execution; teaching owns presets, settings and receipts.
 * Internal service/RPC names stay stable for existing classroom callers. */
/** The worker's first message, which the student also sees in its record:
 * the task alone. The role is in its system prompt; a read worker runs in the
 * lesson's folder and learns only where the Vault starts inside it. */
function workerTask({ goal, focus, materials, tools, cwd }) {
  const folder = tools === 'read' && cwd && resolve(resolveVaultRoot(cwd)) !== resolve(cwd) ? 'vault/' : '';
  return JSON.stringify({ goal, focus, materials, capabilities: tools, ...(folder ? { materialsRoot: folder } : {}) });
}

export class NotaraSolver {
  constructor(ctx, teaching, { defaultsPath = workerDefaultsPath() } = {}) {
    this.ctx = ctx; this.teaching = teaching; this.active = new Map(); this.catalog = null; this.defaultsPath = defaultsPath;
    // Routes a worker could not call at all (no credential, refused). Cleared on the next save of any worker setting.
    this.unavailable = new Map();
    this.authenticationFailures = new Set();
    this.authenticationGenerations = new Map();
    ctx.on?.('llm/adapters-updated', () => { this.catalog = null; });
    ctx.on?.(CHATGPT_AUTHENTICATED_EVENT, provider => this.providerAuthenticated(provider));
  }
  /** Successful reauthentication releases only that account's authentication failures. */
  providerAuthenticated(provider) {
    if (typeof provider !== 'string' || !provider.startsWith('notara-chatgpt-')) return;
    this.authenticationGenerations.set(provider, (this.authenticationGenerations.get(provider) ?? 0) + 1);
    this.catalog = null;
    for (const key of this.authenticationFailures) {
      if (!key.startsWith(`${provider}\u0000`)) continue;
      this.authenticationFailures.delete(key); this.unavailable.delete(key);
    }
  }
  async defaults() { return readWorkerDefaults(this.defaultsPath); }
  assertTeacher(agent) {
    if (!this.teaching.isTeaching(agent) || agent.session.header.origin === 'subagent') fail('solver_teacher_required');
  }
  async parent(sessionId) { const agent = await this.teaching.agentFor(sessionId); this.assertTeacher(agent); return agent; }
  async models(fresh = false) {
    if (!fresh && this.catalog && Date.now() - this.catalog.time < 30000) return this.catalog.rows;
    const llm = this.ctx.get('llm'), rows = [];
    for (const provider of llm?.listProviders() ?? []) {
      let models; try { models = await llm.listModels(provider.id); } catch { continue; }
      for (const model of models) {
        let info; try { info = await llm.resolveModelInfo(provider.id, model.id); } catch { continue; }
        rows.push({ provider: provider.id, model: model.id, label: `${model.name ?? model.id} · ${provider.name ?? provider.id}`, reasoningEfforts: (info?.reasoning?.efforts ?? []).map(item => String(item.id)) });
      }
    }
    this.catalog = { time: Date.now(), rows }; return rows;
  }
  /** The route one worker runs on: its saved model when that is still offered, otherwise the teacher's. */
  pick(settings, models, teacher = null) {
    if (settings.route) {
      const found = models.find(row => row.provider === settings.route.provider && row.model === settings.route.model);
      return found && (!settings.route.reasoningEffort || found.reasoningEfforts.includes(settings.route.reasoningEffort)) ? settings.route : null;
    }
    return teacher;
  }
  unavailableReason(settings, models, mark) {
    if (mark) return `模型调不通：${mark}。请在教室设置里为这位工作员换一个能用的模型。`;
    const route = settings.route, model = route && models.find(row => row.provider === route.provider && row.model === route.model);
    return model && route.reasoningEffort && !model.reasoningEfforts.includes(route.reasoningEffort)
      ? '所选模型不支持已保存的推理等级；请在教室设置中重新选择推理等级。'
      : '已保存的模型现在不在可用的模型里；请在教室设置中重新选择。';
  }
  async read({ sessionId }) {
    const agent = await this.parent(sessionId), state = solverState(agent.session), models = await this.models(), defaults = await this.defaults(), teacher = teacherRoute(agent);
    return { revision: state.revision, defaultsRevision: this.defaultsPath ? defaults.revision : null,
      // A persona written in 教学设置 replaces the default character, so the card
      // stops naming it; the free text is not mined for a name.
      teacher: personaText(readTeachingSettings(agent.session).persona)
        ? { name: '本课老师', description: '按这节课教学设置里写的人格上课。' }
        : { name: '大肥鱼', description: '爱吃白饭的鲸鱼娘女仆，陪你理清思路、一步步学会。' },
      // The teacher's model is only known once the lesson has sent a request.
      teacherRoute: teacher ? { ...teacher, label: models.find(row => row.provider === teacher.provider && row.model === teacher.model)?.label ?? teacher.model } : null,
      workers: WORKER_PRESETS.map(preset => {
        const settings = workerSettings(state, preset.id, defaults), route = this.pick(settings, models, teacher);
        const effective = settings.route ?? teacher, mark = effective ? this.unavailable.get(routeKey(effective)) : undefined;
        const ready = !mark && (settings.route ? !!route : true);
        return { ...preset, route: settings.route, follow: !settings.route, scope: settings.scope, tools: settings.tools, persona: settings.persona, ready,
          ...(!ready ? { reason: this.unavailableReason(settings, models, mark) } : {}) };
      }), models,
      tasks: state.tasks.slice(-20).reverse().map(task => {
        const preset = workerPreset(task.preset) ?? workerPreset('problem');
        return { id: task.id, preset: preset.id, name: task.preset ? preset.name : '解题者', status: task.status === 'running' && !this.active.has(task.id) ? 'interrupted' : task.status, inspectable: !!task.childId, startedAt: task.startedAt, ...(task.finishedAt ? { finishedAt: task.finishedAt } : {}), ...(task.status === 'failed' && task.failureCode ? { failureCode: task.failureCode } : {}) };
      }),
    };
  }
  /**
   * Save one worker's settings. `scope: 'default'` writes the machine-wide default
   * (every lesson without its own override uses it); `scope: 'lesson'` overrides
   * this lesson only. `inherit: true` clears that level: the lesson falls back to
   * the default, the default falls back to following the teacher.
   */
  async configure({ sessionId, expectedRevision, route, preset, tools, persona, scope = 'lesson', inherit = false }) {
    const agent = await this.parent(sessionId);
    if (!['lesson', 'default'].includes(scope)) invalid('scope', '只接受 lesson（只改本课）或 default（所有课堂的默认）');
    if (typeof inherit !== 'boolean') invalid('inherit', '只接受 true 或 false');
    requirePreset(preset);
    if (scope === 'default') {
      if (!this.defaultsPath) fail('solver_defaults_unavailable');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (await this.defaults()).revision) fail('solver_settings_conflict');
    } else if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== solverState(agent.session).revision) fail('solver_settings_conflict');
    if (inherit) {
      if (scope === 'default') await writeWorkerDefault(this.defaultsPath, expectedRevision, preset, null);
      else {
        if (expectedRevision !== solverState(agent.session).revision) fail('solver_settings_conflict');
        appendTeachingEvent(agent.session, CONFIG_EVENT, { revision: expectedRevision + 1, preset, inherit: true });
        await this.teaching.flush(agent.session);
      }
      this.unavailable.clear();
      this.authenticationFailures.clear();
      return this.read({ sessionId });
    }
    if (!Object.hasOwn(WORKER_TOOLS, tools ?? '')) invalid('tools', '只接受 none（交付材料）或 read（原生读取、搜索与看图）');
    if (persona !== undefined && (typeof persona !== 'string' || persona.length > PERSONA_TEXT_LIMIT)) invalid('persona', `必须是至多${PERSONA_TEXT_LIMIT}字的文本，留空只用这位工作员的角色职责`);
    let next = null;
    if (route !== null) {
      exact(route, ['provider', 'model', 'reasoningEffort', 'maxTokens'], 'route');
      if (route.maxTokens !== undefined && !validSolverBudget(route.maxTokens)) fail('solver_budget_invalid: maxTokens 需为1024到131072之间的整数，请在教室设置中调整。');
      next = { provider: text(route.provider, 200, true, 'route.provider'), model: text(route.model, 200, true, 'route.model'), ...(route.reasoningEffort !== undefined ? { reasoningEffort: text(route.reasoningEffort, 100, true, 'route.reasoningEffort') } : {}), ...(route.maxTokens !== undefined ? { maxTokens: route.maxTokens } : {}) };
      if (!this.pick({ route: next }, await this.models(true))) fail('solver_model_unavailable');
    }
    // A save is the student acting on the settings: earlier "cannot be called" marks no longer hold.
    this.unavailable.clear();
    this.authenticationFailures.clear();
    if (scope === 'default') {
      // 只改模型或资料范围时不传 persona 就保持原来的人格；传空串才是回到「只用任务角色」。
      const shared = sharedSettings((await this.defaults()).presets[preset]);
      await writeWorkerDefault(this.defaultsPath, expectedRevision, preset, { route: next, tools, persona: persona === undefined ? personaText(shared?.persona) : personaText(persona) });
      return this.read({ sessionId });
    }
    // Catalog discovery may await I/O; recheck CAS immediately before append.
    const current = solverState(agent.session);
    if (expectedRevision !== current.revision) fail('solver_settings_conflict');
    appendTeachingEvent(agent.session, CONFIG_EVENT, { revision: expectedRevision + 1, preset, route: next, tools, persona: persona === undefined ? personaText(current.settings[preset]?.persona) : personaText(persona) });
    await this.teaching.flush(agent.session); return this.read({ sessionId });
  }
  async writeTask(session, data) { appendTeachingEvent(session, TASK_EVENT, data); await this.teaching.flush(session); }
  async task({ sessionId, taskId }) {
    const agent = await this.parent(sessionId), task = solverState(agent.session).tasks.find(row => row.id === taskId);
    if (!task) fail('solver_task_not_found');
    if (!task.childId) fail('solver_task_unavailable');
    const children = await this.ctx.subagents.listChildren(agent.session.id);
    // DSH 0.2.0 lists catalog entries ({id, createdAt, mode, label}); every entry is a direct child.
    if (!children.some(child => child.id === task.childId && child.mode === 'one-shot')) fail('solver_task_unavailable');
    return { parentSessionId: agent.session.id, childSessionId: task.childId, mode: 'one-shot', status: task.status };
  }
  async cancel({ sessionId, taskId }) {
    const agent = await this.parent(sessionId), task = solverState(agent.session).tasks.find(row => row.id === taskId);
    if (!task) fail('solver_task_not_found');
    if (task.status === 'running') {
      await this.writeTask(agent.session, { id: task.id, status: 'canceled', finishedAt: new Date().toISOString() });
      const active = this.active.get(task.id);
      active?.controller.abort();
      if (active?.run) await active.run.dispose();
    }
    return this.read({ sessionId });
  }
  async cancelAll(session) {
    for (const task of solverState(session).tasks.filter(row => row.status === 'running')) await this.cancel({ sessionId: session.id, taskId: task.id });
  }
  async ask(args, exec) {
    this.assertTeacher(exec.agent);
    exact(args, ['preset', 'goal', 'focus', 'materials', 'sources', 'skills', 'run_in_background']);
    if (args.run_in_background !== undefined && typeof args.run_in_background !== 'boolean') invalid('run_in_background', '只接受 true 或 false');
    const background = args.run_in_background === true;
    const sources = solverSources(args.sources);
    const preset = requirePreset(args.preset);
    const skills = selectedSkills(args.skills, args.skills?.some?.(name => /^notara-(set|global)-/.test(name)) ? await activeUserSkills({ cwd: exec.agent.session.header.cwd }) : []);
    const goal = text(args.goal, LIMITS.problem), focus = text(args.focus, LIMITS.focus, false, 'focus');
    if (args.materials !== undefined && (!Array.isArray(args.materials) || args.materials.length > LIMITS.items)) invalid('materials', `必须是至多${LIMITS.items}项的数组，每项为 {title, text}`);
    const materials = (args.materials ?? []).map((item, index) => { const field = `materials[${index}]`; exact(item, ['title', 'text'], field); return { title: text(item.title, LIMITS.title, true, `${field}.title`), text: text(item.text, LIMITS.excerpt, true, `${field}.text`) }; });
    if (materials.reduce((sum, item) => sum + item.title.length + item.text.length, 0) > LIMITS.materials) fail(`solver_materials_budget_exceeded: materials 标题与正文总长不能超过 ${LIMITS.materials} 字符，请缩短材料片段`);
    if (!exec.callId) fail('solver_operation_required');
    const session = exec.agent.session, id = createHash('sha256').update(`${session.id}\0${exec.callId}`).digest('hex').slice(0, 24);
    const prior = solverState(session).tasks, inputId = latestInput(session);
    if (prior.some(row => row.id === id)) fail('solver_task_already_finished');
    if (prior.some(row => row.status === 'canceled' && row.inputId === inputId)) fail('solver_paused');
    if ([...this.active.values()].filter(row => row.sessionId === session.id).length >= WORKER_CONCURRENCY) fail('solver_busy');
    const jobs = background ? this.ctx.get('jobs') : null;
    if (background && !jobs) fail('solver_background_unavailable');
    // Reserve the slot before the first await so concurrent calls count it.
    const controller = new AbortController(), active = { sessionId: session.id, controller, run: null };
    this.active.set(id, active);
    // A background worker outlives the teacher's turn: only its own job may stop it.
    const signal = !background && exec.signal ? AbortSignal.any([exec.signal, controller.signal]) : controller.signal;
    let plan;
    try {
      const state = solverState(session), settings = workerSettings(state, preset.id, await this.defaults());
      const models = await this.models(true), route = this.pick(settings, models, teacherRoute(exec.agent));
      if (!route) fail(`solver_model_unavailable: 尚未启动${preset.name}。${this.unavailableReason(settings, models)}保留清单，不在主课堂接管整批任务，也不要原样重试。`);
      const mark = this.unavailable.get(routeKey(route));
      if (mark) fail(`solver_model_unavailable: 尚未启动${preset.name}：它的模型上次就调用不了（${mark}）。请告诉学生到教室设置为${preset.name}选一个能用的模型；不要原样重试，也不要换别的预设重试。`);
      const runRoute = { ...route, maxTokens: route.maxTokens ?? SOLVER_MAX_TOKENS };
      // Block only an identical, already exhausted attempt under the same user
      // intent and effective route. A narrower task, explicit new user input,
      // or a changed configured budget remains a legitimate new attempt.
      const persona = workerPersona(workerRole(preset, skills), settings.persona);
      const requestKey = createHash('sha256').update(JSON.stringify({ preset: preset.id, goal, focus, materials, sources, skills: skills.map(item => item.id), tools: settings.tools, persona,
        route: { provider: runRoute.provider, model: runRoute.model, reasoningEffort: runRoute.reasoningEffort ?? null, maxTokens: runRoute.maxTokens },
      })).digest('hex');
      if (prior.some(row => row.inputId === inputId && row.requestKey === requestKey && row.failureCode === 'solver_budget_exhausted')) {
        fail('solver_retry_unchanged: 本轮相同范围与预算的研究已耗尽；未启动新任务。请缩小到一个具体疑点，或等待用户调整教室设置/明确重试，不要只换调用编号。');
      }
      signal.throwIfAborted();
      plan = { id, session, exec, signal, controller, active, preset, settings, runRoute, route, persona, requestKey, inputId, goal, focus, materials, sources };
    } catch (error) {
      controller.abort(); this.active.delete(id);
      throw error;
    }
    if (!background) return this.execute(plan);
    let launched = false;
    try {
      const jobId = jobs.start({ kind: 'subagent', label: `${preset.name}：${goal.slice(0, 60)}`, owner: exec.agent.session.id, run: () => (launched = true, {
        cancel: () => controller.abort(),
        done: this.execute(plan).then(
          value => ({ status: 'completed', result: JSON.stringify(value) }),
          error => {
            const code = /^[a-z_]+/.exec(error.message)?.[0] ?? 'solver_analysis_failed', canceled = code === 'solver_canceled';
            return { status: canceled ? 'killed' : 'failed', detail: code, result: JSON.stringify({ taskId: id, preset: preset.id, status: canceled ? 'canceled' : 'failed', error: error.message }) };
          }),
      }) });
      return { taskId: id, preset: preset.id, status: 'running', jobId };
    } catch (error) {
      // A refused registration never reached run(): nothing was recorded or spawned.
      if (launched) throw error;
      controller.abort(); this.active.delete(id);
      throw new Error(`solver_background_unavailable: ${guidance.solver_background_unavailable}`, { cause: error });
    }
  }
  /** Record, spawn and settle one prepared worker; the caller already reserved its slot. */
  async execute({ id, session, exec, signal, controller, active, preset, settings, runRoute, route, persona, requestKey, inputId, goal, focus, materials, sources }) {
    let started = false, accountFailure = false;
    // A late failure from an older login cannot block the newly authenticated account.
    const authenticationGeneration = this.authenticationGenerations.get(runRoute.provider) ?? 0;
    try {
      await this.writeTask(session, { id, status: 'running', preset: preset.id, tools: settings.tools, route: runRoute, inputId, requestKey, startedAt: new Date().toISOString() }); started = true;
      const evidence = await solverSourceBlocks(this.ctx, { ...exec, signal }, route, sources);
      signal.throwIfAborted();
      active.run = await this.ctx.subagents.start('spawn', { parent: exec.agent, signal, label: preset.name,
        agentOptions: runRoute, maxDepth: 1, toolFilter: { allow: [...WORKER_TOOLS[settings.tools]] }, persona,
        prompt: [{ type: 'text', text: workerTask({ goal, focus, materials, tools: settings.tools, cwd: session.header.cwd }) }, ...evidence],
      });
      await this.writeTask(session, { id, childId: active.run.id });
      const result = await active.run.result;
      if (signal.aborted || solverState(session).tasks.find(row => row.id === id)?.status === 'canceled') fail('solver_canceled');
      if (result.stopReason === 'max-tokens') fail(`solver_budget_exhausted: ${preset.name} 未在本次 ${runRoute.maxTokens} token 生成上限内完成，没有可交付的完整结果。请缩小任务或定位具体疑点，不原样重试；如需调整上限，由用户在教室设置中决定。`);
      if (result.stopReason !== 'completed') { accountFailure = authenticationFailure(active.run, result); fail(workerFailure(result, preset, active.run)); }
      const analysis = result.output.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
      if (!analysis) fail('solver_analysis_empty');
      try { await active.run.dispose(); active.run = null; } catch (error) { throw new Error('solver_cleanup_failed', { cause: error }); }
      if (signal.aborted || solverState(session).tasks.find(row => row.id === id)?.status === 'canceled') fail('solver_canceled');
      await this.writeTask(session, { id, status: 'completed', finishedAt: new Date().toISOString() });
      return { taskId: id, preset: preset.id, status: 'completed', analysis };
    } catch (error) {
      const canceled = signal.aborted || solverState(session).tasks.find(row => row.id === id)?.status === 'canceled';
      if (started && solverState(session).tasks.find(row => row.id === id)?.status === 'running') await this.writeTask(session, { id, status: canceled ? 'canceled' : 'failed', failureCode: canceled ? 'solver_canceled' : /^(?:solver_|vault_|pdf_)[a-z_]+/.exec(error.message)?.[0] ?? 'solver_analysis_failed', finishedAt: new Date().toISOString() });
      if (canceled) fail('solver_canceled');
      // The provider refused the route itself: remember it so the next dispatch fails fast and the classroom says why.
      if (/^solver_model_unavailable/.test(error.message) && (!accountFailure || authenticationGeneration === (this.authenticationGenerations.get(runRoute.provider) ?? 0))) {
        const key = routeKey(runRoute);
        this.unavailable.set(key, /（([^）]{1,300})）/.exec(error.message)?.[1] ?? '提供方拒绝了请求');
        if (accountFailure) this.authenticationFailures.add(key); else this.authenticationFailures.delete(key);
      }
      if (/^(solver_|vault_|pdf_)/.test(error.message)) throw error;
      throw new Error('solver_analysis_failed', { cause: error });
    } finally {
      // Cleanup failures must not override the recorded domain outcome. A failed
      // successful-path dispose above already records a failed task and receipt.
      controller.abort();
      try { await active.run?.dispose(); } catch { /* keep the original failure */ } finally { this.active.delete(id); }
    }
  }
}

export function installSolver(ctx, teaching) {
  const service = new NotaraSolver(ctx, teaching);
  ctx.effect(() => ctx.tools.register({ name: 'ask_worker', description: '安排一个独立上下文的知识研究、题目研究、备课、出题、核验或资料任务；各预设职责见preset。知识型课本由general独立研究完整知识单元，题目由problem处理。主教师负责范围确认、总框架、知识联系与父节点归纳、审阅和正式写回，不预先完成整批研究。按需调用一种预设，不固定串行全部角色。子任务不继承父历史，工具/模型/预算取教室配置；未配置时保留清单，失败精确返工，不原样重复耗尽任务。',
    parameters: { type: 'object', additionalProperties: false, required: ['preset', 'goal'], properties: {
      preset: { type: 'string', enum: WORKER_PRESETS.map(item => item.id), description: WORKER_PRESETS.map(item => `${item.id}：${item.name}，${item.description}`).join('；') },
      goal: { type: 'string', minLength: 1, maxLength: LIMITS.problem, description: '明确本次范围、要求和完成标准。知识单元给完整原文与必要上下文，要求研究动机、定义条件、先修依赖、解释及边界；题卡给完整题目/原解。上述材料可通过materials或sources提供，启用读取模式也可给真实位置与范围。纯检索说明需要的证据，不强造卡片；课时给目标、先修、前后课衔接与时长；核验给实际产物与指定疑点；出题给考查目标、母题/已学范围、数量与时长。缺材料返回缺口。直接传参数对象，不重复JSON编码或套arguments层。' },
      focus: { type: 'string', minLength: 1, maxLength: LIMITS.focus, description: '本次分析的重点，例如核验某步、比较方法、拆成教学小问题。' },
      materials: { type: 'array', maxItems: LIMITS.items, description: `当前任务所需的原文、实际草稿、学生原话或相邻课要求；标题与正文总长最多 ${LIMITS.materials} 字符。区分原文、猜测和待核对结论，不能通过摘要消除未决状态；仅处理交付材料时不能只给路径。`, items: { type: 'object', additionalProperties: false, required: ['title', 'text'], properties: { title: { type: 'string', minLength: 1, maxLength: LIMITS.title, description: '来源及性质，如原文参考答案、学生实际作答、待核对分析。' }, text: { type: 'string', minLength: 1, maxLength: LIMITS.excerpt, description: '必要原文、实际草稿或学生原话，保留来源与不确定性；不复制完整父历史。' } } } },
      sources: { type: 'array', maxItems: SOLVER_SOURCE_LIMIT, description: '可选原页图像证据。照抄pdf-page返回的embed（![[媒体/讲义.pdf#page=1&revision=真实版本]]），保留真实物理页、区域和revision；最多4处，跨页要带齐。Host重新核对文件版本并传图，读取权限另由教室设置决定。没有PDF时省略；不能只给路径，也不能自己编版本。', items: { type: 'string', minLength: 1, maxLength: 4000 } },
      skills: { type: 'array', maxItems: 4, items: { type: 'string', minLength: 1, maxLength: 80, pattern: '^notara-[a-z0-9-]+$' }, description: `可选：本次确实需要的教法或学科原则，至多4个；省略为不附加。可选内置 ${workerSkills.map(item => `notara-${item.id}`).join('、')}，以及学生已启用的学习集层 notara-set-* 与学科层 notara-global-*（名称见技能目录）。Host读取实际Skill正文，不注入所有Skill或学生历史。` },
      run_in_background: { type: 'boolean', description: `可选：true 时立即返回 jobId，工作员在后台运行，你可以继续上课；完成后运行时发来通知，用 job_output 读取结果，用 job_kill 停止。下一步必须依赖结果时省略它（同步等待）。每课堂同时最多${WORKER_CONCURRENCY}个工作员任务，同步与后台合计。` },
    } },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => false,
    execute: (args, exec) => service.ask(args, exec),
  }));
  ctx.effect(() => ctx.tools.guard(exec => {
    if (exec.name === 'ask_worker' && (!teaching.isTeaching(exec.agent) || exec.agent?.session?.header?.origin === 'subagent')) return '此任务只由本课老师安排。';
    if (teaching.isTeaching(exec.agent) && exec.agent?.session?.header?.origin === 'subagent' && !WORKER_TOOLS.read.includes(exec.name)) return '后台任务只允许配置范围内的读取，不写入或安排其他助手。';
    return undefined;
  }));
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next(), agent = context.agent;
    if (teaching.isTeaching(agent) && agent.session.header.origin === 'subagent') {
      // The spawn provider installs this child's selected persona and tool filter
      // in its own scope. Keep that composition instead of replacing all children
      // with the solver. Native restrictions already intersect with parent policy.
      const names = new Set(result.tools.filter(tool => WORKER_TOOLS.read.includes(tool.name)).map(tool => tool.name));
      return { ...result,
        sections: result.sections.filter(section => section.name === 'deployment:persona-prefix' || names.has(section.name.replace(/^tool:/, ''))),
        contexts: result.contexts.filter(item => item.name === 'subagent:delegation'),
        tools: result.tools.filter(tool => names.has(tool.name)),
      };
    }
    if (!teaching.isTeaching(agent)) return { ...result, tools: result.tools.filter(tool => tool.name !== 'ask_worker') };
    return result;
  });
  return service;
}
