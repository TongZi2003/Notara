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
  return done;
}
