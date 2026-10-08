/**
 * Synthetic lesson shared by isolated native integration and later real-model
 * review. Send only round.input to the teacher; oracle and review criteria are
 * harness-only. Scripted answers prove plumbing, never teaching semantics or
 * autonomous tool choice. No fixture value is a real student's learning data.
 */
export type ContinuityRoundId = `round-${number}`;
export type ContinuityCheckpointId = 'checkpoint-1' | 'checkpoint-2' | 'checkpoint-3';
export type ContinuityReviewStatus = 'not-run' | 'pass' | 'fail' | 'inconclusive';
export type ContinuityCheckId = 'formula' | 'domain' | 'latest-goal' | 'correction-status'
  | 'mastery-evidence' | 'unfinished-task' | 'original-source' | 'next-teaching-action';

export interface ContinuityRound {
  id: ContinuityRoundId;
  input: string;
  probeAfter?: ContinuityCheckpointId;
}

export interface ContinuityCheckpoint {
  id: ContinuityCheckpointId;
  afterRound: ContinuityRoundId;
  probeRound: ContinuityRoundId;
  requiredSourceRounds: readonly ContinuityRoundId[];
  requiredPriorCheckpoint?: ContinuityCheckpointId;
}

export interface ContinuityOracle {
  probeRound: ContinuityRoundId;
  formula: { expression: string; coefficients: readonly [number, number, number]; vertex: readonly [number, number] };
  domains: { original: readonly [number, number]; active: readonly [number, number]; completedVariant?: readonly [number, number] };
  method: 'completing-square-without-derivatives';
  latestGoal: string;
  corrections: readonly {
    mistakenRound: ContinuityRoundId;
    correctedRound: ContinuityRoundId;
    before: string;
    after: string;
  }[];
  masteryEvidence: {
    vertex: 'corrected-after-hint';
    boundaryExplanation: 'not-yet-written' | 'written-after-prior-hints';
    independentNewProblem: 'not-observed';
  };
  unfinishedTask: string;
  originalSource: { round: ContinuityRoundId; exactQuote: string; label: string; measurement: { value: number; unit: string } };
  nextTeachingAction: { purpose: string; mustWaitForStudent: true; mustNotRevealNewProblemAnswer: true };
}

const rounds: readonly ContinuityRound[] = [
  { id: 'round-1', input: '这节课研究 P(t)=(t-3)^2+2，先限制 t 在[-1,4]。我想用配方理解区间最小值，不用导数。先让我判断顶点，不要直接讲完整解答。' },
  { id: 'round-2', input: '我觉得顶点是(2,3)，大概把两个数字的位置弄混了。先给我一个能自行检查的提示。' },
  { id: 'round-3', input: '提示后我把顶点改成(3,2)。这是提示后纠正的，还没有独立做过区间变式，不能因此说我已经掌握。' },
  { id: 'round-4', input: '我在原始测量记录上写的是“绿色标签，0.037厘米”。以后要核对这句原话。今天先暂停；我还没解释为什么端点与顶点的比较能决定原区间的最小值。' },
  { id: 'round-5', probeAfter: 'checkpoint-1', input: '回来继续刚才的题。请先确认我们讨论的表达式、区间和方法，以及我究竟纠正了什么、还没完成什么。早先那条标签与测量记录也请核对原句；不确定就说明。然后只给下一步提示，让我继续想。' },
  { id: 'round-6', input: '现在只把区间改成[-1,2]，表达式不变。我的新目标是理解顶点不在允许范围时怎样选边界；仍然不用导数。先让我试，不要替我完成。' },
  { id: 'round-7', input: '我沿用上一题把变式的最小值写成2，觉得那个顶点的值仍能取到。这个判断我没有检查过，你先帮我找检查方向。' },
  { id: 'round-8', input: '经过提示，我发现顶点不在新区间内，改到右端点去算，把这道变式的最小值改成3。我仍没完整写出为什么右端点最近，这次也不能算独立的新题表现。先保留这个未完成的解释。' },
  { id: 'round-9', probeAfter: 'checkpoint-2', input: '继续现在的变式。请区分最初那题与现在这题的条件，确认我最新修正的结论、修正过程和还欠的解释；不要把有提示的改正算成独立掌握。那条早期记录若要引用，请核对原话。接着只问我一个能补完解释的问题。' },
  { id: 'round-10', input: '我现在补出解释：区间都在3的左边，t增大时离3越来越近，所以右端点给出最小的平方距离。我自己写出了这段理由，但这道题先前已经提示过，仍不能证明我会独立解决陌生变式。' },
  { id: 'round-11', input: '接下来把区间换成[-1,5]作为新的独立尝试，表达式不变。我的目标改为在没有提示的情况下自己判断最小值。先不要替我算，也不要把刚才有提示的题当作这道新题的掌握证据；下一次只问我从哪里开始。' },
  { id: 'round-12', probeAfter: 'checkpoint-3', input: '整理后继续。请把当前新题和先前完成的变式分开，确认现在的目标、已有的纠正与解释证据、以及尚未验证的能力。那条早期标签与测量原话请再次核对，不要猜值。按我原先的方法要求，只提出下一问并等我作答，不要先给新题答案。' },
];

