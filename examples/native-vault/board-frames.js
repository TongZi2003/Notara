/**
 * `frames`: one picture of a state, step by step — environment diagrams and
 * call stacks, a sort in progress, the stages of a motion. Each `frame` line
 * starts a frame with its caption; the lines under it are ordinary board
 * Markdown (tables, lists, formulas, highlights for what changed). `predict`
 * before a frame covers it until the student writes a prediction (sent to the
 * teacher) or chooses to look directly (recorded, not sent).
 */
export class FramesError extends Error {
  constructor(message, line) { super(message); this.name = 'FramesError'; this.line = line; }
}
const LIMIT = { frames: 20, caption: 40, body: 1500, title: 60 };

export function parseFrames(source) {
  const rows = String(source ?? '').replace(/\r/g, '').split('\n').map((raw, index) => ({ raw, value: raw.trim(), line: index + 1 }));
  const spec = { title: null, frames: [] };
  let row, current = null, pendingPredict = null;
  const error = message => { throw new FramesError(message, row?.line); };
  const close = () => {
    if (!current) return;
    const body = current.lines.join('\n').trim();
    if (!body) { row = current.row; error(`第${spec.frames.length + 1}帧还没有内容。`); }
    if (body.length > LIMIT.body) { row = current.row; error(`一帧最多 ${LIMIT.body} 字。`); }
    spec.frames.push({ caption: current.caption, body, predict: current.predict });
    current = null;
  };
  for (row of rows) {
    if (!row.value && !current) continue;
    const title = row.value.match(/^title\s+(.+)$/);
    if (title && !current && !spec.frames.length && !spec.title) {
      if (title[1].length > LIMIT.title) error(`标题最多 ${LIMIT.title} 字。`);
      spec.title = title[1].trim();
      continue;
    }
    if (row.value === 'predict') {
      if (!current && !spec.frames.length) error('predict 要写在两帧之间：第一帧没有可以依据的前一帧。');
      close();
      if (pendingPredict) error('predict 后面要先写一帧。');
      pendingPredict = row;
      continue;
    }
    const frame = row.value.match(/^frame(?:\s+(.*))?$/);
    if (frame) {
      close();
      const caption = (frame[1] ?? '').trim();
      if (caption.length > LIMIT.caption) error(`帧的说明最多 ${LIMIT.caption} 字。`);
      if (spec.frames.length >= LIMIT.frames) error(`最多 ${LIMIT.frames} 帧。`);
      current = { caption, lines: [], predict: Boolean(pendingPredict), row };
      pendingPredict = null;
      continue;
    }
    if (!current) error('内容要写在 frame 行之后：每一帧以“frame 这一帧的说明”开头。');
    if (/^(```|~~~)/.test(row.value)) error('帧里不能再放代码块；代码用行内 `代码`，或者用表格列出变量与值。');
    current.lines.push(row.raw);
  }
  row = pendingPredict ?? undefined;
  if (pendingPredict) error('predict 后面要写一帧。');
  close();
  row = undefined;
  if (spec.frames.length < 2) error('逐帧演示至少要有两帧。');
  return spec;
}

export const framesIdentity = spec => JSON.stringify(['frames', spec.title, spec.frames]);
export const predictedFrames = spec => spec.frames.flatMap((frame, index) => frame.predict ? [index] : []);

/** A prediction for one covered frame, or a recorded choice to look directly. */
export function answerFrames(spec, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('board_answer_invalid');
  const keys = Object.keys(value), frame = value.frame;
  if (!Number.isInteger(frame) || !spec.frames[frame]?.predict) throw new Error('board_answer_invalid');
  if (value.skipped === true && keys.every(key => ['frame', 'skipped'].includes(key))) return { frame, skipped: true };
  if (value.unsure === true && keys.every(key => ['frame', 'unsure', 'note'].includes(key))) {
    if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 2000)) throw new Error('board_answer_invalid');
    return { frame, unsure: true, ...(value.note?.trim() ? { note: value.note.trim() } : {}) };
  }
  if (typeof value.text !== 'string' || keys.some(key => !['frame', 'text'].includes(key)) || value.text.length > 2000) throw new Error('board_answer_invalid');
  if (!value.text.trim()) throw new Error('board_answer_empty');
  return { frame, text: value.text.trim() };
}

export function framesAnswerText(spec, answer) {
  const frame = spec.frames[answer.frame], where = `第${answer.frame + 1}帧${frame?.caption ? `（${frame.caption}）` : ''}`;
  if (answer.skipped) return `${where}没有预测，直接看了。`;
  if (answer.unsure) return answer.note ? `${where}我预测不出来：${answer.note}` : `${where}我预测不出来。`;
  return `我预测${where}：${answer.text}`;
}

/** Looking directly is recorded for the teacher's overview but sends no message. */
export const framesSilent = answer => answer.skipped === true;

export const FRAMES_SYNTAX = '```frames\ntitle 调用 roll_dice(3)\nframe 调用前\n| 帧 | 绑定 |\n|---|---|\n| Global | roll_dice → 函数 |\npredict\nframe 进入 roll_dice\n| 帧 | 绑定 |\n|---|---|\n| roll_dice | num_rolls → <mark data-color="orange">3</mark> |\n```\n首行可写 title；每一帧以“frame 说明”开头，下面是普通板书 Markdown（表格、列表、公式，本帧改动处用高亮），不能再放代码块；predict 写在两帧之间，下一帧先盖住，学生写下预测后才揭开。2 到 20 帧。';
