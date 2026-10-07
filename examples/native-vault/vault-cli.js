#!/usr/bin/env node
/**
 * Native Vault CLI — the deterministic entry point the teacher model reaches
 * through the ordinary approved local Bash process.
 *
 * It deliberately covers only the operations whose correctness must not depend
 * on model memory: the review lifecycle, the calendar projection, the lesson
 * log index, route creation with generated node identities, lesson scheduling
 * and one-page PDF reading. Reading, searching and saving ordinary material stay
 * with the native filesystem tools and Skills.
 *
 * One process run answers one command: arguments arrive as one small JSON
 * object on stdin, exactly one JSON result goes to stdout, and failures exit
 * non-zero with a stable code and an actionable `next`. Nothing here prints a
 * log line, a credential or a base64 payload.
 *
 * Identity and scope come from the Host-injected environment, not from model
 * arguments: `DSH_NOTARA_WORKSPACE` is the real session workspace,
 * `DSH_NOTARA_WORKSPACE_ID` its registry id, `DSH_SESSION_ID` the native
 * session, and `DSH_NOTARA_CALL_ID` this call (for idempotent recordings).
 * Without that binding the command only runs standalone when the user passes
 * an explicit `--workspace <absolute>`; there is no guessed default root.
 *
 * This is an ordinary approved local process: it does not try to prove a model
 * cannot forge a shell command, and it never claims that kind of guarantee.
 */
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createEditorVaultIO, sourceRef } from './agent-io.js';
import { createRouteInVault, reviseRouteInVault } from './file-operations.js';
import { lessonLog, parseRoute, ROUTE_PATHWAYS } from './lesson-data.js';
import { scriptBindingStale } from './script-binding.js';
import { lessonOutline, readLessonStage } from './lesson-script.js';
import { buildVaultGraph, childCardsOf, KNOWLEDGE_CARD_TYPES, MATERIAL_TYPES } from './graph.js';
import { embedTarget, mediaForPath, parseMediaTarget } from './media.js';
import { createReviewRuntime } from './review-runtime.js';
import { reviewState, validateReviewNote, validateResult, validateKeyStep, REVIEW_RESULTS } from './review-data.js';
import { safeRelativePath, resolveVaultRoot, revisionFor, pathKey, portablePath } from './vault.js';
import { BOARD_DIRECTORY } from './board-data.js';
import { USER_SKILL_DIRECTORY, globalSkillRoot, readUserSkills, saveUserSkill, setSkillRoot } from './user-skills.js';
import { CLI_WRITE_COMMANDS, CLI_WRITE_URL_ENV, CLI_WRITE_MODE_ENV } from './cli-write-contract.js';
import { requestCliWrite } from './cli-write-client.js';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const STDIN_LIMIT = 64 * 1024;
const BATCH_STDIN_LIMIT = 2 * 1024 * 1024;

/* ------------------------------------------------------------------ errors */

