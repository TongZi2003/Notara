import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { setDebugEnabled, useDebugEnabled } from './debug-mode.ts';

/**
 * One General-settings row inside the native Settings dialog — the public seat
 * a feature package owns for its own preference. Off by default; the row only
 * shows the switch, and the Raw Conversation view exists only while it is on.
 */
export function DebugRow({}: PropsRuntime<'settings.general.item'>): React.JSX.Element {
  const enabled = useDebugEnabled();
  return <div className="sf-debug-row" data-testid="sf-debug-row">
    <div className="sf-debug-copy">
      <span className="sf-debug-title">开发调试</span>
      <span className="sf-debug-note">打开后可在对话里查看这节课的原始记录与课程记录。</span>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      className="sf-debug-switch"
      data-testid="sf-debug-toggle"
      onClick={() => { setDebugEnabled(!enabled); }}
    >{enabled ? '已开启' : '已关闭'}</button>
  </div>;
}
