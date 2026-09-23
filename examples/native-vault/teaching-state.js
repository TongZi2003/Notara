import { parseSourceRef } from './agent-io.js';
import { safeRelativePath } from './vault.js';
import { defaultTeachingRef, teachingChoices } from './teaching-catalog.js';

/**
 * 本插件写进原生 session 日志的三类事件。
 *
 * 它们是 harness 不认识的事件类型（`notara/*`），所以必须带信封上的
 * `ignorable: true` 标记：读侧的 `validateStoredEvents` 会拒绝任何未知且未标记的
 * 事件，整条会话日志从此无法 cold read（host-review.md P0）。原生
 * `Session.append` 只透传 `surfaceOp`/`sourceEventSeqs`，`ignorable` 需要
 * `scripts/patch-session-extension.ts` 提供的原生 seam。
 *
 * 这里不绕过读侧校验：`appendTeachingEvent` 只允许本插件前缀、只对未知非 surface
 * 事件传 `ignorable: true`，写入前的 `assertIgnorableSeam` 在 seam 缺失时直接失败，
 * 不会静默写出一条以后读不回来的日志。
 */
export const SETTINGS_EVENT = 'notara/teaching-settings';
export const LESSON_EVENT = 'notara/lesson-binding';
export const SUMMARY_EVENT = 'notara/lesson-summary';

const PLUGIN_EVENT_PREFIX = 'notara/';
/** 原生 append 透传 ignorable 的 seam 标记，由 patch-session-extension.ts 植入。 */
const IGNORABLE_SEAM_MARKER = 'sessionIgnorableMarker';
/** 一次路线节点绑定最多带多少条材料 ref。 */
export const MATERIAL_LIMIT = 100;
const MATERIAL_BUDGET = { path: 200, title: 200, revision: 200, ref: 8000 };
const CONTINUATION_TEXT_BUDGET = 600;
const fail = code => { throw new Error(code); };

function asText(value) { return typeof value === 'string' ? value : ''; }
function points(value) { return Array.from(asText(value)).length; }

/** 绑定快照里的字符串：有界、去空白；空值一律是 null，不用空串冒充已记录。 */
function exactText(value, limit) {
  const normalized = bindingText(value, limit);
  const expected = value === undefined || value === null || value === '' ? null : value;
  return normalized === expected ? normalized : fail('teaching_binding_invalid');
}

function bindingText(value, limit, code = 'teaching_binding_invalid') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail(code);
  const text = value.trim();
  if (!text) return null;
  const list = Array.from(text);
  return list.length <= limit ? text : list.slice(0, limit).join('');
}

/**
 * 原生 seam 的运行前检查。
 *
 * 未打 patch 时 `Session.append` 会静默丢掉 `ignorable`，写成功、cold read 失败；
 * 这里在写入前用真实方法源码确认 seam 已生效，宁可当场报
 * `teaching_ignorable_seam_missing`，也不留下一份读不回来的日志。
 */
function assertIgnorableSeam(session) {
  const append = session?.append;
  if (typeof append !== 'function') fail('teaching_session_required');
  if (!Function.prototype.toString.call(append).includes(IGNORABLE_SEAM_MARKER)) fail('teaching_ignorable_seam_missing');
  return append;
}

/**
 * 追加一条本插件事件，并带上读侧要求的 `ignorable: true` 信封。
 *
 * 只用于不影响原生 conversation 的未知事件（教学设置、剧本绑定、课堂小结）：
 * 原生 seam 会对已知事件类型和 surface 事件抛错，所以它不会扩大已知事件的忽略能力，
 * 也不会改变任何消息/会话投影。data 必须可完整 JSON 序列化，原生 append 会拒绝其他值。
 */
export function appendTeachingEvent(session, type, data) {
  if (typeof type !== 'string' || !type.startsWith(PLUGIN_EVENT_PREFIX)) fail('teaching_event_type_invalid');
  assertIgnorableSeam(session);
  session.append(type, data, { ignorable: true });
  return session;
}

/**
 * 路线节点绑定的材料 refs：Host 给出的真实定位 `{path,title,revision,ref}`。
 * 材料必须进本课任务背景，模型不该只拿路线文件里的 path 去猜对象。
 * 最多 `MATERIAL_LIMIT` 条；`title` 只作显示、按显示预算裁剪，
 * `path/revision/ref` 必须落在各自界内——截断后的 ref 不再是有效引用，所以直接拒绝。
 */