/** Every user-visible failure explains what happened and what to do next. */
const ERROR_HELP = {
  cli_write_denied: ['当前课堂没有本次写入权限。', '让用户在权限设置中允许工作区写入后重试。'],
  cli_write_unavailable: ['本次文件写入通道已结束或不可用。', '重新发起这次命令；不要关闭沙箱或忽略文件权限错误。'],
  batch_original_mismatch: ['原文没有唯一匹配，未修改这个文件。', '用 sed 或 rg 重新读取相关段落，扩大到唯一原文后仅重试这一项。'],
  batch_duplicate_path: ['同一批包含重复目标文件。', '将同一文件的修改合并为一项，再提交整批。'],
  cli_workspace_required: ['没有可用的工作区。', '让用户确认当前学习集，或在独立使用时加 --workspace <绝对路径>。'],
  cli_workspace_invalid: ['工作区不是可用的绝对目录。', '检查 DSH_NOTARA_WORKSPACE，或把 --workspace 指向真实存在的绝对目录。'],
  cli_usage_invalid: ['命令行参数无法识别。', '先运行 help 或 <command> --help 查看准确用法。'],
  cli_command_unknown: ['没有这条命令。', '运行 help 查看命令清单。'],
  cli_stdin_too_large: ['参数超过了本命令的输入上限。', '普通命令最多64KiB，write-batch最多2MiB；按已核验的小批次提交。'],
  cli_stdin_invalid: ['stdin 不是 JSON 对象。', '传一个 JSON 对象；没有内容时传 {}。'],
  cli_field_unknown: ['参数里有命令不接受的字段。', '按 <command> --help 只传列出的内容字段。'],
  cli_field_required: ['缺少必填字段。', '按 <command> --help 补齐必填字段后重试。'],
  cli_field_invalid: ['字段类型或格式不对。', '按 <command> --help 修正该字段后重试。'],
  vault_path_invalid: ['路径不合法。', '改成 Vault 内的真实相对路径，不含 .. 或符号链接。'],
  board_path_reserved: ['课堂白板文件只由白板工具维护。', '用 write_lesson_board 修改板书，不直接改白板文件。'],
  skill_path_reserved: ['技能/ 下的学习集 Skill 不用 write-batch 写。', '用 skill-save 保存；新建是草稿，已启用的 Skill 会生成待学生确认的修订。'],
  skill_scope_unavailable: ['当前运行环境没有学科层 Skill 目录。', '只保存学习集层（scope: set），或如实说明学科层暂不可用。'],
  skill_status_reserved: ['Skill 只能由你保存为草稿。', '把 status 写成 draft；启用由学生在技能页确认。'],
  skill_revision_required: ['这份 Skill 已存在，需要带上读到的版本。', '先 skill-read 取 revision（有待确认修订时用 pending.revision），再保存。'],
  skill_revision_conflict: ['Skill 在你读取之后被改过。', '重新 skill-read，基于最新内容修改后再保存。'],
  skill_type_invalid: ['不是合法的 Skill 文件。', '页头要有 type: skill 与扁平 frontmatter。'],
  skill_id_invalid: ['Skill 的 id 不合法。', 'id 用小写字母、数字和连字符，最多48个字符。'],
  skill_title_invalid: ['Skill 缺少标题或标题过长。', 'title 写1..40字的中文名称。'],
  skill_description_invalid: ['Skill 缺少说明或说明过长。', 'description 写1..300字：何时使用、包含什么。'],
  skill_status_invalid: ['Skill 的 status 不合法。', 'status 只能是 draft 或 active。'],
  skill_body_empty: ['Skill 没有正文。', '补上正文后再保存。'],
  skill_content_invalid: ['Skill 内容过长或格式不对。', '控制在40000字符内；内容多时按主题拆成几份。'],
  skill_not_found: ['找不到这份 Skill。', '先 skill-list 查看真实的 scope 与 id。'],
  vault_session_required: ['这次调用没有绑定真实课堂。', '在教学会话里使用，或在独立使用时显式传 --workspace。'],
  vault_scope_unavailable: ['当前工作区没有注册。', '确认会话绑定的是已注册工作区。'],
  vault_reference_invalid: ['path 与 expectedRevision 不完整。', '先读取资料，再照抄它的真实 revision。'],
  vault_reference_stale: ['读到的版本已经过期。', '重新读取该资料的 revision 后再试。'],
  vault_revision_conflict: ['资料已被修改，写入被拒绝。', '重新读取最新 revision 后再试，不要用旧版本强写。'],
  vault_content_invalid: ['写入内容不是合法 Markdown。', '修正内容后重新读取 revision 再试。'],
  vault_file_not_found: ['找不到对应资料。', '确认路径，或先读取资料列表。'],
  vault_file_required: ['该路径不是普通文件。', '改成真实文件路径。'],
  vault_file_too_large: ['文件超过读取上限。', '改用更小的资料或按页读取。'],
  vault_pdf_too_large: ['这份 PDF 超过 512 MiB，当前无法使用。', '请先拆成较小的文件再打开。'],
  vault_pdf_size_unavailable: ['无法确认这份 PDF 的大小。', '检查文件状态后重试。'],
  vault_pdf_range_unavailable: ['当前文件系统不能分段读取 PDF。', '请检查运行时的文件读取能力。'],
  vault_pdf_version_unavailable: ['当前文件系统无法确认 PDF 的稳定版本。', '请使用支持文件版本校验的运行时重试。'],
  pdf_range_too_large: ['这份 PDF 需要读取超过 32 MiB 的连续对象，暂时无法按页处理。', '文件可能损坏或含过大的单页对象，请修复或拆分后重试。'],
  pdf_page_range_required: ['这份 PDF 超过 10,000 页，需要先选定查询范围。', '提供 pageRange，每次最多检查 10,000 页。'],
  vault_markdown_required: ['该操作只接受 Markdown 资料。', '改成 .md 路径。'],
  vault_asset_required: ['该操作只接受二进制资料。', '改成真实 PDF/图片路径。'],
  vault_media_not_supported: ['这种资料不能按页读取。', 'pdf-page 只接受 PDF。'],
  vault_title_invalid: ['标题为空或过长。', '给出 1..200 字符的真实标题。'],
  vault_limit_invalid: ['limit 超出允许范围。', '按 --help 给出的范围重试。'],
  vault_offset_invalid: ['offset 不是有效的非负整数。', '改成非负整数。'],
  review_card_required: ['该资料不是知识卡片。', '复习只针对 type: card 的卡片。'],
  review_document_invalid: ['卡片缺少可用的 frontmatter。', '修正卡片文件后重新读取。'],
  review_state_invalid: ['卡片复习属性互相冲突。', '按卡片模板修好属性，无法确定时交给用户处理。'],
  review_history_invalid: ['卡片的历史记录格式不对。', '修正文件的 review_history 后再试。'],
  review_date_invalid: ['日期不是真实的 YYYY-MM-DD。', '给出真实日期；不要用模型估的今天。'],
  review_request_invalid: ['这次记录的字段不完整或使用了旧格式。', '运行 record-review --help，按 keyStep、result 与 note 记录；学生到了哪一层、下次查什么写进卡片的学生理解。'],
  review_status_invalid: ['status 不在允许的取值里。', '使用 --help 列出的状态。'],
  review_note_required: ['这次评估没有写说明。', '先写下真实作答或讲解情况再记录。'],
  review_result_invalid: ['result 不在允许的取值里。', `按这次关键那一步的实际情况，从 ${Object.keys(REVIEW_RESULTS).join('、')} 中选一个。`],
  review_key_step_required: ['记了做出来或没做出来，却没写检验的是哪一步。', '在 keyStep 写这道题关键的思维步骤。'],
  review_key_step_invalid: ['keyStep 不是字符串或超过 200 字符。', '用一句话写清检验的那一步。'],
  review_note_too_long: ['说明超过 4000 字符。', '压缩到真实要点。'],
  review_day_regression: ['记录日期早于上一次复习。', '确认记录时间是否正确；不要倒填历史。'],
  review_conflict: ['同一个记录身份写入了不同内容。', '重新读取卡片后按当前状态记录。'],
  review_undo_unavailable: ['没有可以撤销的评估。', '不要新建一条相反的记录。'],
  review_state_mismatch: ['卡片在写入后又被改过。', '重新读取卡片，确认状态后再决定。'],
  cli_context_missing: ['课堂执行环境不完整。', '回到当前教学会话重新调用，不手填身份变量。'],
  calendar_zone_invalid: ['timeZone 不是有效的 IANA 时区。', '省略 timeZone，或用如 Asia/Shanghai。'],
  calendar_range_invalid: ['from/to 不是有效范围。', '给出 from <= to 的真实日期，跨度不超过一年。'],
  calendar_daily_ambiguous: ['这一天有多份日记。', '先由用户选择保留哪一份。'],
  calendar_scan_incomplete: ['资料没有读取完整。', '缩小范围或在完整工作区里重试。'],
  lesson_route_invalid: ['lessons 为空或超出 100 个节点。', '给出 1..100 个节点后重试。'],
  lesson_route_parent_invalid: ['parentIndex 不是更早的节点序号。', 'parentIndex 只能指向同数组里更靠前的节点。'],
  lesson_route_materials_invalid: ['materials 不是数组。', '改成 Vault 相对路径数组。'],
  lesson_route_node_missing: ['路线里没有这个节点。', '重新读取路线文件，照抄真实的 nodeId。'],
  lesson_route_field_unknown: ['路线参数含不支持的字段。', '按命令 --help 只传本次修改的内容字段，身份与日期不放进节点内容。'],
  lesson_route_field_invalid: ['路线字段不能这样清除。', '省略字段表示保留；只在parentId/scriptPath允许的地方用null，数组用[]清空。'],
  lesson_route_node_unknown_field: ['路线文件里有无法识别的节点字段。', '先核对该字段的含义，保留原文件，不用删除字段的方式强行通过保存。'],
  lesson_route_brief_location: ['规划正文重复放在节点属性里。', 'brief只保存在路线正文块；用create-route或revise-route写入，勿在lessons里复制全文。'],
  lesson_route_stage_invalid: ['阶段名称格式不对。', '使用0..120字符的单行名称；阶段是分组，不另建空课堂。'],
  lesson_route_pathway_invalid: ['路线类型无法识别。', '使用main、remedial或extension，默认main。'],
  lesson_route_prerequisite_invalid: ['先修引用重复、自指或格式错误。', '从route-outline选择真实节点；创建时下标必须对应本次lessons，不能引用自身。'],
  lesson_route_prerequisite_missing: ['先修课程不在这份路线中。', '重新读取节点导航，保留原路线，不编造节点身份。'],
  lesson_route_brief_invalid: ['本课规划过长或包含保留标记。', 'brief使用最多12000字符的Markdown，不手写notara:route标记；完整剧本另存。'],
  lesson_route_overview_invalid: ['课程总述过长或包含保留标记。', 'overview使用最多24000字符的Markdown，节点规划写各自brief，不手写Host标记。'],
  lesson_route_reason_invalid: ['修订原因为空、过长或格式错误。', '使用1..2000字符的单行原因，说明实际依据，不包含Host标记。'],
  lesson_route_path_invalid: ['路线文件路径无效。', '使用当前Vault中真实路线相对路径。'],
  lesson_route_revision_required: ['局部修订缺少版本。', '先用route-outline读取真实revision，再提交修订。'],
  lesson_route_update_invalid: ['修订列表为空值、重复或格式错误。', '每个nodeId只更新一次，updates和additions各不超过100项；字段详见--help。'],
  lesson_route_node_bound: ['这节课已经绑定实际课堂，不能覆盖其规划。', '保留该节点和历史；调整未来节点，或新增补练/重学课程。'],
  lesson_route_marker_stray: ['路线正文标记格式异常。', '读取原文件并修正节点块边界，保留实际正文和身份，不覆盖成空路线。'],
  lesson_route_block_truncated: ['路线正文块没有闭合。', '核对对应的node/log结束标记并修复原文后再试。'],
  lesson_route_duplicate_block: ['同一节点或修订日志出现重复正文块。', '核对重复部分，保留真实内容后修正，勿直接整页重建。'],
  lesson_route_cycle: ['课序和先修关系构成循环。', '分清直接前课与知识先修，移除形成循环的关系后再提交。'],
  lesson_route_missing_parent: ['直接前课不在这条路线里。', '重新读route-outline选择真实节点，独立主线可用null。'],
  lesson_route_self_parent: ['课程不能接续自己。', '选择另一真实节点或将主线的parentId清为null。'],
  lesson_route_duplicate_node: ['路线存在重复节点身份。', '核对原文件和课堂绑定，身份由创建命令生成，不手写相同身份。'],
  lesson_route_type_required: ['该文件不是路线。', '改成 type: route 的路线文件。'],
  lesson_script_required: ['scriptPath 指向的不是备课页。', '选择 type: lesson 的真实备课资料。'],
  lesson_section_not_found: ['剧本没有这个阶段。', '用 lesson-outline 读取当前目录，照抄返回的 section key。'],
  lesson_teacher_block_unclosed: ['剧本教师区域缺少关闭标签。', '修正对应 </details> 后重新读取目录与 revision。'],
  lesson_script_rebind_required: ['剧本已不是本课绑定的版本。', '先核对改动，再用 set_teaching_settings 重新绑定 scriptPath；不要直接改填 revision。'],
  pdf_page_invalid: ['page 超出这份 PDF 的真实页数。', '先看 pageCount，再按有效页重试。'],
  pdf_region_invalid: ['rect 不是四个归一化数字。', '按 [x, y, width, height] 传 0..1 的数字。'],
  pdf_bytes_invalid: ['读不到 PDF 字节。', '确认路径指向真实 PDF。'],
  pdf_document_invalid: ['这份文件不是有效 PDF。', '确认资料本身没有损坏。'],
  pdf_document_password_required: ['这份 PDF 需要密码。', '先由用户提供可读取的版本。'],
  media_read_aborted: ['读取被中断。', '重试一次；仍失败就如实说明。'],
  vault_write_approval_required: ['这次写入没有得到批准。', '由用户确认后重试。'],
  lesson_documents_invalid: ['资料扫描结果不可用。', '缩小范围后重试。'],
};

function describe(error) {
  const code = (error instanceof Error && error.message) ? error.message : 'cli_failure';
  const known = ERROR_HELP[code];
  if (known) return { code, message: known[0], next: known[1] };
  return { code, message: '命令没有完成。', next: '按上面的错误码检查输入；无法判断时如实告诉用户失败原因。' };
}