const formula = { expression: 'P(t)=(t-3)^2+2', coefficients: [1, -6, 11], vertex: [3, 2] } as const;
const originalSource = { round: 'round-4', exactQuote: '绿色标签，0.037厘米', label: '绿色标签', measurement: { value: 0.037, unit: '厘米' } } as const;
const vertexCorrection = { mistakenRound: 'round-2', correctedRound: 'round-3', before: 'vertex=(2,3)', after: 'vertex=(3,2), corrected after a hint' } as const;
const boundaryCorrection = { mistakenRound: 'round-7', correctedRound: 'round-8', before: 'minimum=2 on [-1,2]', after: 'minimum=3 on [-1,2], corrected after hints' } as const;
const oracles: readonly ContinuityOracle[] = [
  { probeRound: 'round-5', formula, domains: { original: [-1, 4], active: [-1, 4] }, method: 'completing-square-without-derivatives',
    latestGoal: 'Explain how the permitted vertex and endpoints determine the original interval minimum.', corrections: [vertexCorrection],
    masteryEvidence: { vertex: 'corrected-after-hint', boundaryExplanation: 'not-yet-written', independentNewProblem: 'not-observed' },
    unfinishedTask: 'The student has not yet explained the original interval vertex/endpoint comparison.', originalSource,
    nextTeachingAction: { purpose: 'Ask a focused vertex/endpoint comparison question without replacing the student explanation.', mustWaitForStudent: true, mustNotRevealNewProblemAnswer: true } },
  { probeRound: 'round-9', formula, domains: { original: [-1, 4], active: [-1, 2] }, method: 'completing-square-without-derivatives',
    latestGoal: 'Explain why the right endpoint is closest to the excluded vertex on the changed interval.', corrections: [vertexCorrection, boundaryCorrection],
    masteryEvidence: { vertex: 'corrected-after-hint', boundaryExplanation: 'not-yet-written', independentNewProblem: 'not-observed' },
    unfinishedTask: 'The student has not yet written the right-endpoint distance explanation for [-1,2].', originalSource,
    nextTeachingAction: { purpose: 'Ask one question that elicits the missing distance explanation, without claiming independent mastery.', mustWaitForStudent: true, mustNotRevealNewProblemAnswer: true } },
  { probeRound: 'round-12', formula, domains: { original: [-1, 4], active: [-1, 5], completedVariant: [-1, 2] }, method: 'completing-square-without-derivatives',
    latestGoal: 'Attempt the new interval problem independently, without hints or a supplied answer.', corrections: [vertexCorrection, boundaryCorrection],
    masteryEvidence: { vertex: 'corrected-after-hint', boundaryExplanation: 'written-after-prior-hints', independentNewProblem: 'not-observed' },
    unfinishedTask: 'The new [-1,5] problem has not been attempted by the student.', originalSource,
    nextTeachingAction: { purpose: 'Ask where the student would begin the new problem and wait; do not supply its result or a worked method.', mustWaitForStudent: true, mustNotRevealNewProblemAnswer: true } },
];

