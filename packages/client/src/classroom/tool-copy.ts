export type ToolDisplayState = 'running' | 'ok' | 'error' | 'stopped';

/** Describes the action, never an unverified learning or persistence outcome. */
const ACTIONS: Record<string, string> = {
  list_materials: '查找书架上的资料', read_material: '阅读原文', preview_region: '查看书页细节',
  list_cards: '查找相关卡片', read_card: '阅读这张卡片', read_cards: '阅读选中的卡片', search_learning: '查找相关知识和资料',
  read_method: '查看已有的方法笔记', note_method: '记下方法笔记', revise_method: '修改方法笔记',
  read_memory: '回看学习记录', search_memory: '查找学习记录', note_memory: '记下这次学习观察', revise_memory: '更正学习记录',
  query_evidence: '回看你刚才的作答', record_review: '记下这次复习', register_cards: '整理待学习的卡片', update_card: '更新卡片内容',
  list_plans: '查看学习计划', read_plan: '核对这份计划', list_sets: '查看学习集', read_set: '查看这个学习集',
  read_lesson: '查看本课安排', read_route: '查看课程路线', read_skeleton: '查看书的目录', read_handoff: '回看上节课的小结',
  propose_card: '准备一张待确认的卡片', propose_review: '整理这次复习的记录', propose_set: '准备学习集的调整',
  propose_plan: '整理学习计划', propose_route: '安排接下来的课程', propose_skeleton: '整理书的目录',
  propose_handoff: '整理课后小结', propose_lesson_settings: '整理本课设置的调整',
  delegate_assistant: '请帮手核对作答', delegate_peer: '请帮手读你的解释', delegate_problem: '请帮手分析题目', delegate_search: '请帮手查找资料',
  subagent: '请帮手处理这一步', send_message: '给帮手补充说明', interrupt_agent: '请帮手停下来',
  read: '阅读资料', read_image: '查看图片', glob: '查找资料文件', grep: '查找相关内容',
  write: '写下整理内容', edit: '修改整理内容', web_fetch: '阅读网页', web_search: '查找网上的资料', skill: '查看这一步的做法',
};

export function toolDisplayCopy(name: string, state: ToolDisplayState, argsRaw = ''): string {
  let action = ACTIONS[name] ?? '处理这一步';
  if (name === 'list_cards') {
    try { if (JSON.parse(argsRaw)?.state === 'due') action = '查看今天该复习的卡片'; } catch { /* Arguments may still be arriving. */ }
  }
  if (name === 'propose_card') {
    try { if (JSON.parse(argsRaw)?.kind === 'method') action = '准备收录锦囊'; } catch { /* Keep the action until its variant arrives. */ }
  }
  if (state === 'running') return `正在${action}…`;
  if (state === 'stopped') return `已停止：${action}`;
  if (state === 'error') return `这次没能${action}`;
  if (name.startsWith('propose_')) return `${action}：提案已准备好`;
  if (name === 'subagent' || name.startsWith('delegate_')) return '已交给帮手处理';
  if (name === 'send_message') return '已给帮手补充说明';
  if (name === 'interrupt_agent') return '已请帮手停止';
  return `${action}：已完成`;
}

/** Invalid or unfinished argument JSON is still readable when expanded. */
export function prettyToolArguments(raw: string): string {
  try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
}
