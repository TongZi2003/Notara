import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVaultStore, safeRelativePath, resolveVaultRoot, pathKey } from './vault.js';
import { installTeachingRuntime } from './teaching-runtime.js';
import { VAULT_REMOTE_METHODS } from './remote-client.js';
import { USER_SKILL_DIRECTORY, announceUserSkills } from './user-skills.js';
import { createPdfAnnotationStore } from './pdf-annotations.js';
import { installFontRoute } from './font-route.js';
import { installUpdateBridge } from './update-runtime.js';
import { installChatgpt } from './chatgpt-runtime.js';
import { installSessionDeletion } from './session-deletion-runtime.js';
import { installRemoteSettings } from './remote-settings-runtime.js';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';
const MAX_CONTENT_LENGTH = 2_000_000;
const MAX_ASSET_BASE64_LENGTH = 70_000_000;

function fail(code) {
  throw new Error(code);
}

function objectInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('vault_input_invalid');
  return value;
}

function stringInput(value, name, max = 200_000) {
  if (typeof value !== 'string' || value.length > max) fail(`vault_${name}_invalid`);
  return value;
}

function exactInput(value, required, optional = []) {
  const input = objectInput(value), allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail('vault_input_invalid');
  for (const key of required) if (!Object.hasOwn(input, key)) fail('vault_input_invalid');
  return input;
}

function limitInput(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail('vault_limit_invalid');
  return value;
}

function pathInput(value, name = 'path') {
  let path;
  try { path = safeRelativePath(stringInput(value, name, 1_000)); }
  catch { fail('vault_path_invalid'); }
  // Dot folders (.git, .trash, .notara) and node_modules are never Vault
  // material: the page reaches the recycle bin and annotations through their
  // own methods, and nothing here reads or writes inside them.
  if (path.split('/').some(part => part.startsWith('.') || pathKey(part) === 'node_modules')) fail('vault_path_invalid');
  return path;
}

/**
 * The session a request belongs to. It is never invented here: a request without
 * a real sessionId is resolved (and refused when unregistered) by the teaching
 * runtime, so a missing session can never quietly read the process workspace.
 */
function scopeOf(input) {
  if (input.sessionId === undefined) return {};
  const { sessionId } = input;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 200) fail('vault_session_invalid');
  return { sessionId };
}

function expectedRevision(value) {
  if (value !== null && (typeof value !== 'string' || value.length > 100)) fail('vault_revision_invalid');
  return value;
}

function valuesInput(value) {
  const input = objectInput(value);
  for (const [key, item] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')) fail('vault_template_values_invalid');
  }
  return input;
}

