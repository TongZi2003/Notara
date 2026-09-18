import { resolveFacadeTool } from '@studyforge/contracts/tool-facades';

export type ToolDisplayState = 'running' | 'ok' | 'error' | 'stopped';

/** Describes the action, never an unverified learning or persistence outcome. */
const ACTIONS: Record<string, string> = {
  find: '查找课堂资料与记录', open: '读取学习对象', note: '记录学习事实', update: '修改已有内容',
  record: '登记学习事实', propose: '准备待确认的提案', create: '新建资料或作品',
  board: '操作课堂工作台', classroom: '参与教室与同学互动', stage: '整理课堂阶段', delegate: '请帮手处理任务',
  read_workbench_activity: '查看工作台操作记录',
  draft_artifact: '准备可共同编辑的作品', mark_thought: '在思维图记下这个想法',
  load_tools: '准备这一步需要的操作',
  list_materials: '查找书架上的资料', read_material: '阅读原文', preview_region: '查看书页细节',
  read_content: '精读备课内容', cite_materials: '选用本课片段', note_learning_goal: '记下学习目标',
  list_cards: '查找相关卡片', read_card: '阅读这张卡片', read_cards: '阅读选中的卡片', search_learning: '查找相关知识和资料',
  read_method: '查看已有的方法笔记', note_method: '记下方法笔记', revise_method: '修改方法笔记',
  read_memory: '回看学习记录', search_memory: '查找学习记录', note_memory: '记下这次学习观察', revise_memory: '更正学习记录',
  query_evidence: '回看你刚才的作答', record_review: '记下这次复习', register_cards: '整理待学习的卡片', update_card: '更新卡片内容',
  list_plans: '查看学习计划', read_plan: '核对这份计划', list_sets: '查看学习集', read_set: '查看这个学习集',
  read_lesson: '查看本课安排', read_route: '查看课程路线', read_skeleton: '查看书的目录', read_handoff: '回看上节课的小结', read_journey: '回看全部学习经历',
  propose_card: '准备一张待确认的卡片', propose_review: '整理这次复习的记录', propose_set: '准备学习集的调整',
  propose_plan: '整理学习计划', propose_route: '安排接下来的课程', propose_skeleton: '整理书的目录',
  propose_handoff: '整理课后小结', propose_lesson_settings: '整理本课设置的调整',
  delegate_assistant: '请帮手核对作答', delegate_peer: '请帮手读你的解释', delegate_problem: '请帮手分析题目', delegate_search: '请帮手查找资料',
  subagent: '请帮手处理这一步', send_message: '给帮手补充说明', interrupt_agent: '请帮手停下来',
  read: '阅读资料', read_image: '查看图片', glob: '查找资料文件', grep: '查找相关内容',
  write: '写下整理内容', edit: '修改整理内容', web_fetch: '阅读网页', web_search: '查找网上的资料', skill: '查看这一步的做法',
};

export function toolDisplayCopy(name: string, state: ToolDisplayState, argsRaw = '', resultRaw = ''): string {
  const args = objectJson(argsRaw);
  const inner = resolveFacadeTool(name, args);
  const displayName = inner ?? name;
  const action = actionCopy(displayName, inner ? object(args.input) : args, state === 'ok' ? objectJson(resultRaw) : {});
  if (state === 'running') return `正在${action}…`;
  if (state === 'stopped') return `已停止：${action}`;
  if (state === 'error') return `这次没能${action}`;
  if (name === 'propose' || displayName.startsWith('propose_')) return `${action}：提案已准备好`;
  if (name === 'delegate' || displayName === 'subagent' || displayName.startsWith('delegate_')) return action === ACTIONS[displayName] ? '已交给帮手处理' : `${action}：已委托`;
  if (name === 'send_message') return '已给帮手补充说明';
  if (name === 'interrupt_agent') return '已请帮手停止';
  return `${action}：已完成`;
}

