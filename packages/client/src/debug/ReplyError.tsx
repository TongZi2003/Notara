import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useSyncExternalStore } from 'react';
import { debugEnabled, subscribeDebug } from './debug-mode.ts';

/** Student wording only. The durable failure and debug inspector keep the
 * original provider message, code and evidence unchanged. */
export function ReplyError({ node }: PropsRuntime<'conversation.chat.node', 'turn-error'>): React.JSX.Element {
  const debug = useSyncExternalStore(subscribeDebug, debugEnabled);
  const message = node.data.code === 'MISSING_CREDENTIAL' ? '还不能开始回复，请先在设置里配置模型。' : '这次没有收到回复，可以再试一次。';
  return <div className="sf-reply-error" data-testid="classroom-reply-error" role="status"><p>{message}</p>{debug && <details><summary>调试详情</summary><pre>{node.data.code}{'\n'}{node.data.message}</pre></details>}</div>;
}
