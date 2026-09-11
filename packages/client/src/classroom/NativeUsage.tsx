import type { CourseUsage } from '@studyforge/contracts/courses';

export type UsageState =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly usage: CourseUsage };

/** This conversation's actual consumption, with the context estimates kept apart. */
export function NativeUsage({ state }: { readonly state: UsageState }): React.JSX.Element {
  return <section>
    <h3>用量</h3>
    {state.status === 'loading' && <p className="sf-note" role="status">正在看这节课用掉的量…</p>}
    {state.status === 'unavailable' && <p className="sf-note" role="status">这节课的用量暂时取不到，稍后再看一次。</p>}
    {state.status === 'ready' && <UsageBody usage={state.usage} />}
  </section>;
}

function UsageBody({ usage }: { readonly usage: CourseUsage }): React.JSX.Element {
  if (usage.totals === null) {
    return <p className="sf-note" data-testid="usage-empty">这节课还没有完成的回合，暂时没有用量。</p>;
  }
  const { totals } = usage;
  // A bucket the Host did not prove is never printed as a number: an exact
  // coverage gap says 不完整, and a bucket no attempt ever reported says 未报告.
  const bucket = (reported: boolean, value: number): string => reported ? count(value) : usage.exact ? '未报告' : '不完整';
  return <div data-testid="usage-totals">
    <ul>
      <li><span>输入（未缓存）</span><span className="sf-meta" data-testid="usage-input">{count(totals.uncachedInputTokens)}</span></li>
      <li><span>缓存读</span><span className="sf-meta" data-testid="usage-cache-read">{bucket(usage.cacheReadReported, totals.cacheReadTokens)}</span></li>
      <li><span>缓存写</span><span className="sf-meta" data-testid="usage-cache-write">{bucket(usage.cacheWriteReported, totals.cacheWriteTokens)}</span></li>
      <li><span>输出（含思考）</span><span className="sf-meta" data-testid="usage-output">{count(totals.outputTokens)}</span></li>
    </ul>
    <p className="sf-note" data-testid="usage-coverage">{usage.exact
      ? `这 ${usage.completedTurns} 个回合的用量都已记下。`
      : `覆盖 ${usage.measuredTurns}/${usage.completedTurns} 个回合，只能看已报告的部分。`}</p>
    {(usage.context !== null || usage.breakdown !== null) && <div data-testid="usage-estimates">
      <h4 className="sf-subhead">上下文（估算，不是实际消耗）</h4>
      <ul>
        <li><span>预计占用</span><span className="sf-meta" data-testid="usage-context">{usage.context?.projectedTokens !== undefined
          ? count(usage.context.projectedTokens)
          : usage.context?.pressureTokens !== undefined ? count(usage.context.pressureTokens) : '未报告'}</span></li>
        <li><span>上限</span><span className="sf-meta" data-testid="usage-window">{usage.context?.contextWindow !== undefined ? count(usage.context.contextWindow) : '未报告'}</span></li>
        <li><span>系统 / 工具 / 对话</span><span className="sf-meta" data-testid="usage-breakdown">{usage.breakdown === null
          ? '未报告'
          : `${count(usage.breakdown.systemTokens)} / ${count(usage.breakdown.toolsTokens)} / ${count(usage.breakdown.messageTokens)}`}</span></li>
      </ul>
    </div>}
  </div>;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}