type Fields = Record<string, unknown>;
function object(value: unknown): Fields { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : {}; }
function objectJson(raw: string): Fields { try { return object(JSON.parse(raw)); } catch { return {}; } }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function positive(value: unknown): number | undefined { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined; }
function choice(value: unknown, labels: Record<string, string>): string | undefined { return Object.hasOwn(labels, String(value)) ? labels[String(value)] : undefined; }
function label(value: unknown, length = 24): string {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/gu, ' ').trim();
  if (/^(?:\/|~\/|[a-z]:[\\/]|(?:card|knowledge|memory|plan|set|session|skeleton):|(?:mat|ver|prop)_[a-z0-9]+)/iu.test(text)) return '';
  const chars = Array.from(text);
  return chars.length > length ? chars.slice(0, length - 1).join('') + '…' : text;
}
function quoted(value: unknown, length = 24): string { const text = label(value, length); return text ? `“${text}”` : ''; }
function titleOf(result: Fields): string { return quoted(object(result.content).title ?? result.title); }
function fields(patch: Fields, names: Record<string, string>): string {
  const selected = Object.entries(names).filter(([key]) => key in patch).map(([, name]) => name);
  return selected.slice(0, 3).join('、') + (selected.length > 3 ? `等${selected.length}项` : '');
}
function position(locator: Fields): string {
  if (locator.kind === 'pdf' && positive(locator.page)) return `第 ${locator.page} 页${locator.rect ? '的局部' : ''}`;
  if (locator.kind === 'pdftext' && positive(locator.page)) return `第 ${locator.page} 页摘录`;
  if (locator.kind === 'text') {
    const start = positive(object(locator.start).line), end = positive(object(locator.end).line);
    if (start) return end && end > start ? `第 ${start}–${end} 行` : `第 ${start} 行`;
  }
  if (locator.kind === 'image') return locator.rect ? '图片选区' : '图片';
  if (locator.kind === 'docx') return '文档选段';
  return '';
}

/** Only named human fields and mechanical counts enter the one-line summary.
 * Titles come from this call's frozen result, never today's mutable catalog. */