export class NotaraVaultRemote extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'notaraVault');
    this.templatesRoot = fileURLToPath(new URL('./templates/', import.meta.url));
    // One store per real workspace root. The same session always resolves to the
    // same vault, and two workspaces never share a store or its cached index.
    this.stores = new Map();
    this.annotationStores = new Map();
  }

  /**
   * The authenticated editor for the workspace this request really belongs to.
   * The Host resolves it from the live session (or its own registered startup
   * workspace); the client never supplies a path.
   */
  async editorFor(input) {
    const teaching = this.ctx.get('notaraTeaching');
    if (!teaching || typeof teaching.editorFor !== 'function') fail('teaching_not_ready');
    return teaching.editorFor(scopeOf(input));
  }

  /** The file projection of that same workspace, cached by root. */
  async storeFor(input) {
    const editor = await this.editorFor(input), workspacePath = editor?.workspace?.path;
    if (typeof workspacePath !== 'string' || !workspacePath) fail('vault_workspace_unavailable');
    const root = resolveVaultRoot(workspacePath);
    let store = this.stores.get(root);
    if (!store) { store = createVaultStore(root, this.templatesRoot); this.stores.set(root, store); }
    return store;
  }

  async list(input) {
    const data = exactInput(input, [], ['prefix', 'sessionId']);
    const store = await this.storeFor(data);
    return store.list(data.prefix === undefined ? undefined : pathInput(data.prefix, 'prefix'));
  }

  async read(input) {
    const data = exactInput(input, ['path'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.read(pathInput(data.path));
  }

  async readAsset(input) {
    const data = exactInput(input, ['path'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.readAsset(pathInput(data.path));
  }

  async save(input) {
    const data = exactInput(input, ['path', 'content', 'expectedRevision'], ['sessionId']);
    const content = stringInput(data.content, 'content', MAX_CONTENT_LENGTH);
    // The Host editor and the model share one writer, so the asset page and the
    // model must resolve the same workspace for the same session.
    const path = pathInput(data.path);
    const saved = await (await this.editorFor(data)).save(path, content, expectedRevision(data.expectedRevision));
    // A student editing a learning-set skill by hand may change what the teacher is offered.
    if (path.split('/')[0] === USER_SKILL_DIRECTORY) announceUserSkills();
    return saved;
  }

  async teachingSettings(input) {return this.teachingCall('settings',exactInput(input,['sessionId']));}
  async updateStatus(input) { exactInput(input, [], ['sessionId']); return this.ctx.notaraUpdates.status(); }
  async checkUpdate(input) { exactInput(input, [], ['sessionId']); return this.ctx.notaraUpdates.check(); }
  async applyUpdate(input) { exactInput(input, [], ['sessionId']); return this.ctx.notaraUpdates.apply(); }
  async board(input) {return this.teachingCall('board',exactInput(input,['sessionId']));}
  async mutateBoard(input) {return this.teachingCall('mutateBoard',exactInput(input,['sessionId','expectedRevision','patch'],['blockId','sourcePath']));}
  async answerBoard(input) {
    const data=exactInput(input,['sessionId','blockId','component','fingerprint','value']);
    if(!Number.isInteger(data.component)||typeof data.fingerprint!=='string'||typeof data.blockId!=='string') fail('vault_input_invalid');
    return this.teachingCall('answerBoard',data);
  }
  async resendBoardAnswer(input) {return this.teachingCall('resendBoardAnswer',exactInput(input,['sessionId','blockId','answerId']));}
  async mutateBoardInteraction(input) {return this.teachingCall('mutateBoardInteraction',exactInput(input,['sessionId','boardRevision','interactionId','interactionRevision','patch']));}
  async classroom(input) {return this.teachingCall('classroom',exactInput(input,['sessionId']));}
  async solverTask(input) {return this.teachingCall('solverTask',exactInput(input,['sessionId','taskId']));}
  async configureSolver(input) {return this.teachingCall('configureSolver',exactInput(input,['sessionId','expectedRevision','preset','route','tools'],['persona','scope','inherit']));}
  async cancelSolver(input) {return this.teachingCall('cancelSolver',exactInput(input,['sessionId','taskId']));}
  async pomodoro(input) {return this.teachingCall('pomodoro',exactInput(input,['sessionId']));}
  async userSkills(input) {return this.teachingCall('userSkills',exactInput(input,[],['sessionId']));}
  async setUserSkillStatus(input) {return this.teachingCall('setUserSkillStatus',exactInput(input,['scope','id','status','expectedRevision'],['workspaceId','sessionId']));}
  async resolveUserSkillRevision(input) {return this.teachingCall('resolveUserSkillRevision',exactInput(input,['scope','id','action','expectedRevision'],['workspaceId','sessionId']));}
  async inheritUserSkill(input) {return this.teachingCall('inheritUserSkill',exactInput(input,['fromWorkspaceId','toWorkspaceId','id'],['sessionId']));}
  async createLearningSetOverview(input) {return this.teachingCall('createLearningSetOverview',exactInput(input,['workspaceId'],['sessionId']));}
  async startPomodoro(input) {return this.teachingCall('startPomodoro',exactInput(input,['sessionId','phase'],['minutes']));}
  async stopPomodoro(input) {return this.teachingCall('stopPomodoro',exactInput(input,['sessionId']));}
  async updateTeachingSettings(input) {return this.teachingCall('updateSettings',exactInput(input,['sessionId','expectedRevision','patch']));}
  async routes(input) {const data=exactInput(input,[],['sessionId']);return this.teachingCall('routes',scopeOf(data));}
  async createRoute(input) {return this.teachingCall('createRoute',exactInput(input,['title','lessons'],['sessionId']));}
  async openRouteLesson(input) {
    const data=exactInput(input,['path','nodeId','expectedRevision'],['sessionId','repeat']);
    if(data.repeat!==undefined&&typeof data.repeat!=='boolean') fail('vault_input_invalid');
    return this.teachingCall('openRouteLesson',data);
  }
  async lessonLog(input) {const data=exactInput(input,[],['from','to','subject','query','offset','limit','sessionId']);return this.teachingCall('lessonLog',data);}
  async requestLessonSummary(input) {return this.teachingCall('requestSummary',exactInput(input,['sessionId']));}
  async calendar(input) {return this.teachingCall('calendar',exactInput(input,['from','to'],['sessionId','timeZone']));}
  async reviewQueue(input) {return this.teachingCall('reviewQueue',exactInput(input,[],['sessionId','timeZone','query','tag','status','offset','limit']));}
  async reviewDetail(input) {return this.teachingCall('reviewDetail',exactInput(input,['path'],['sessionId']));}
  async recordReview(input) {return this.teachingCall('recordReview',exactInput(input,['path','expectedRevision','result','note'],['keyStep','sessionId','timeZone']));}
  async undoReview(input) {return this.teachingCall('undoReview',exactInput(input,['path','expectedRevision'],['sessionId']));}
  async dailyNote(input) {return this.teachingCall('dailyNote',exactInput(input,['date'],['sessionId']));}
  async scheduleLesson(input) {return this.teachingCall('scheduleLesson',exactInput(input,['path','nodeId','date','expectedRevision'],['sessionId']));}
  async teachingCall(method,input) {
    const teaching=this.ctx.get('notaraTeaching');
    if(!teaching) throw new Error('教学功能正在准备，请稍后重试。');
    try{return await teaching[method](input);}catch(error){
      const messages={teaching_settings_conflict:'设置已被修改，请重新打开后再保存。',teaching_session_required:'请在教学会话中使用此功能。',vault_revision_conflict:'资料已被修改，请刷新后再试。',vault_file_not_found:'找不到对应资料，请检查文件是否已移动。',lesson_script_required:'请选择一份真实的备课资料。'};
      const solverMessages={solver_teacher_required:'请在老师的课堂中使用此功能。',solver_settings_conflict:'解题者设置已被修改，请刷新后再保存。',solver_model_unavailable:'这个模型现在不在可用的模型里，请重新选择。',solver_defaults_unavailable:'这里没有可写的共享设置位置，只能改本课。',solver_task_not_found:'找不到这次分析任务，请刷新后再试。',solver_task_unavailable:'分析正在准备，稍后就可以查看。'};
      const reviewMessages={vault_reference_stale:'资料已被修改，请刷新后再试。',review_result_invalid:'请选择这次关键一步的结果。',review_key_step_invalid:'“检验的是哪一步”最多写 200 字。',review_history_invalid:'这张卡片的评估历史有格式问题，请在 Vault 里打开它检查后再记录。',review_conflict:'这条评估已存在且内容不同，请重新读取后处理。',review_state_invalid:'复习属性不完整或互相冲突，请在 Vault 里打开这张卡片检查。',review_date_invalid:'请填写有效日期。',review_note_required:'请先写下这次回忆或作答的情况。',review_state_mismatch:'评估后资料已被调整，请刷新并检查复习属性。',review_undo_unavailable:'没有可以撤销的评估。',calendar_daily_ambiguous:'这一天有多份日记，请从日历列表选择。',calendar_scan_incomplete:'资料还没读取完整，请刷新后再创建日记。'};
      const pomodoroMessages={pomodoro_input_invalid:'番茄钟时长不在可选范围内，请重新选择。',skill_revision_conflict:'这份技能刚被改过，请刷新后再确认。',skill_not_found:'找不到这份技能，请刷新列表。',skill_exists:'这个学习集已经有同名技能，不能再继承一份。',skill_scope_unavailable:'当前运行环境没有学科层技能目录。',skill_revision_not_found:'这份修订已经处理过了，请刷新列表。',skill_inherit_same_set:'请选择另一个学习集作为来源。',overview_incomplete:'梗概还有待填写的必填项（科目、学什么、学段或水平、目标与期限），补全后再启用。',overview_exists:'这个学习集已经有梗概了。',overview_field_missing:'梗概缺少必填项，请在资料库里补上。'};
      const boardMessages={board_answer_stale:'这道题刚被老师改过，请看一眼新题目再作答。',board_answer_invalid:'作答还不完整，请检查后再交。',board_answer_reason_required:'这道题要写一句理由再交。',board_answer_empty:'至少填一个空再交。',board_component_missing:'这道题已经不在白板上了，请刷新。',board_answer_missing:'找不到这次作答，请刷新白板。',board_component_locked:'老师写的题目和图里不能加高亮，请选择旁边的文字。',board_unpin_unavailable:'这一块来自旧白板，不能放回排版。',board_block_missing:'这一块已经不在白板上了，请刷新。'};
      // Some Host errors carry a model-facing explanation after `code:`; the page reads the code's own sentence.
      const code=String(error?.message??'').split(':')[0];
      throw new Error(messages[code]??solverMessages[code]??reviewMessages[code]??boardMessages[code]??pomodoroMessages[code]??'操作未完成，请检查内容后重试。',{cause:error});
    }
  }

  async saveAsset(input) {
    const data = exactInput(input, ['path', 'dataBase64', 'mime', 'expectedRevision'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.saveAsset(pathInput(data.path), stringInput(data.dataBase64, 'asset_data', MAX_ASSET_BASE64_LENGTH), stringInput(data.mime, 'mime', 200), expectedRevision(data.expectedRevision));
  }

  async annotationStoreFor(input) {
    const editor=await this.editorFor(input),root=resolveVaultRoot(editor.workspace.path);
    let store=this.annotationStores.get(root);
    if(!store){store=createPdfAnnotationStore(root);this.annotationStores.set(root,store);}
    return store;
  }
  async pdfAnnotations(input) {
    const data=exactInput(input,['path'],['sessionId']);
    return (await this.annotationStoreFor(data)).read(pathInput(data.path));
  }
  async updatePdfAnnotations(input) {
    const data=objectInput(input),store=await this.annotationStoreFor(data);
    const {sessionId,...mutation}=data;
    return store.mutate(mutation);
  }

  async search(input) {
    const data = exactInput(input, ['query'], ['limit', 'sessionId']);
    const store = await this.storeFor(data);
    return store.search(stringInput(data.query, 'query', 2_000), limitInput(data.limit, 50, 100));
  }

  async query(input) {
    const data = exactInput(input, ['where'], ['limit', 'sessionId']);
    const where = objectInput(data.where);
    if (Object.keys(where).length > 12) fail('vault_query_invalid');
    const store = await this.storeFor(data);
    return store.query(where, limitInput(data.limit, 100, 500));
  }

  async links(input) {
    const data = exactInput(input, ['path'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.links(pathInput(data.path));
  }

  async graph(input) {
    // The graph carries no shape of its own: it is always the whole vault
    // projection of the session's workspace.
    const data = exactInput(input, [], ['sessionId']);
    const store = await this.storeFor(data);
    return store.graph();
  }

  async learningStars(input) {
    // Read-only: leaf BKT states and parent aggregates over the whole vault, so a
    // filter or a collapsed layer in the client never changes a star's light.
    const data = exactInput(input, [], ['sessionId']);
    const store = await this.storeFor(data);
    return store.learningStars();
  }

  async templates(input) {
    const data = exactInput(input, [], ['sessionId']);
    const store = await this.storeFor(data);
    return store.templates();
  }

  async createFromTemplate(input) {
    const data = exactInput(input, ['templatePath', 'path', 'values', 'expectedRevision'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.createFromTemplate(pathInput(data.templatePath, 'template_path'), pathInput(data.path), valuesInput(data.values), expectedRevision(data.expectedRevision));
  }

  async tasks(input) {
    const data = exactInput(input, ['path'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.tasks(pathInput(data.path));
  }

  async toggleTask(input) {
    const data = exactInput(input, ['path', 'line', 'checked', 'expectedRevision'], ['sessionId']);
    if (!Number.isInteger(data.line) || data.line < 1) fail('vault_task_not_found');
    if (typeof data.checked !== 'boolean') fail('vault_task_invalid');
    const store = await this.storeFor(data);
    return store.toggleTask(pathInput(data.path), data.line, data.checked, expectedRevision(data.expectedRevision));
  }

  // 回收站: one file per request, one recoverable entry per delete. The request
  // names a path and proves the revision it saw; the entry id, the delete time
  // and the host that owns the scope are all bound here, never by the client.
  async trashFile(input) {
    const data = exactInput(input, ['path', 'expectedRevision'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.trashFile(pathInput(data.path), expectedRevision(data.expectedRevision), { id: randomUUID(), deletedAt: new Date().toISOString() });
  }

  async listTrash(input) {
    const data = exactInput(input, [], ['sessionId']);
    const store = await this.storeFor(data);
    return store.listTrash();
  }

  async restoreFile(input) {
    const data = exactInput(input, ['id'], ['sessionId']);
    const store = await this.storeFor(data);
    return store.restoreFile(stringInput(data.id, 'trash_id', 64));
  }
}

// The standalone prototype is JavaScript, so it cannot use the TypeScript
// generator. Keep the same marker shape the protocol decorator writes; the
// Gateway then derives conservative src-json descriptors from the methods.
Object.defineProperty(NotaraVaultRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze(VAULT_REMOTE_METHODS.map(method => Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }))),
  }),
});

export function apply(ctx) {
  installUpdateBridge(ctx);
  ctx.plugin(NotaraVaultRemote);
  installFontRoute(ctx);
  installChatgpt(ctx);
  installSessionDeletion(ctx);
  installRemoteSettings(ctx);
  // A Cordis plugin body must not return the service instance as a disposable.
  ctx.inject(['tools','systemPrompt','fs','sessions','sessionController','skills','workspaceRegistry','llm','subagents'],scope=>{installTeachingRuntime(scope);});
}