export const contextContinuityScenario = {
  id: 'synthetic-quadratic-continuity-v1',
  rounds,
  checkpoints: [
    { id: 'checkpoint-1', afterRound: 'round-4', probeRound: 'round-5', requiredSourceRounds: ['round-1', 'round-2', 'round-3', 'round-4'] },
    { id: 'checkpoint-2', afterRound: 'round-8', probeRound: 'round-9', requiredSourceRounds: ['round-5', 'round-6', 'round-7', 'round-8'], requiredPriorCheckpoint: 'checkpoint-1' },
    { id: 'checkpoint-3', afterRound: 'round-11', probeRound: 'round-12', requiredSourceRounds: ['round-9', 'round-10', 'round-11'], requiredPriorCheckpoint: 'checkpoint-2' },
  ] satisfies readonly ContinuityCheckpoint[],
  // These expectations and criteria must never be appended to a model request.
  reviewOnly: {
    oracles,
    checklist: [
      { id: 'formula', criterion: 'Equivalent mathematics is accepted: preserve the expression and vertex, not one required spelling.' },
      { id: 'domain', criterion: 'Distinguish the original, completed variant and current interval; never transplant an old minimum to a changed domain.' },
      { id: 'latest-goal', criterion: 'Use the latest student goal and completing-square method preference; do not continue a superseded task or introduce derivatives.' },
      { id: 'correction-status', criterion: 'Keep the mistaken claims and later corrections in causal order; do not treat an earlier mistake as the latest belief.' },
      { id: 'mastery-evidence', criterion: 'Separate hinted correction, a subsequently written explanation, and an independent new attempt. No independent new attempt has been observed.' },
      { id: 'unfinished-task', criterion: 'Track what remains unfinished at this probe, and stop calling the earlier explanation unfinished after round-10.' },
      { id: 'original-source', criterion: 'Check the original round-4 event through bounded native search/read evidence; the exact quote is a fidelity check, not a semantic teaching verdict.' },
      { id: 'next-teaching-action', criterion: 'Choose a useful question consistent with the learner state and wait for the student; do not disclose the new problem answer or mark unobserved mastery.' },
    ] satisfies readonly { id: ContinuityCheckId; criterion: string }[],
    sourceCoverage: 'Resolve round IDs to actual user eventSeq values. Match each committed summary to its native replacement. Check direct shadowedSeqs and traverse actual prior-checkpoint source edges; three /compact invocations alone prove neither three committed checkpoints nor nested source depth.',
    evidenceSeparation: {
      nativeArchiveRead: 'A same-session search/read tool pair, its causal call/result events and the recovered canonical original can prove retrieval/read plumbing even with a scripted model.',
      modelAutonomousRetrieval: 'Only an unscripted real-model trace can show the teacher chose retrieval. Do not prescribe tool names, source seq, query, expected quote or a canned answer to the model. If the original is already supplied in the active prompt, retrieval autonomy is inconclusive.',
      humanSemantics: 'A reviewer assesses claims, causal state and the appropriateness of the next teaching action against the oracle; keyword appearance and scripted responses cannot mark this pass.',
    },
  },
} as const;

/** Blank evidence record: no scenario import constitutes an acceptance run. */
export interface ContinuityProbeReview {
  probeRound: ContinuityRoundId;
  runKind: 'scripted-native-integration' | 'real-model';
  nativeArchiveRead: { status: ContinuityReviewStatus; originalSeq?: number; searchCallSeq?: number; readCallSeq?: number; readResultSeq?: number; canonicalHash?: string; notes: string };
  modelAutonomousRetrieval: { status: ContinuityReviewStatus; evidenceEventSeqs: number[]; notes: string };
  humanReview: {
    status: ContinuityReviewStatus;
    reviewer: string | null;
    reviewedAt: string | null;
    items: { id: ContinuityCheckId; status: ContinuityReviewStatus; evidenceEventSeqs: number[]; rationale: string }[];
  };
}

export function createContinuityProbeReview(probeRound: ContinuityRoundId, runKind: ContinuityProbeReview['runKind']): ContinuityProbeReview {
  return {
    probeRound, runKind,
    nativeArchiveRead: { status: 'not-run', notes: '' },
    modelAutonomousRetrieval: { status: 'not-run', evidenceEventSeqs: [], notes: '' },
    humanReview: { status: 'not-run', reviewer: null, reviewedAt: null,
      items: contextContinuityScenario.reviewOnly.checklist.map(({ id }) => ({ id, status: 'not-run', evidenceEventSeqs: [], rationale: '' })) },
  };
}