class CliError extends Error {
  constructor(code, detail) {
    super(code);
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ schema */

const field = (type, description, options = {}) => ({ type, description, ...options });

function text(max) {
  return value => {
    if (typeof value !== 'string' || !value.length || value.length > max) return false;
    return true;
  };
}

function day(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const instant = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(instant.getTime()) && instant.toISOString().slice(0, 10) === value;
}

function integer({ min = 0, max = 10000 } = {}) {
  return value => Number.isInteger(value) && value >= min && value <= max;
}

const pathField = description => field('string', description, { check: text(1000) });
/** A field whose shape the writer owns: its own error code, with the field named. */
const ownedBy = (validate, name) => value => { try { validate(value); return true; } catch (error) { throw new CliError(error.message, name); } };
const revisionField = description => field('string', description, { check: text(100) });

const LESSON_FIELDS = {
  title: field('string', '节点标题，必填，1..200 字符。', { required: true, check: text(200) }),
  parentIndex: field('number|null', '父节点下标（0起），必须小于自身；省略接上一个节点，null表示独立起点。', { check: value => value === null || Number.isInteger(value) && value >= 0 }),
  materials: field('list<string>', '已在 Vault 中的材料相对路径（.md 或媒体文件）。', { check: value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 1000) }),
  scriptPath: field('string', 'type: lesson 的备课页相对路径。', { check: text(1000) }),
  stage: field('string', '阶段分组名称，0..120字符；阶段不是独立课堂。', {check:value=>typeof value==='string'&&value.length<=120}),
  pathway: field('string', 'main 主线（默认）| remedial 条件补练 | extension 拓展；分支需显式 parentIndex。', {check:value=>ROUTE_PATHWAYS.includes(value)}),
  prerequisiteIndexes: field('list<number>', '知识先修的节点下标（0起）；指向本次lessons真实节点，不表示学生已经掌握。', {check:value=>Array.isArray(value)&&value.length<=100&&value.every(integer({max:99}))}),
  brief: field('string', '本课规划Markdown，0..12000字符：公开目标与任务，就近details教师理由、讲练梯度、检查及调整条件。保存到正文，不手写节点标记。', {check:value=>typeof value==='string'&&value.length<=12000}),
};

const REVISION_LESSON_FIELDS = {
  title: {...LESSON_FIELDS.title,required:false},
  stage: LESSON_FIELDS.stage,
  pathway: {...LESSON_FIELDS.pathway,description:'main | remedial | extension；分支需明确parentId作为接续来源。'},
  parentId: field('string|null','已读节点id作为直接前课；null表示独立起点，不更改身份。',{check:value=>value===null||text(200)(value)}),
  prerequisiteIds: field('list<string>','已读节点id数组；[]清空知识先修。不是掌握状态。',{check:value=>Array.isArray(value)&&value.length<=100&&value.every(text(200))}),
  materials: LESSON_FIELDS.materials,
  scriptPath: field('string|null','真实剧本路径；更新时null清除。',{check:value=>value===null||text(1000)(value)}),
  brief: LESSON_FIELDS.brief,
};
const UPDATE_LESSON_FIELDS={nodeId:field('string','当前路线里已读的真实节点id。',{required:true,check:text(200)}),...REVISION_LESSON_FIELDS};
const ADD_LESSON_FIELDS={...REVISION_LESSON_FIELDS,title:LESSON_FIELDS.title,scriptPath:LESSON_FIELDS.scriptPath};
const overviewField=field('string','课程总述Markdown，0..24000字符：终点、起点证据与未知项、范围、时间约束和教学主线；不手写Host节点标记。',{check:value=>typeof value==='string'&&value.length<=24000});

const COMMANDS = {
  'write-batch': {
    summary: '成批新建或精确修改 Markdown；逐文件原子保存与回执，部分失败不会撤销已成功项。普通资料用 vault_read/vault_search 读取检索，Bash 可用于高级组合检索。',
    write: true,
    fields: {
      files: field('list<object>', '1..50个不同路径，整批stdin最多2MiB。create仅新建(path/content)，edit精确替换(path/oldText/newText)，两分支不可混用；字段错误在整批写入前拒绝。', {
        required:true,check:value=>Array.isArray(value)&&value.length>=1&&value.length<=50,
        itemFields:{
          op:field('string','create | edit。create拒绝同名；edit要求原文恰好出现一次。',{required:true,check:value=>['create','edit'].includes(value)}),
          path:{...pathField('当前Vault内.md相对路径，不含vault/前缀；不能是点目录或模板。'),required:true},
          content:field('string','仅create必需：完整Markdown，最大2MiB。',{check:value=>typeof value==='string'&&Buffer.byteLength(value)<=BATCH_STDIN_LIMIT}),
          oldText:field('string','仅edit必需：已实际读过的精确原文，非空且必须唯一匹配。',{check:value=>typeof value==='string'&&value.length>0&&Buffer.byteLength(value)<=BATCH_STDIN_LIMIT}),
          newText:field('string','仅edit必需：替换正文，可为空以删除匹配段；其他部分原样保留。',{check:value=>typeof value==='string'&&Buffer.byteLength(value)<=BATCH_STDIN_LIMIT}),
        },
      }),
    },
    validate({files}) {
      const seen=new Set();
      for(const [index,item] of files.entries()) {
        const path=safeRelativePath(item.path);
        // Folder names compare as a case-insensitive file system stores them.
        const first=pathKey(path.split('/')[0]);
        if(!path.toLowerCase().endsWith('.md')||path.split('/').some(part=>part.startsWith('.')||pathKey(part)==='node_modules')||first==='_templates')throw new CliError('vault_path_invalid',`files[${index}].path`);
        if(first===pathKey(BOARD_DIRECTORY))throw new CliError('board_path_reserved',`files[${index}].path`);
        if(first===pathKey(USER_SKILL_DIRECTORY))throw new CliError('skill_path_reserved',`files[${index}].path`);
        if(seen.has(path))throw new CliError('batch_duplicate_path',`files[${index}].path`);
        seen.add(path);
        const required=item.op==='create'?['content']:['oldText','newText'];
        const forbidden=item.op==='create'?['oldText','newText']:['content'];
        for(const key of required)if(!Object.hasOwn(item,key))throw new CliError('cli_field_required',`files[${index}].${key}`);
        for(const key of forbidden)if(Object.hasOwn(item,key))throw new CliError('cli_field_unknown',`files[${index}].${key}`);
      }
    },
    result:'{results:[{path,op,saved,revision?,ref?,error?}],savedCount,failedCount}；部分失败顶层ok=false并退出1，成功项保留，只重试失败项。重复create不覆盖，重试已完成edit可能原文不再匹配；先回读判断。',
    example:'{"files":[{"op":"create","path":"知识/例.md","content":"# 例\\n正文\\n"},{"op":"edit","path":"卡片/基底.md","oldText":"原有理解。","newText":"原有理解。\\n新的真实修正。"}]}',
  },
  'skill-list': {
    summary: '列出学习集层（本 Vault 的 技能/）与学科层（全局）的 Skill：id、标题、说明、draft/active 与是否有待确认修订；不含正文。',
    write: false,
    fields: {},
    result: '{skills:[{scope:"set"|"global",id,name,title,description,status,revision,pending:{revision}|null,error?}]}',
    example: '{}',
  },
  'skill-read': {
    summary: '读取一份 Skill 的完整原文与版本；有待确认修订时一并返回修订原文。',
    write: false,
    fields: {
      scope: field('string', 'set（本学习集）| global（学科层）。', { required: true, check: value => value === 'set' || value === 'global' }),
      id: field('string', 'skill-list 返回的 id。', { required: true, check: text(48) }),
    },
    result: '{scope,id,status,content,revision,pending:{content,revision}|null}',
    example: '{"scope":"set","id":"conic-points"}',
  },
  'skill-save': {
    summary: '保存一份 Skill（完整 Markdown，页头 type: skill、id、title、description、status: draft）。新建即草稿；草稿按版本覆盖；已启用的 Skill 不改原文，只生成一份待学生确认的修订。',
    write: true,
    fields: {
      scope: field('string', 'set（本学习集的具体要点与教学提示）| global（学科共通的核心思想）。', { required: true, check: value => value === 'set' || value === 'global' }),
      content: field('string', '完整 Skill 原文，最多40000字符；status 必须是 draft。', { required: true, check: value => typeof value === 'string' && value.length > 0 && value.length <= 40000 }),
      expectedRevision: field('string', '改已有 Skill 时必填：skill-read 返回的 revision；已有待确认修订时填 pending.revision。', { check: text(64) }),
    },
    result: '{id,status,op:"create"|"edit"|"revision",revision}',
    example: '{"scope":"set","content":"---\\ntype: skill\\nid: conic-points\\ntitle: 解析几何要点\\ndescription: 本学习集解析几何题的方法要点与适用条件。\\nstatus: draft\\n---\\n# 解析几何要点\\n"}',
  },
  'route-outline': {
    summary: '读取路线节点导航、先修关系与真实revision；不读取每课规划正文，也不把有课堂记录当作已掌握。',
    write:false,
    fields:{
      path:{...pathField('路线Vault相对路径。'),required:true},
      expectedRevision:revisionField('可选：要求匹配已读版本。'),
      offset:field('number','起始节点下标，默认0。',{check:integer({max:10000})}),
      limit:field('number','最多节点数1..100，默认40。',{check:integer({min:1,max:100})}),
    },
    result:'{path,title,revision,ref,nodes[{id,title,parent,stage,pathway,prerequisites,materials,scriptPath?,opened,scheduledOn?,hasBrief}],total,nextOffset,bodyRead:false}',
    example:'{"path":"路线/迭代数列.md"}',
  },
  'lesson-outline': {
    summary: '只读剧本公共阶段目录，不读入教师正文；目录来自真实文件，不从截断快照推测。',
    write: false,
    fields: {
      path: { ...pathField('剧本 Vault 相对路径；跨集使用本课背景给出的 readPath。'), required: true },
      expectedRevision: revisionField('可选：要求匹配已读版本。'),
      offset: field('number', '目录起始条数，默认 0。', { check: integer({max:100000}) }),
      limit: field('number', '目录条数，1..100，默认 40。', { check: integer({min:1,max:100}) }),
    },
    result: '{path,readPath,title,revision,boundRevision,stale,sections[{key,title,lineFrom,lineTo,teacherCount}],total,nextOffset,bodyRead:false,warnings[]}',
    example: '{"path":"备课/迭代数列.md"}',
  },
  'lesson-section': {
    summary: '按版本读取一个阶段及其就近教师参考；长阶段明确返回 nextOffset，不提前读后续答案。',
    write: false,
    fields: {
      path: { ...pathField('lesson-outline 返回的 readPath。'), required: true },
      section: field('string', 'lesson-outline 返回的 key，如 section-2。', {required:true,check:text(100)}),
      expectedRevision: { ...revisionField('lesson-outline 返回的真实 revision。'), required: true },
      offset: field('number', '阶段内 Unicode 字符偏移，默认 0；续读照抄 nextOffset。', {check:integer({max:2000000})}),
      limit: field('number', '本次最多 Unicode 字符数，1..12000，默认 6000。', {check:integer({min:1,max:12000})}),
    },
    result: '{path,readPath,revision,section,sectionTitle,content,teacherCount,audience:"teacher",offset,total,nextOffset,truncated}',
    example: '{"path":"备课/迭代数列.md","section":"section-2","expectedRevision":"从目录读取的真实版本"}',
  },
  'review-queue': {
    summary: '查询当前工作区里可复习的卡片候选，返回真实路径、revision 与状态。',
    write: false,
    fields: {
      query: field('string', '按标题、路径或标签检索（可选）。', { check: text(2000) }),
      tag: field('string', '按标签筛选（可选）。', { check: text(200) }),
      status: field('string', 'all | due | pending | learning | familiar，默认 due。', { check: value => ['all', 'due', 'pending', 'learning', 'familiar'].includes(value) }),
      offset: field('number', '从第几条开始，默认 0。', { check: integer({ max: 10000 }) }),
      limit: field('number', '返回条数，1..200，默认 50。', { check: integer({ min: 1, max: 200 }) }),
    },
    result: '{hits[], counts, tags[], invalid[], total, nextOffset, truncated, unreadable, today}',
    example: '{"query":"向量","status":"due","limit":20}',
  },
  'record-review': {
    summary: '在一次真实回忆、作答或讲解之后记录评估；日期、记录 ID 与课堂身份由命令和环境变量补齐。',
    write: true,
    fields: {
      path: { ...pathField('卡片的 Vault 相对路径，如 卡片/基底.md。'), required: true },
      expectedRevision: { ...revisionField('刚读到的卡片 revision。'), required: true },
      keyStep: field('string', '1..200字符：检验的是哪一步，写这道题关键的思维步骤，如“用条件删掉不满足的情况，在剩下的等可能结果里数”。result 为 done 或 missed 时必填。', { check: ownedBy(validateKeyStep, 'keyStep') }),
      result: field('string', 'done | missed | unchecked：这次关键那一步学生有没有独立做出来。done=做出来（讲解之后在变式里独立做出来也算）；missed=学生试了、没做出来，或最后由老师点出了这一步；unchecked=这次没考（只有讲解、学生没试，说明里写“讲过”）。只有它决定复习档位：missed 让已在复习的卡降一档，done 在到期后升一档，unchecked 不动；还没开始复习的卡，done 或 missed 都从第1档开始。判断细则见 notara-method-distillation', { required: true, check: ownedBy(validateResult, 'result') }),
      note: field('string', '1..4000字符：学生具体完成了什么、老师给了哪些引导、据以判断的证据。本命令只追加评估；本轮有真实的尝试或转折时，先用 write-batch 在卡片正文的 `## 学生理解` 补上这一阶段，再记录评估', { required: true, check: ownedBy(validateReviewNote, 'note') }),
    },
    result: '{path, title, revision, ref, saved, state, scheduleChanged}；这次没考或提前做出来只记历史、不推迟到期。',
    example: '{"path":"卡片/两孩条件概率.md","expectedRevision":"0123456789abcdef01234567","keyStep":"用条件删掉不满足的情况，在剩下的等可能结果里数","result":"done","note":"先答 1/2，列出四种情况后自己改到 1/3；随后独立答对“已知老大是男孩”。"}',
    retired: { assessments: 'review_request_invalid', passed: 'review_request_invalid', depth: 'review_request_invalid', nextCheck: 'review_request_invalid' },
  },
  'undo-review': {
    summary: '撤销最近一次未撤销的评估，恢复它之前的档位；当前值已被外部改动时拒绝。',
    write: true,
    fields: {
      path: { ...pathField('卡片的 Vault 相对路径。'), required: true },
      expectedRevision: { ...revisionField('刚读到的卡片 revision。'), required: true },
    },
    result: '{path, title, revision, ref, saved, state}',
    example: '{"path":"卡片/基底.md","expectedRevision":"0123456789abcdef01234567"}',
  },
  calendar: {
    summary: '按 from/to 投影路线安排、课堂小结、日记与到期卡片。',
    write: false,
    fields: {
      from: field('string', '起始日期 YYYY-MM-DD。', { required: true, check: day }),
      to: field('string', '结束日期 YYYY-MM-DD，不早于 from，跨度不超过一年。', { required: true, check: day }),
      timeZone: field('string', 'IANA 时区名；省略则按当前进程时区。', { check: text(100) }),
    },
    result: '{from, to, today, timeZone, events[], routes[{path,title,revision,nodes[]}], invalid[], truncated, unreadable}; routes也含尚未排期的节点，供schedule-lesson取得当前revision',
    example: '{"from":"2026-09-22","to":"2026-09-29","timeZone":"Asia/Shanghai"}',
  },
  'lesson-log': {
    summary: '查询课堂小结索引，可回到剧本内小结或独立小结。',
    write: false,
    fields: {
      from: field('string', '起始日期 YYYY-MM-DD（可选）。', { check: day }),
      to: field('string', '结束日期 YYYY-MM-DD（可选）。', { check: day }),
      subject: field('string', '按真实科目筛选（可选）。', { check: text(200) }),
      query: field('string', '按标题、正文或续学点检索（可选）。', { check: text(2000) }),
      offset: field('number', '从第几条开始，默认 0。', { check: integer({ max: 10000 }) }),
      limit: field('number', '返回条数，1..100，默认 20。', { check: integer({ min: 1, max: 100 }) }),
    },
    result: '{hits[], nextOffset, total, truncated, unreadable}',
    example: '{"from":"2026-09-01","to":"2026-09-30","subject":"数学"}',
  },
  'create-route': {
    summary: '新建学习路线，节点身份由命令生成；已写好的剧本用 scriptPath 指向真实文件。',
    write: true,
    fields: {
      title: field('string', '路线标题，1..200 字符。', { required: true, check: text(200) }),
      overview: overviewField,
      lessons: field('list<object>', '节点数组，1..100项；支持阶段、主线/分支、先修、资料与本课规划。精确字段见itemFields；主线省略parentIndex时接上一个主线。', { required: true, check: value => Array.isArray(value)&&value.length>0&&value.length<=100, itemFields:LESSON_FIELDS }),
    },
    result: '{path,title,revision,ref,nodes[]}; 节点身份由命令生成，后续局部调整使用返回或实际读取的id',
    example: '{"title":"向量学习路线","lessons":[{"title":"理解基底","materials":["知识/向量.md"]},{"title":"坐标例题","parentIndex":0,"scriptPath":"备课/坐标例题.md"}]}',
  },
  'revise-route': {
    summary: '按真实课堂依据局部更新未来课程或增加节点，保留已绑定课堂、日期和历史。所有校验通过后单次CAS写入。',
    write: true,
    fields: {
      path:{...pathField('已读路线的Vault相对路径。'),required:true},
      expectedRevision:{...revisionField('刚读到的真实路线revision。'),required:true},
      reason:field('string','本次为何调整，引用实际作答或小结依据；单行1..2000字符。日期由命令写入。',{required:true,check:value=>text(2000)(value)&&!/[\r\n]/.test(value)}),
      overview:overviewField,
      updates:field('list<object>','更新未开课的既有节点；省略字段保留，[]清空数组，parentId/scriptPath可null清除。不能改sessionId或scheduledOn。',{check:value=>Array.isArray(value)&&value.length<=100,itemFields:UPDATE_LESSON_FIELDS}),
      additions:field('list<object>','新增课堂，身份由程序生成；默认main接最后一个主线，补练/拓展须显式parentId。需要引用新节点时，先保存取得id再调整。',{check:value=>Array.isArray(value)&&value.length<=100,itemFields:ADD_LESSON_FIELDS}),
    },
    result:'{path,title,revision,ref,saved,changed?,added?}; 无变化不追加日志，拒绝已开课节点的覆盖',
    example:'{"path":"路线/迭代数列.md","expectedRevision":"从实际文件读取的版本","reason":"本课独立任务能证明有界，但仍需提示才能选择工具，先补一次比较。","additions":[{"title":"比较两种选路","pathway":"remedial","parentId":"从路线读取的节点id","brief":"## 目标与任务\\n先比较适用条件，再独立选择方法。"}]}',
  },
  'schedule-lesson': {
    summary: '把用户给出的日期写到已有路线节点上；date 为 null 清除安排。不自动开课或标完成。',
    write: true,
    fields: {
      path: { ...pathField('路线文件的 Vault 相对路径。'), required: true },
      expectedRevision: { ...revisionField('刚读到的路线 revision。'), required: true },
      nodeId: field('string', '路线文件中真实存在的节点 id。', { required: true, check: text(200) }),
      date: field('string|null', '用户明确给出的排课日期 YYYY-MM-DD，或 null 清除。', { required: true, check: value => value === null || day(value) }),
    },
    result: '{path, title, revision, ref, saved}',
    example: '{"path":"路线/向量学习路线.md","expectedRevision":"0123456789abcdef01234567","nodeId":"真实节点","date":"2026-09-25"}',
  },
  'pdf-outline': {
    summary: '只读 PDF 书签目录与印刷页标签，将直接或命名目标解析成真实的物理页；无书签时明确提示，不假造章节。文件上限 512 MiB。',
    write: false,
    fields: { path: { ...pathField('PDF 的 Vault 相对路径。'), required: true } },
    result: '{path,title,revision,ref,pageCount,pageLabels?,items[{title,page:number|null,pageLabel?,items[]}],truncated,warnings[]}; page从1起，pageLabel只是印刷标签；未能解析的目标为null',
    example: '{"path":"媒体/向量讲义.pdf"}',
  },
  'pdf-page': {
    summary: '按物理页读 PDF（上限 512 MiB），返回文字层、页数、真实 revision 和页图；文字层可能缺字或乱码，以原页图为准。小字或公式优先裁剪区域，图像长边最多 2048 像素。',
    write: false,
    fields: {
      path: { ...pathField('PDF 的 Vault 相对路径，如 媒体/向量讲义.pdf。'), required: true },
      page: field('number', '1 起的真实页码。', { required: true, check: integer({ min: 1, max: 1000000 }) }),
      rect: field('number[4]', '可选的归一化区域 [x, y, width, height]，0..1，左上原点，区域不能超出页面。', { check: value => Array.isArray(value) && value.length === 4 && value.every(item => Number.isFinite(item) && item >= 0 && item <= 1) && value[2] > 0 && value[3] > 0 && value[0]+value[2] <= 1+1e-9 && value[1]+value[3] <= 1+1e-9 }),
      scale: field('number', '可选渲染比例 0.2..3（像素/PDF单位）；默认按长边2048自动计算，指定比例仍受长边上限约束。', { check: value=>Number.isFinite(value)&&value>=0.2&&value<=3 }),
    },
    result: '{path, page, pageCount, text, revision, imagePath, imageWidth, imageHeight, renderScale, locator, embed, warnings}; embed可直接写入资料节点，区域仍需看裁切图核对，实际模型尺寸取决于图像路线',
    example: '{"path":"媒体/向量讲义.pdf","page":2}',
  },
  'source-cards': {
    summary: '按引用位置列出已从某份资料拆出的卡片：PDF 按页（含选区与还没有卡的页），视频/音频按时间段，图片按区域，Markdown/HTML 按锚点；没带位置的引用单列。拆书或补卡前用它核对，不按文件名判断。',
    write: false,
    fields: {
      path: { ...pathField('资料的 Vault 相对路径：PDF、视频、图片等原件（如 媒体/向量讲义.pdf），或资料页（如 知识/向量讲义.md，同时核对它嵌入的原件）。'), required: true },
      pageRange: field('number[2]', 'PDF的物理页范围 [起页,止页]，两端包含，每次最多10,000页；不改变全书页数，未给出则检查全书（全书超过10,000页时须指定范围）。', { check: value=>Array.isArray(value)&&value.length===2&&value.every(integer({min:1,max:1000000}))&&value[0]<=value[1]&&value[1]-value[0]<10000 }),
    },
    result: '{path, targets[{path,kind,revision?,pageCount?,pages?[{page,cards[{path,rect?,annotationId?,otherRevision?}]}],uncoveredPages?,ranges?,regions?,anchors?,wholeFile[],invalid[]}], cards[{path,title,type,parent,state,stateError?}], materials[{path,title,type,uncitedCards[]}], truncated, unreadable}; uncitedCards 是专题/源目录名下没带这份资料出处的卡，要读正文核对；一页有卡不等于这页每道题都有卡，整页引用要看标题或题干对上；otherRevision 是引用了旧版本，不算空缺',
    example: '{"path":"知识/向量讲义.md"}',
  },
};

const COMMAND_NAMES = Object.keys(COMMANDS);

/** The same single schema powers `--help`, unknown-field rejection and typing. */
function commandHelp(name) {
  const spec = COMMANDS[name];
  const fields = {};
  for (const [key, item] of Object.entries(spec.fields)) {
    fields[key] = {
      type: item.type,
      required: Boolean(item.required),
      description: item.description,
      ...(item.itemFields ? { itemFields: Object.fromEntries(Object.entries(item.itemFields).map(([name,schema])=>[name,{type:schema.type,required:!!schema.required,description:schema.description}])) } : {}),
    };
  }
  return {
    command: name,
    summary: spec.summary,
    write: spec.write,
    stdin: { fields, additionalProperties: false },
    rejects: ['workspace', 'sessionId', 'actor', 'date（记录时间）', 'id', '任何 help 未列出的字段'],
    generatedByCommand: ['记录时间与日期', '记录 ID', '节点身份', '工作区与会话身份'],
    result: spec.result,
    example: spec.example,
    usage: ['"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" ' + name, '"$DSH_NOTARA_NODE" "$DSH_NOTARA_CLI" ' + name + ' --help'],
  };
}

function usage() {
  return {
    program: 'DSH_NOTARA_CLI',
    summary: '原生 Vault 的确定性命令入口：成批保存、阶段化读剧本、复习、日历、课堂小结索引、路线规划/修订与排课、按页读 PDF。',
    readsStdin: '只有运行具体命令时才读 stdin；help 与 --help 不读也不等待。',
    environment: {
      DSH_NOTARA_NODE: 'Node 可执行文件（由 Host 注入）。',
      DSH_NOTARA_CLI: '本文件路径（由 Host 注入）。',
      DSH_NOTARA_WORKSPACE: '真实课堂工作区根。',
      DSH_NOTARA_WORKSPACE_ID: '该工作区的注册 id。',
      DSH_SESSION_ID: '本次原生课堂身份。',
      DSH_NOTARA_CALL_ID: '本次调用身份，用于记录的幂等。',
      DSH_NOTARA_LESSON: 'Host 给出的绑定剧本位置与版本；不由模型填写或修改。',
      DSH_NOTARA_TEACHING: '当前安装的教学资源目录；可按需读取配套样板，不是学生资料目录。',
    },
    standalone: '没有绑定环境时，只允许用户显式执行 --workspace <绝对路径>；此时 actor=self、session 为空。没有根则失败，绝不猜测工作目录。',
    boundaries: [
      'write-batch只处理Markdown成批保存与唯一原文匹配；课堂普通资料读取搜索可用vault_read/vault_search，Bash可用于高级组合检索。',
      '命令不接受 workspace/sessionId/actor/记录时间/id 等身份字段，新时间、日期与记录 ID 由程序生成。',
      '领域命令修改文件需expectedRevision；write-batch精确匹配已读原文后使用实际revision保存。新建拒绝重名，冲突不覆盖。',
    ],
    commands: Object.fromEntries(COMMAND_NAMES.map(name => [name, { summary: COMMANDS[name].summary, write: COMMANDS[name].write }])),
    help: ['help', '<command> --help'],
  };
}

/* ------------------------------------------------------------------ parser */

function takeWorkspace(argv) {
  let root = null;
  const rest = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--workspace') {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new CliError('cli_usage_invalid');
      root = next;
      index += 1;
      continue;
    }
    if (value.startsWith('--workspace=')) {
      root = value.slice('--workspace='.length);
      continue;
    }
    rest.push(value);
  }
  return { root, rest };
}

