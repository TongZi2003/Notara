/**
 * Status-only rows for the teacher's own tools. The native row prints the tool
 * name, its first argument or a job id; the student reads what the teacher is
 * doing instead. Each entry is [running, done, failed].
 */
export const STATUS_ROWS = Object.freeze({
  job_output: ['正在查看后台任务…', '已查看后台任务', '没有读到这个后台任务'],
  job_list: ['正在查看后台任务列表…', '已查看后台任务列表', '没有读到后台任务列表'],
  job_kill: ['正在停止后台任务…', '已请求停止后台任务', '没有停下这个后台任务'],
  save_lesson_summary: ['正在保存课堂小结…', '已保存课堂小结', '课堂小结没有保存成功'],
  set_teaching_settings: ['正在更新教学设置…', '已更新教学设置', '教学设置没有更新成功'],
  open_learning_lesson: ['正在打开这节课…', '已打开这节课', '这节课没有打开'],
  vault_read: ['正在读取资料…', '已读取资料', '资料读取失败'],
  vault_search: ['正在查找资料…', '已查找资料', '资料检索失败'],
  history_search: ['正在查找课堂记录…', '已查找课堂记录', '课堂记录检索失败'],
  history_read: ['正在回看课堂记录…', '已回看课堂记录', '课堂记录读取失败'],
  vault_save: ['正在保存资料…', '已保存资料', '资料没有保存成功'],
  vault_command: ['正在处理资料…', '已处理资料操作', '资料操作没有完成'],
});

/** The Host declining to rebind a lesson is a result, not an error; the teacher explains why. */
const UNBOUND = '这节课没有换过来，原因见老师的说明';

function resultText(block) {
  return (Array.isArray(block?.content) ? block.content : []).map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n');
}

export function statusRowText(key, block) {
  const [running, done, failed] = STATUS_ROWS[key];
  if (block?.kind !== 'tool-result') return running;
  if (block.isError) return failed;
  if (key === 'open_learning_lesson' && /"bound"\s*:\s*false/.test(resultText(block))) return UNBOUND;
  if (key === 'vault_command') {
    try { if (JSON.parse(resultText(block)).failedCount > 0) return '部分资料未保存，原因见老师的说明'; } catch { /* Non-batch commands have their own receipts. */ }
  }
  return done;
}