function materialsValue(value) {
  if (value === null || value === undefined || value === '') return [];
  if (!Array.isArray(value) || value.length > MATERIAL_LIMIT) fail('teaching_binding_invalid');
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('teaching_binding_invalid');
    for (const key of ['path','title','revision','ref']) {
      if (item[key] !== undefined && item[key] !== null && typeof item[key] !== 'string') fail('teaching_binding_invalid');
    }
    const path = exactText(item.path, MATERIAL_BUDGET.path);
    if (!path) fail('teaching_binding_invalid');
    safeRelativePath(path);
    return { path, title: bindingText(item.title, MATERIAL_BUDGET.title), revision: exactText(item.revision, MATERIAL_BUDGET.revision), ref: exactText(item.ref, MATERIAL_BUDGET.ref) };
  });
}

/** The old event field name is retained for cold reads, but its projection is
 * now provenance only. Legacy truncated bodies must never enter model context
 * or settings responses; the real file is read by stage with revision checks. */
function scriptSnapshotValue(value) {
  if (value === null || value === undefined || value === '') return { value: null, truncated: false };
  if (typeof value === 'string') return { value: null, truncated: true };
  if (typeof value !== 'object' || Array.isArray(value)) fail('teaching_binding_invalid');
  for (const key of ['title','path','revision','ref']) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') fail('teaching_binding_invalid');
  }
  const fields = ['title','path','revision','ref'];
  const budgets = { title: 200, path: 200, revision: 200, ref: 8000 };
  const truncated = fields.some(key => points(value[key]) > budgets[key]);
  return { value: Object.fromEntries(fields.map(key => [key, key === 'title' ? bindingText(value[key], budgets[key]) : exactText(value[key], budgets[key])])), truncated };
}

/** 前课快照的规范化投影：既接受旧的 `{ref,text,title}`，也接受显式绑定字段。 */
function projectContinuation(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return value;
  const ref = bindingText(value.ref, 8000);
  let pin = null;
  if (ref) { try { pin = parseSourceRef(ref); } catch { pin = null; } }
  const text = bindingText(value.text, CONTINUATION_TEXT_BUDGET);
  return {
    ref,
    title: bindingText(value.title, 200),
    text,
    ...(pin ? { workspaceId: pin.workspaceId, path: pin.path, revision: pin.revision, anchor: pin.locator?.anchor ?? null } : {}),
  };
}

function normalizeContinuation(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) fail('teaching_binding_invalid');
  for (const key of ['ref','text','title']) if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') fail('teaching_binding_invalid');
  if (value.ref && bindingText(value.ref, 8000) !== value.ref) fail('teaching_binding_invalid');
  return projectContinuation(value);
}

export function readTeachingSettings(session) {
  const result = {revision:0,teachingRef:defaultTeachingRef,learningGoal:null,temporaryInstructions:'',subjects:[],scriptPath:null,routePath:null,nodeId:null,continuation:null,scriptRevision:null,scriptWorkspaceId:null,scriptSnapshot:null,scriptSnapshotTruncated:false,materials:[]};
  for (const event of session.snapshotEvents()) {
    if (event.type===SETTINGS_EVENT) Object.assign(result,event.data);
    if (event.type===LESSON_EVENT) Object.assign(result,event.data);
  }
  const snapshot=scriptSnapshotValue(result.scriptSnapshot);
  return {...result,scriptSnapshot:snapshot.value,scriptSnapshotTruncated:snapshot.truncated,continuation:projectContinuation(result.continuation),choices:teachingChoices};
}