function parseArgs(rest) {
  const command = rest[0];
  if (command === undefined) return { mode: 'help' };
  if (command === 'help' || command === '--help' || command === '-h') return { mode: 'help', command: rest[1] };
  const extra = rest.slice(1);
  if (extra.length === 0) return { mode: 'run', command };
  if (extra.length === 1 && ['--help', '-h'].includes(extra[0])) return { mode: 'help', command };
  throw new CliError('cli_usage_invalid');
}

async function readStdin(limit=STDIN_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > limit) throw new CliError('cli_stdin_too_large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  let value;
  try { value = JSON.parse(text); } catch { throw new CliError('cli_stdin_invalid'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CliError('cli_stdin_invalid');
  return value;
}

/** Unknown fields, missing required fields and type errors fail before any
 * workspace or file is touched, so a bad call can never write. */
function validateArgs(command, raw) {
  const spec = COMMANDS[command];
  // A retired field names the current format instead of reading as a typo.
  const retired = Object.keys(raw).find(key => Object.hasOwn(spec.retired ?? {}, key));
  if (retired) throw new CliError(spec.retired[retired], retired);
  const unknown = Object.keys(raw).filter(key => !Object.hasOwn(spec.fields, key));
  if (unknown.length) throw new CliError('cli_field_unknown', unknown.join(', '));
  const args = {};
  for (const [key, item] of Object.entries(spec.fields)) {
    if (!Object.hasOwn(raw, key)) {
      if (item.required) throw new CliError('cli_field_required', key);
      continue;
    }
    const value = raw[key];
    if (item.check && !item.check(value)) throw new CliError('cli_field_invalid', key);
    args[key] = value;
  }
  for (const [fieldName, specField] of Object.entries(spec.fields)) {
    if (!specField.itemFields || args[fieldName]===undefined) continue;
    args[fieldName] = args[fieldName].map((lesson, index) => {
      if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) throw new CliError('cli_field_invalid', `${fieldName}[${index}]`);
      const unknownLesson = Object.keys(lesson).filter(key => !Object.hasOwn(specField.itemFields, key));
      if (unknownLesson.length) throw new CliError('cli_field_unknown', `${fieldName}[${index}].${unknownLesson.join(',')}`);
      const value = {};
      for (const [key, item] of Object.entries(specField.itemFields)) {
        if (lesson[key] === undefined) {
          if (item.required) throw new CliError('cli_field_required', `${fieldName}[${index}].${key}`);
          continue;
        }
        if (item.check && !item.check(lesson[key])) throw new CliError('cli_field_invalid', `${fieldName}[${index}].${key}`);
        value[key] = lesson[key];
      }
      return value;
    });
  }
  spec.validate?.(args);
  return args;
}

/* ------------------------------------------------------------------ workspace */

async function resolveWorkspace(root) {
  if (typeof root !== 'string' || !root.length || !isAbsolute(root) || root.includes('\0')) throw new CliError('cli_workspace_required');
  let info;
  try { info = await lstat(root); } catch { throw new CliError('cli_workspace_invalid'); }
  if (info.isSymbolicLink() || !info.isDirectory()) throw new CliError('cli_workspace_invalid');
  return realpath(root);
}

/** The only services the Vault IO seam needs. The Host process already owns a
 * real LocalFileSystem; the CLI attaches one lazily for standalone runs. */
function contextFor(fs, registry) {
  return { fs, get: name => (name === 'workspaceRegistry' ? registry : undefined) };
}

/* ------------------------------------------------------------------ commands */

function addRefs(hits, workspaceId) {
  return hits.map(hit => (hit.ref ? hit : { ...hit, ref: sourceRef(workspaceId, hit.path, hit.revision, hit.anchor ? { anchor: hit.anchor } : undefined) }));
}

async function runCommand(command, args, { fs, root, env, signal, io:providedIO, context:providedContext, exec:providedExec, inlineMedia=false }) {
  // `root` is already resolved and symlink-checked by the caller.
  const workspacePath = root;
  const bound = typeof env.DSH_NOTARA_WORKSPACE === 'string' && env.DSH_NOTARA_WORKSPACE.length > 0;
  const workspaceId = typeof env.DSH_NOTARA_WORKSPACE_ID === 'string' && env.DSH_NOTARA_WORKSPACE_ID ? env.DSH_NOTARA_WORKSPACE_ID : workspacePath;
  const sessionId = bound && typeof env.DSH_SESSION_ID === 'string' && env.DSH_SESSION_ID ? env.DSH_SESSION_ID : null;
  const callId = typeof env.DSH_NOTARA_CALL_ID === 'string' && env.DSH_NOTARA_CALL_ID ? env.DSH_NOTARA_CALL_ID : null;
  if(bound&&(!sessionId||!callId||!env.DSH_NOTARA_WORKSPACE_ID))throw new CliError('cli_context_missing');

  const workspace = { id: workspaceId, path: workspacePath, title: basename(workspacePath) || '学习笔记' };
  const registry = { list: () => [workspace] };
  const ctx = providedContext??contextFor(fs, registry);
  const io = providedIO??createEditorVaultIO(ctx, workspacePath, signal);
  const standalone = !bound;
  // A real Host session makes the write a teacher action whose source is bound
  // to this session and call. The workspace path is the Host-injected cwd, not a
  // model argument, so the scope guard cannot be redirected from stdin. Without
  // a session the same writer runs as the standalone actor `self`.
  const exec = providedExec??(sessionId
    ? { agent: { session: { id: sessionId, header: { cwd: workspacePath } } }, callId, signal: signal ?? new AbortController().signal }
    : null);
  const review = createReviewRuntime({ ctx, editorFor: async () => io });
  if(command==='write-batch')return writeBatch(io,args.files);
  if(command.startsWith('skill-'))return skillCommand(command,args,{workspacePath,env});

  if (command === 'lesson-outline' || command === 'lesson-section') {
    let pin = null, lessonIO = io, path = args.path;
    if (bound && env.DSH_NOTARA_LESSON) {
      try { pin = JSON.parse(env.DSH_NOTARA_LESSON); } catch { throw new CliError('cli_context_missing'); }
      if (!pin || typeof pin.workspacePath !== 'string' || typeof pin.workspaceId !== 'string' || typeof pin.path !== 'string' || (pin.revision!==null && typeof pin.revision !== 'string') || (pin.bodyRevision!==undefined && typeof pin.bodyRevision !== 'string')) throw new CliError('cli_context_missing');
    }
    // Absolute paths are accepted only for the explicitly bound script. All
    // other CLI operations still read only the current registered workspace.
    const pinnedAbsolute = pin ? resolve(resolveVaultRoot(pin.workspacePath), pin.path) : null;
    if (isAbsolute(path)) {
      if (!pin || resolve(path) !== pinnedAbsolute) throw new CliError('vault_path_invalid');
      const pinnedRoot=await resolveWorkspace(pin.workspacePath);
      const pinnedWorkspace={id:pin.workspaceId,path:pinnedRoot,title:basename(pinnedRoot)};
      lessonIO=createEditorVaultIO(contextFor(fs,{list:()=>[pinnedWorkspace]}),pinnedRoot);
      path=pin.path;
    }
    const selectedPin = pin && resolve(resolveVaultRoot(lessonIO.workspace.path),path) === pinnedAbsolute ? pin : null;
    const document=await lessonIO.read(path,args.expectedRevision);
    const stale=scriptBindingStale({revision:selectedPin?.revision,bodyRevision:selectedPin?.bodyRevision},document);
    if(command==='lesson-section'&&stale)throw new CliError('lesson_script_rebind_required');
    const result=command==='lesson-outline'?lessonOutline(document,args):readLessonStage(document,args);
    return {...result,readPath:args.path,boundRevision:selectedPin?.revision??null,stale,workspaceId:lessonIO.workspace.id,standalone};
  }

  if (command === 'review-queue') {
    const result = await review.queue(args,exec);
    return { ...result, hits: addRefs(result.hits, workspace.id), workspaceId: workspace.id, standalone };
  }
  if (command === 'record-review') {
    const result = await review.record(args, exec ?? undefined);
    return { ...result, workspaceId: workspace.id, actor: exec ? 'teacher' : 'self', sessionId: exec ? sessionId : null, standalone };
  }
  if (command === 'undo-review') {
    const result = await review.undo(args);
    return { ...result, workspaceId: workspace.id, standalone };
  }
  if (command === 'calendar') {
    const result = await review.calendar(args,exec);
    return { ...result, workspaceId: workspace.id, standalone };
  }
  if (command === 'lesson-log') {
    const scan = await io.scan();
    const result = lessonLog(scan.documents, args);
    return { ...result, hits: addRefs(result.hits, workspace.id), truncated: scan.truncated, unreadable: scan.errors.length, workspaceId: workspace.id, standalone };
  }
  if (command === 'route-outline') {
    const document=await io.read(args.path,args.expectedRevision),route=parseRoute(document),offset=args.offset??0,limit=args.limit??40;
    const nodes=route.nodes.slice(offset,offset+limit).map(node=>({id:node.id,title:node.title,parent:node.parent,stage:node.stage??'',pathway:node.pathway??'main',prerequisites:node.prerequisites??[],materials:node.materials,scriptPath:node.scriptPath??null,opened:!!node.sessionId,scheduledOn:node.scheduledOn??null,hasBrief:!!node.brief}));
    return {path:document.path,title:route.title,revision:document.revision,ref:document.ref,nodes,total:route.nodes.length,nextOffset:offset+nodes.length<route.nodes.length?offset+nodes.length:null,bodyRead:false,workspaceId:workspace.id,standalone};
  }
  if (command === 'create-route') {
    const result = await createRouteInVault(io, args);
    return { ...result, workspaceId: workspace.id, standalone };
  }
  if (command === 'revise-route') {
    const result = await reviseRouteInVault(io,args);
    return {...result,workspaceId:workspace.id,standalone};
  }
  if (command === 'schedule-lesson') {
    const result = await review.schedule(args,exec);
    return { ...result, workspaceId: workspace.id, standalone };
  }
  if (command === 'pdf-page') {
    return await pdfPage(io, args, workspacePath, workspace.id, standalone,inlineMedia);
  }
  if (command === 'pdf-outline') {
    const asset=await io.readAsset(args.path);
    if(asset.assetKind!=='pdf')throw new CliError('vault_media_not_supported');
    const {readPdfOutline}=await import('./agent-media.js');
    return {path:asset.path,title:asset.title,revision:asset.revision,ref:asset.ref,...await readPdfOutline(asset.pdfSource??asset.bytes,{signal:io.signal}),workspaceId:workspace.id,standalone};
  }
  if (command === 'source-cards') {
    return { ...(await sourceCards(io, args.path,args.pageRange)), workspaceId: workspace.id, standalone };
  }
  throw new CliError('cli_command_unknown');
}

/* ------------------------------------------------------------------ source cards */

// Which cards were lifted from a material, found by where their embeds point —
// the same parse the graph uses for its split edges, so this table and the
// graph never disagree. A file name is never evidence of coverage.
const SOURCE_TARGET_LIMIT = 10;
const LOCATOR_KINDS = { pdf: ['pdf-page', 'pdf-region'], video: ['video-time'], audio: ['video-time'], image: ['image-region'], html: ['html-range'], page: ['html-range'], file: [] };
const byText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

async function sourceCards(io, rawPath,pageRange) {
  let path;
  try { path = safeRelativePath(rawPath); } catch { throw new CliError('vault_path_invalid', 'path'); }
  const scan = await io.scan();
  const known = new Set(scan.files.map(row => row.path));
  if (!known.has(path)) throw new CliError('vault_file_not_found', 'path');
  const assets = scan.files.filter(row => row.kind === 'asset').map(row => ({ path: row.path, title: row.title, assetKind: mediaForPath(row.path).kind }));
  const graph = buildVaultGraph(scan.documents, assets);
  const nodes = new Map(graph.nodes.map(node => [node.path, node]));
  const documents = new Map(scan.documents.map(document => [document.path, document]));
  // A material page is checked together with the originals it embeds (a chapter note and its PDF).
  const page = documents.get(path);
  const embedded = page ? [...new Set((nodes.get(path)?.sources ?? []).map(source => source.path))].filter(target => target !== path && known.has(target) && !documents.has(target)) : [];
  const targets = [path, ...embedded].slice(0, SOURCE_TARGET_LIMIT);
  const cardNodes = graph.nodes.filter(node => node.kind === 'page' && KNOWLEDGE_CARD_TYPES.has(node.type));
  const used = new Set(),allCited=new Set();
  if(pageRange&&!targets.some(target=>mediaForPath(target).kind==='pdf'))throw new CliError('vault_media_not_supported','pageRange');

  const results = [];
  for (const target of targets) {
    const kind = documents.has(target) ? 'page' : mediaForPath(target).kind;
    const allowed = new Set(LOCATOR_KINDS[kind] ?? []);
    const located = [], wholeFile = new Set(), invalid = new Set();
    for (const node of cardNodes) {
      if (node.path === target) continue;
      const refs = node.sources.filter(source => source.path === target);
      const linked = documents.get(node.path)?.links.includes(target) ?? false;
      if (!refs.length && !linked) continue;
      allCited.add(node.path);
      if(kind==='pdf'&&pageRange&&refs.length&&refs.every(ref=>!ref.invalidLocator&&allowed.has(ref.locator?.kind)&&(ref.locator.page<pageRange[0]||ref.locator.page>pageRange[1])))continue;
      used.add(node.path);
      let placed = false;
      for (const ref of refs) {
        if (ref.invalidLocator || (ref.locator && !allowed.has(ref.locator.kind))) { invalid.add(node.path); continue; }
        if(kind==='pdf'&&pageRange&&ref.locator&&(ref.locator.page<pageRange[0]||ref.locator.page>pageRange[1]))continue;
        if (ref.locator) { located.push({ card: node.path, locator: ref.locator }); placed = true; }
      }
      if (!placed && !invalid.has(node.path)) wholeFile.add(node.path);
    }
    const entry = { path: target, kind };
    if (kind === 'pdf') Object.assign(entry, await pdfCoverage(io, target, located,pageRange));
    else if (kind === 'video' || kind === 'audio') entry.ranges = located.map(({ card, locator }) => ({ path: card, startMs: locator.startMs, ...(locator.endMs === undefined ? {} : { endMs: locator.endMs }) })).sort((left, right) => left.startMs - right.startMs || byText(left.path, right.path));
    else if (kind === 'image') entry.regions = located.map(({ card, locator }) => ({ path: card, rect: locator.rect }));
    else if (kind === 'page' || kind === 'html') {
      const anchors = new Map();
      for (const { card, locator } of located) { const list = anchors.get(locator.anchor) ?? []; if (!list.includes(card)) list.push(card); anchors.set(locator.anchor, list); }
      entry.anchors = [...anchors].map(([anchor, cards]) => ({ anchor, cards: cards.sort(byText) }));
      if (kind === 'page') entry.revision = documents.get(target).revision;
    }
    entry.wholeFile = [...wholeFile].sort(byText);
    entry.invalid = [...invalid].sort(byText);
    results.push(entry);
  }

  const cards = [...used].sort(byText).map(cardPath => {
    const node = nodes.get(cardPath), document = documents.get(cardPath);
    const row = { path: cardPath, title: node.title, type: node.type, parent: node.parent ?? null, revision: node.revision };
    if (node.type !== 'card') return row;
    try { return { ...row, state: reviewState(document) }; }
    catch (error) { return { ...row, state: null, stateError: error.message }; }
  });
  // 专题与源目录也引用了这份资料。它们名下不带这份资料出处的卡，引用查不到，单独列出来读正文核对。
  const targetSet = new Set(targets);
  const materials = graph.nodes
    .filter(node => node.kind === 'page' && MATERIAL_TYPES.has(node.type) && !targetSet.has(node.path) && (node.sources.some(source => targetSet.has(source.path)) || (documents.get(node.path)?.links ?? []).some(link => targetSet.has(link))))
    .map(node => ({ path: node.path, title: node.title, type: node.type, uncitedCards: childCardsOf(graph, node.path).map(child => child.path).filter(child => !allCited.has(child)).sort(byText) }))
    .sort((left, right) => byText(left.path, right.path));
  return { path, targets: results, cards, materials, truncated: scan.truncated, unreadable: scan.errors.length };
}

/** Every page of the PDF that a card cites, and the pages none does. A citation
 * pinned to another revision still names this material: it is marked, never
 * counted as a gap, and never taken as a position in the current version. */
async function pdfCoverage(io, path, located,pageRange) {
  const asset = await io.readAsset(path);
  let pageCount = null, pageCountError;
  try {
    const { readPdfPageCount } = await import('./agent-media.js');
    pageCount = await readPdfPageCount(asset.pdfSource??asset.bytes,{signal:io.signal});
  } catch (error) { pageCountError = error.message; }
  if(!pageRange&&pageCount>10000)throw new CliError('pdf_page_range_required','pageRange');
  if(pageRange&&(pageCount===null||pageRange[1]>pageCount))throw new CliError(pageCountError??'pdf_page_invalid','pageRange');
  const pages = new Map();
  for (const { card, locator } of located) {
    const list = pages.get(locator.page) ?? [];
    list.push({
      path: card,
      ...(locator.kind === 'pdf-region' ? { rect: locator.rect } : {}),
      ...(locator.annotationId ? { annotationId: locator.annotationId } : {}),
      ...(locator.revision && locator.revision !== asset.revision ? { otherRevision: locator.revision } : {}),
    });
    pages.set(locator.page, list);
  }
  const covered = [...pages.keys()].sort((left, right) => left - right);
  return {
    revision: asset.revision,
    pageCount,
    ...(pageRange?{pageRange}:{}),
    ...(pageCountError ? { pageCountError } : {}),
    pages: covered.map(number => ({ page: number, cards: pages.get(number).sort((left, right) => byText(left.path, right.path)) })),
    ...(pageCount === null ? {} : { uncoveredPages: Array.from({ length: pageRange?pageRange[1]-pageRange[0]+1:pageCount }, (_, index) => index+(pageRange?.[0]??1)).filter(number => !pages.has(number)) }),
  };
}

/* ------------------------------------------------------------------ pdf */

// A batch is intentionally not a multi-file transaction. Each write uses the
// existing native CAS seam and reports its own result, so retries stay local.
function skillRoot(scope,{workspacePath,env}) {
  if(scope==='set')return setSkillRoot(workspacePath);
  const root=globalSkillRoot(env);
  if(!root)throw new CliError('skill_scope_unavailable');
  return root;
}
async function skillCommand(command,args,context) {
  if(command==='skill-list'){
    const scopes=[['set',setSkillRoot(context.workspacePath)],['global',globalSkillRoot(context.env)]].filter(([,root])=>root);
    const skills=[];
    for(const [scope,root] of scopes)for(const row of await readUserSkills(root,scope)){
      const {body:_body,pending,...rest}=row;
      skills.push({...rest,pending:pending?{revision:pending.revision}:null});
    }
    return {skills};
  }
  const root=skillRoot(args.scope,context);
  if(command==='skill-save')return saveUserSkill(root,{content:args.content,expectedRevision:args.expectedRevision});
  const {readFile}=await import('node:fs/promises');
  const read=async name=>{try{return await readFile(join(root,name),'utf8');}catch(error){if(error?.code==='ENOENT')return null;throw error;}};
  const content=await read(`${args.id}.md`);
  if(content===null)throw new CliError('skill_not_found');
  const [row]=(await readUserSkills(root,args.scope)).filter(item=>item.id===args.id);
  const pending=await read(`${args.id}.revision.md`);
  return {scope:args.scope,id:args.id,status:row?.status??null,content,revision:revisionFor(content),pending:pending===null?null:{content:pending,revision:revisionFor(pending)}};
}

async function writeBatch(io,files) {
  const results=[];
  for(const item of files) {
    try {
      let content=item.content,revision=null;
      if(item.op==='edit') {
        const current=await io.read(item.path);
        // A file checked out or saved on Windows may use CRLF while the teacher
        // quotes it with LF: match and replace in the file's own line endings.
        const crlf=current.content.includes('\r\n')&&!item.oldText.includes('\r');
        const oldText=crlf?item.oldText.replace(/\n/g,'\r\n'):item.oldText,newText=crlf?item.newText.replace(/\r?\n/g,'\r\n'):item.newText;
        const at=current.content.indexOf(oldText);
        if(at<0||current.content.indexOf(oldText,at+1)>=0)throw new CliError('batch_original_mismatch');
        content=current.content.slice(0,at)+newText+current.content.slice(at+oldText.length);
        revision=current.revision;
      }
      const saved=await io.save(item.path,content,revision);
      results.push({path:item.path,op:item.op,saved:true,revision:saved.revision,ref:sourceRef(io.workspace.id,saved.path,saved.revision)});
    }catch(error){results.push({path:item.path,op:item.op,saved:false,error:describe(error)});}
  }
  return {results,savedCount:results.filter(item=>item.saved).length,failedCount:results.filter(item=>!item.saved).length};
}

const MEDIA_CACHE_DIR = '.notara-cache';
const MEDIA_CACHE_FILES = 'media';

function cacheName(path, page, rect, revision,scale) {
  const key = `${path}\u0000${revision}\u0000${page}\u0000${rect ? rect.join(',') : ''}\u0000edge2048:${scale??'auto'}`;
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 16);
  const stem = (basename(path).replace(/\.pdf$/i, '') || 'page').replace(/[^0-9A-Za-z\u4e00-\u9fff_-]/g, '-').slice(0, 40) || 'page';
  return `${stem}-${digest}-p${page}.png`;
}