function actionCopy(name: string, args: Fields, result: Fields): string {
  const base = ACTIONS[name] ?? '处理这一步';
  const patch = object(args.patch), content = object(args.content), query = quoted(args.query);
  switch (name) {
    case 'read_material': case 'preview_region': {
      const where = position(object(object(args.source).locator ?? object(result.source).locator));
      return `${name === 'preview_region' ? '查看' : '阅读'}${titleOf(result) || '原文'}${where}`;
    }
    case 'read_card': return titleOf(result) ? `阅读卡片${titleOf(result)}` : base;
    case 'read_cards': return array(args.targets).length ? `阅读选中的 ${array(args.targets).length} 张卡片` : base;
    case 'register_cards': return array(args.cards).length ? `整理 ${array(args.cards).length} 张待学习卡片` : base;
    case 'list_materials': return query ? `在书架查找${query}` : base;
    case 'list_cards': {
      const state = choice(args.state, { due: '今天该复习的', upcoming: '尚未到期的', unlearned: '还没学过的', all: '全部' });
      const chapter = quoted(args.chapter, 20), tags = array(args.tags).map(tag => label(tag, 12)).filter(Boolean).slice(0, 2);
      const filter = chapter ? `（${chapter}）` : tags.length ? `（${tags.join('、')}）` : '';
      return `${state ? `查看${state}卡片` : base}${filter}`;
    }
    case 'search_learning': return query ? `查找与${query}有关的知识和资料` : base;
    case 'web_search': return query ? `在网上查找${query}` : base;
    case 'grep': return quoted(args.pattern) ? `在资料中查找${quoted(args.pattern)}` : base;
    case 'web_fetch': {
      try { const url = new URL(String(args.url)); return /^https?:$/u.test(url.protocol) ? `阅读 ${url.hostname} 上的网页` : base; } catch { return base; }
    }
    case 'read': {
      const from = positive(args.offset), count = positive(args.limit);
      return from ? `阅读资料第 ${from} 行起${count ? `的 ${count} 行` : ''}` : count ? `阅读资料的前 ${count} 行` : base;
    }
    case 'read_method': return titleOf(result) ? `查看方法笔记${titleOf(result)}` : base;
    case 'note_method': return quoted(args.title) ? `记下方法笔记${quoted(args.title)}` : base;
    case 'read_plan': return titleOf(result) ? `核对计划${titleOf(result)}` : base;
    case 'read_set': return quoted(result.name) ? `查看学习集${quoted(result.name)}` : base;
    case 'read_handoff': return titleOf(result) ? `回看小结${titleOf(result)}` : base;
    case 'search_memory': {
      const kinds = array(args.kinds).flatMap(kind => {
        const text = choice(kind, { ability: '能力观察', habit: '学习习惯', preference: '学习偏好' });
        return text ? [text] : [];
      });
      return `查找${query ? `与${query}有关的` : ''}${kinds.length ? kinds.join('、') : '学习记录'}`;
    }
    case 'note_memory': case 'revise_memory': {
      const kind = choice(args.kind, { ability: '能力观察', habit: '学习习惯', preference: '学习偏好' });
      return kind ? `${name === 'note_memory' ? '记下' : '更正'}这次${kind}` : base;
    }
    case 'update_card': case 'revise_method': {
      const changed = fields(patch, { title: '标题', front: '卡面', sections: '卡背', notes: '笔记', body: '正文', tags: '标签', sources: '来源', chapter: '章节' });
      return `修改${titleOf(result) || (name === 'update_card' ? '卡片' : '方法笔记')}${changed ? `的${changed}` : ''}`;
    }
    case 'propose_card': return args.kind === 'method' ? '准备收录锦囊' : args.kind === 'cards' && Array.isArray(args.cards)
      ? `整理${quoted(args.title)}的 ${args.cards.length} 张待确认卡片` : quoted(args.title) ? `准备卡片${quoted(args.title)}` : base;
    case 'record_review': case 'propose_review': return ['忘', '糊', '牢', '涉', '初'].includes(String(args.mark)) ? `将这次复习记为“${args.mark}”` : base;
    case 'propose_handoff': return `${args.kind === 'revise' ? '更正' : '整理'}课后小结${quoted(args.title)}`;
    case 'propose_route': return args.action === 'add' && array(args.nodes).length ? `安排接下来的 ${array(args.nodes).length} 节课程` : args.action === 'edit' ? `调整课程${quoted(patch.title)}` : base;
    case 'propose_skeleton': {
      const change = object(args.change), nodes = array(change.nodes), removed = array(change.removePaths), moved = array(change.repath);
      if (change.replaceExisting === true) return `重排整本目录（${nodes.length} 节）${change.detachDependents === true ? '并解除受影响的关联' : ''}`;
      const changes = [nodes.length ? `整理 ${nodes.length} 节` : '', removed.length ? `删除 ${removed.length} 节` : '', moved.length ? `改名或移动 ${moved.length} 节` : '', change.detachDependents === true ? '解除受影响的关联' : ''].filter(Boolean);
      if (changes.length !== 1 || !nodes.length) return changes.length ? `调整目录：${changes.join('、')}` : base;
      const parents = nodes.map(node => typeof object(node).path === 'string' ? String(object(node).path).split('/').slice(0, -1).join(' › ') : '');
      const parent = parents[0] && parents.every(path => path === parents[0]) ? quoted(parents[0], 20) : '';
      return parent ? `整理${parent}的 ${nodes.length} 个小节` : `整理书的目录（${nodes.length} 节）`;
    }
    case 'propose_set': {
      if (args.action === 'create') return `建立学习集${quoted(content.name)}${array(content.members).length ? `（${array(content.members).length} 张卡）` : ''}`;
      const changes = [quoted(patch.name) ? `改名为${quoted(patch.name)}` : '', array(patch.members_add).length ? `加入 ${array(patch.members_add).length} 张卡` : '', array(patch.members_remove).length ? `移出 ${array(patch.members_remove).length} 张卡` : '', patch.ladder !== undefined ? '修改复习间隔' : ''].filter(Boolean);
      return changes.length ? `调整学习集：${changes.join('、')}` : base;
    }
    case 'propose_plan': {
      if (args.action === 'edit') {
        const changed = fields(patch, { title: '名称', start: '开始日期', end: '结束日期', dailyCount: '每日数量', schedule: '具体日程', entries: '阅读安排', cards: '卡片范围', tags: '标签' });
        return changed ? `调整计划的${changed}` : base;
      }
      const title = quoted(content.title, 18);
      if (content.kind === 'book') return `安排${title || '这本书'}的 ${array(content.entries).length} 次阅读`;
      if (content.kind === 'campaign') return array(content.schedule).length
        ? `安排${title || '这次复习'}的 ${array(content.schedule).length} 项日程`
        : `安排${title || '复习计划'}${positive(content.dailyCount) ? `，每天 ${content.dailyCount} 张卡` : ''}`;
      return base;
    }
    case 'propose_lesson_settings': {
      const changes = [args.archived === true ? '归档' : args.archived === false ? '恢复显示' : '', args.lessonMaterials !== undefined ? `采用 ${array(object(args.lessonMaterials).materials).length} 项资料` : '',
        args.teachingRef !== undefined ? '更换教法' : '', args.learningSetRef !== undefined ? '调整学习集' : '', args.stance !== undefined ? '调整重点' : '', args.temporaryInstructions !== undefined ? '调整本课要求' : ''].filter(Boolean);
      return changes.length ? `调整本课：${changes.slice(0, 3).join('、')}${changes.length > 3 ? '等' : ''}` : base;
    }
    default: return base;
  }
}

/** Invalid or unfinished argument JSON is still readable when expanded. */
export function prettyToolArguments(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}
