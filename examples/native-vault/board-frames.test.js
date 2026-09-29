import assert from 'node:assert/strict';
import test from 'node:test';
import { answerFrames, framesAnswerText, framesSilent, parseFrames, predictedFrames } from './board-frames.js';

const source = 'title 调用 roll_dice(3)\nframe 调用前\n| 帧 | 绑定 |\n|---|---|\n| Global | roll_dice → 函数 |\npredict\nframe 进入 roll_dice\n| 帧 | 绑定 |\n|---|---|\n| roll_dice | num_rolls → <mark data-color="orange">3</mark> |\n\nframe 返回\n- 返回值 6';

test('frames keep their captions, Markdown bodies and the covered frames', () => {
  const spec = parseFrames(source);
  assert.equal(spec.title, '调用 roll_dice(3)');
  assert.deepEqual(spec.frames.map(frame => [frame.caption, frame.predict]), [['调用前', false], ['进入 roll_dice', true], ['返回', false]]);
  assert.match(spec.frames[1].body, /<mark data-color="orange">3<\/mark>/);
  assert.deepEqual(predictedFrames(spec), [1]);
  const cases = [
    ['frame 只有一帧\n内容', /至少要有两帧/],
    ['内容\nframe 一\nx\nframe 二\ny', /内容要写在 frame 行之后/],
    ['predict\nframe 一\nx\nframe 二\ny', /第一帧没有可以依据的前一帧/],
    ['frame 一\nx\npredict\npredict\nframe 二\ny', /predict 后面要先写一帧/],
    ['frame 一\nx\nframe 二\ny\npredict', /predict 后面要写一帧/],
    ['frame 一\n\nframe 二\ny', /第1帧还没有内容/],
    ['frame 一\n```python\nx\nframe 二\ny', /帧里不能再放代码块/],
  ];
  for (const [text, pattern] of cases) assert.throws(() => parseFrames(text), error => { assert.match(error.message, pattern); if (!/至少要有两帧/.test(error.message)) assert.ok(error.line >= 1, text); return true; });
});

test('a prediction names its frame; looking directly is recorded but silent', () => {
  const spec = parseFrames(source);
  assert.deepEqual(answerFrames(spec, { frame: 1, text: ' num_rolls 绑定到 3 ' }), { frame: 1, text: 'num_rolls 绑定到 3' });
  assert.throws(() => answerFrames(spec, { frame: 0, text: 'x' }), /board_answer_invalid/, 'only a covered frame takes a prediction');
  assert.throws(() => answerFrames(spec, { frame: 1, text: ' ' }), /board_answer_empty/);
  assert.equal(framesAnswerText(spec, { frame: 1, text: 'num_rolls 绑定到 3' }), '我预测第2帧（进入 roll_dice）：num_rolls 绑定到 3');
  const skipped = answerFrames(spec, { frame: 1, skipped: true });
  assert.equal(framesSilent(skipped), true);
  assert.equal(framesAnswerText(spec, skipped), '第2帧（进入 roll_dice）没有预测，直接看了。');
  assert.equal(framesSilent(answerFrames(spec, { frame: 1, unsure: true })), false);
});

test('frames join the component contract: answerable only with predict, silent 直接看, located errors', async () => {
  const { BOARD_COMPONENTS, boardAnswerMessage, boardComponents, validateBoardAnswer, validateBoardComponents } = await import('./board-components.js');
  const fence = body => '```frames\n' + body + '\n```';
  const [still] = boardComponents(fence('frame 一\n甲\nframe 二\n乙'));
  const [covered] = boardComponents(fence(source));
  assert.equal(still.answerable, false);
  assert.equal(covered.answerable, true);
  assert.equal(boardAnswerMessage({ sectionTitle: '第4题', blockTitle: '环境图', component: covered, answer: validateBoardAnswer(covered, { frame: 1, text: 'num_rolls 是 3' }) }), '〔白板｜第4题｜调用 roll_dice(3)〕我预测第2帧（进入 roll_dice）：num_rolls 是 3');
  assert.equal(BOARD_COMPONENTS.frames.silent(validateBoardAnswer(covered, { frame: 1, skipped: true })), true);
  assert.throws(() => validateBoardComponents(fence('frame 一\n甲\npredict\npredict\nframe 二\n乙')), /第1个组件（frames）第4行：predict 后面要先写一帧[\s\S]*frames 的写法/);
});