/** Write one generated PNG under `<workspace>/.notara-cache/media/`. The cache
 * lives outside the Vault so it never becomes material, and every path level is
 * checked for symlinks so a generated image cannot be redirected elsewhere. */
async function writeMediaCache(root, name, bytes) {
  const base = join(root, MEDIA_CACHE_DIR);
  let info;
  try { info = await lstat(base); } catch { info = null; }
  if (info && (info.isSymbolicLink() || !info.isDirectory())) throw new CliError('vault_path_invalid');
  if (!info) await mkdir(base, { recursive: true });
  const baseReal = await realpath(base);
  const directory = join(base, MEDIA_CACHE_FILES);
  let directoryInfo;
  try { directoryInfo = await lstat(directory); } catch { directoryInfo = null; }
  if (directoryInfo && (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory())) throw new CliError('vault_path_invalid');
  if (!directoryInfo) await mkdir(directory, { recursive: true });
  const absolute = join(directory, name);
  const temporary = `${absolute}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, absolute);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const real = await realpath(absolute);
  const realDirectory = await realpath(directory);
  if (dirname(real) !== realDirectory || !(await lstat(baseReal)).isDirectory()) throw new CliError('vault_path_invalid');
  return real;
}

async function pdfPage(io, args, workspacePath, workspaceId, standalone,inlineMedia=false) {
  // Heavy PDF/image decoders are only loaded for this command, never for the
  // text-only ones.
  const { readPdfPage } = await import('./agent-media.js');
  const asset = await io.readAsset(args.path);
  if (asset.assetKind !== 'pdf') throw new CliError('vault_media_not_supported');
  const locator={kind:args.rect?'pdf-region':'pdf-page',page:args.page,...(args.rect?{rect:args.rect.map(number=>Math.round(number*1_000_000)/1_000_000)}:{}),revision:asset.revision};
  const embed=embedTarget(asset.path,locator);
  if(parseMediaTarget(embed.slice(3,-2)).invalidLocator)throw new CliError('pdf_region_invalid');
  const value = await readPdfPage(asset.pdfSource??asset.bytes, { page: args.page, rect: args.rect,scale:args.scale,signal:io.signal });
  const imagePath = inlineMedia?undefined:await writeMediaCache(workspacePath, cacheName(args.path, value.page, args.rect, asset.revision,args.scale), Buffer.from(value.image.data, 'base64'));
  return {
    ok: true,
    path: asset.path,
    title: asset.title,
    page: value.page,
    pageCount: value.pageCount,
    text: value.text,
    revision: asset.revision,
    imageWidth:value.image.width,imageHeight:value.image.height,renderScale:value.image.scale,
    ...(inlineMedia?{imageData:value.image.data,imageMimeType:value.image.mimeType??'image/png'}:{imagePath}),
    locator,
    embed,
    warnings: value.warnings,
    workspaceId,
    standalone,
  };
}

/* ------------------------------------------------------------------ process */

function write(value, stream) {
  stream.write(`${JSON.stringify(value)}\n`);
}

function failJson(command, error, code) {
  const failure = describe(error);
  write({ ok: false, ...(command ? { command } : {}), error: { ...failure, ...(error.detail ? { field: error.detail } : {}) }, help: [command ? `${command} --help` : 'help'] }, process.stderr);
  process.exitCode = code;
}

/** Standalone runs attach the same native local filesystem seam the Host uses.
 * `help` never gets this far, so reading a schema costs nothing. */
async function localFileSystem(root) {
  const { Context } = await import('@deepseek-ai/cordis');
  const { LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local');
  const ctx = new Context();
  return { ctx, fs: new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 10 * 1024 * 1024 }) };
}

async function main() {
  let rootOverride = null;
  let parsed;
  try {
    const taken = takeWorkspace(process.argv.slice(2));
    rootOverride = taken.root;
    parsed = parseArgs(taken.rest);
  } catch (error) {
    failJson(undefined, error, EXIT_USAGE);
    return;
  }

  if (parsed.mode === 'help') {
    if (parsed.command === undefined) write(usage(), process.stdout);
    else if (Object.hasOwn(COMMANDS, parsed.command)) write(commandHelp(parsed.command), process.stdout);
    else failJson(undefined, new CliError('cli_command_unknown'), EXIT_USAGE);
    return;
  }

  const command = parsed.command;
  if (!Object.hasOwn(COMMANDS, command)) {
    failJson(undefined, new CliError('cli_command_unknown'), EXIT_USAGE);
    return;
  }

  let args;
  try {
    args = validateArgs(command, await readStdin(command==='write-batch'?BATCH_STDIN_LIMIT:STDIN_LIMIT));
  } catch (error) {
    failJson(command, error, EXIT_USAGE);
    return;
  }

  const env = process.env;
  const bound = typeof env.DSH_NOTARA_WORKSPACE === 'string' && env.DSH_NOTARA_WORKSPACE.length > 0;
  const root = bound ? env.DSH_NOTARA_WORKSPACE : rootOverride;
  if (typeof root !== 'string' || !root.length) {
    failJson(command, new CliError('cli_workspace_required'), EXIT_FAILURE);
    return;
  }
  try {
    if (bound && CLI_WRITE_COMMANDS.includes(command)) {
      if (env[CLI_WRITE_MODE_ENV] === 'read-only') throw new CliError('cli_write_denied');
      if (env[CLI_WRITE_URL_ENV]) {
        const response = await requestCliWrite(command, args, env);
        write(response, process.stdout);
        if (!response.ok) process.exitCode = EXIT_FAILURE;
        return;
      }
    }
    const resolved = await resolveWorkspace(root);
    const { fs } = await localFileSystem(resolved);
    const result = await runCommand(command, args, { fs, root: resolved, env });
    const ok=command!=='write-batch'||result.failedCount===0;
    write({ ok, command, result }, process.stdout);
    if(!ok)process.exitCode=EXIT_FAILURE;
  } catch (error) {
    failJson(command, error, EXIT_FAILURE);
  }
}

const invokedDirectly = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url : false;
if (invokedDirectly) await main();

export { COMMANDS, commandHelp, usage, validateArgs, describe, cacheName, resolveWorkspace, runCommand };

/** Host-facing dispatcher: callers provide the already authorized native IO,
 * real session exec and workspace root. Model input is only the command data;
 * it cannot select a root or forge an identity through these parameters. */
export async function dispatchVaultCommand(command,input,{fs,root,env,signal,io,context,exec,inlineMedia=false}={}) {
  const data=input??{};
  if(!data||typeof data!=='object'||Array.isArray(data))throw new CliError('cli_stdin_invalid');
  if(command==='command-help') {
    if(Object.keys(data).some(key=>key!=='command'))throw new CliError('cli_field_unknown');
    if(typeof data.command!=='string'||!Object.hasOwn(COMMANDS,data.command)) throw new CliError('cli_command_unknown');
    const {stdin,usage:cliUsage,example,...help}=commandHelp(data.command);
    return {...help,input:stdin,
      ...(inlineMedia&&data.command==='pdf-page'?{result:help.result.replace('imagePath','image attachment (returned with the tool result)')}:{}),
      example:{command:data.command,input:JSON.parse(example)},
      usage:{tool:'vault_command',arguments:{command:data.command,input:'按 input.fields 填写命令参数'}}};
  }
  if(command==='help') {
    if(Object.keys(data).length)throw new CliError('cli_field_unknown');
    return {program:'vault_command',commands:Object.fromEntries(COMMAND_NAMES.map(name=>[name,{summary:COMMANDS[name].summary,write:COMMANDS[name].write}]))};
  }
  if(typeof command!=='string'||!Object.hasOwn(COMMANDS,command)) throw new CliError('cli_command_unknown');
  const args=validateArgs(command,data);
  if(!root||!fs||!io||!context) throw new CliError('cli_context_missing');
  return runCommand(command,args,{fs,root,env:env??{},signal,io,context,exec,inlineMedia});
}