export function validateTeachingPatch(patch) {
  if (!patch || typeof patch!=='object' || Array.isArray(patch)) fail('teaching_settings_invalid');
  const allowed=['teachingRef','learningGoal','temporaryInstructions','subjects'];
  for (const key of Object.keys(patch)) if (!allowed.includes(key)) fail('teaching_settings_invalid');
  const result={};
  if (Object.hasOwn(patch,'teachingRef')) {
    const value=patch.teachingRef??defaultTeachingRef;
    if (!teachingChoices.some(item=>item.id===value)) fail('teaching_choice_invalid');
    result.teachingRef=value;
  }
  if (Object.hasOwn(patch,'temporaryInstructions')) {
    if(typeof patch.temporaryInstructions!=='string'||patch.temporaryInstructions.length>8000) fail('teaching_instructions_invalid');
    result.temporaryInstructions=patch.temporaryInstructions;
  }
  if (Object.hasOwn(patch,'learningGoal')) {
    if (patch.learningGoal===null) result.learningGoal=null;
    else {
      const goal=patch.learningGoal;
      if(!goal||typeof goal!=='object'||Array.isArray(goal)||typeof goal.title!=='string'||!goal.title.trim()||goal.title.length>1000) fail('teaching_goal_invalid');
      if(Object.keys(goal).some(key=>!['title','deadline','dailyMinutes'].includes(key))) fail('teaching_goal_invalid');
      if(goal.deadline!==undefined&&(!/^\d{4}-\d{2}-\d{2}$/.test(goal.deadline)||Number.isNaN(Date.parse(goal.deadline))||new Date(goal.deadline).toISOString().slice(0,10)!==goal.deadline)) fail('teaching_goal_invalid');
      if(goal.dailyMinutes!==undefined&&(!Number.isInteger(goal.dailyMinutes)||goal.dailyMinutes<=0||goal.dailyMinutes>1440)) fail('teaching_goal_invalid');
      result.learningGoal={title:goal.title.trim(),...(goal.deadline===undefined?{}:{deadline:goal.deadline}),...(goal.dailyMinutes===undefined?{}:{dailyMinutes:goal.dailyMinutes})};
    }
  }
  if (Object.hasOwn(patch,'subjects')) {
    if(!Array.isArray(patch.subjects)||patch.subjects.length>12||patch.subjects.some(item=>typeof item!=='string'||!item.trim()||item.length>80)) fail('teaching_subjects_invalid');
    result.subjects=[...new Set(patch.subjects.map(item=>item.trim()))];
  }
  return result;
}

export function updateTeachingSettings(session, patch, expectedRevision) {
  const current=readTeachingSettings(session);
  if(!Number.isInteger(expectedRevision)||expectedRevision!==current.revision) fail('teaching_settings_conflict');
  const data=validateTeachingPatch(patch);
  appendTeachingEvent(session, SETTINGS_EVENT, {...data,revision:current.revision+1});
  return readTeachingSettings(session);
}

/**
 * 绑定本课的剧本、路线节点与前课快照。
 *
 * `scriptRevision` 是绑定时刻的剧本 revision；保留事件字段名 `scriptSnapshot`，
 * 仅记录 title/path/revision/ref，不保存或注入截断原文，也不充当历史版本库。
 * 当前目录每轮重新读取；阶段正文要求匹配真实 revision。
 * `scriptWorkspaceId` 记录剧本所属学习集。`materials` 是路线节点携带的材料 refs
 * （`{path,title,revision,ref}`，最多 100 条），让材料进入任务背景而不是只留路线 path。
 * 前课走 `continuation`，沿用旧的
 * `{ref,text,title}` 形状；能从 ref 解析出作用域/路径/anchor/revision 时一并补齐。
 * 每次绑定都写全字段，重绑不会把上一课的快照留在新绑定里。
 */
export function bindTeachingLesson(session,{scriptPath=null,routePath=null,nodeId=null,continuation=null,scriptRevision=null,scriptWorkspaceId=null,scriptSnapshot=null,materials=[]}={}) {
  if(scriptPath!==null) safeRelativePath(scriptPath);
  if(routePath!==null) safeRelativePath(routePath);
  if(nodeId!==null&&(typeof nodeId!=='string'||nodeId.length>200)) fail('teaching_binding_invalid');
  const revision=bindingText(scriptRevision,200);
  if(scriptRevision!==null&&revision===null) fail('teaching_binding_invalid');
  const workspace=bindingText(scriptWorkspaceId,200);
  if(scriptWorkspaceId!==null&&workspace===null) fail('teaching_binding_invalid');
  const snapshot=scriptSnapshotValue(scriptSnapshot);
  appendTeachingEvent(session, LESSON_EVENT, {
    scriptPath,routePath,nodeId,
    materials:materialsValue(materials),
    continuation:normalizeContinuation(continuation),
    scriptRevision:revision,
    scriptWorkspaceId:workspace,
    scriptSnapshot:snapshot.value,
    scriptSnapshotTruncated:snapshot.truncated,
  });
  return readTeachingSettings(session);
}

export function teachingCutoff(session) {
  const events=session.snapshotEvents();
  const users=events.filter(event=>event.type==='user/message'&&event.data.source?.kind==='user');
  const last=users.at(-1);
  return {cutoff:last?String(last.seq):'empty',startedAt:new Date(users[0]?.time??session.header?.createdAt??Date.now()).toISOString(),throughAt:new Date(last?.time??session.header?.createdAt??Date.now()).toISOString()};
}
