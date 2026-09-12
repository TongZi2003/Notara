/**
 * 学情页，移植自 B@3831987 `app/js/screens/memory.js`。
 *
 * B 的屏是「纸页 + 记忆块」：`.plain-wrap` 一张竖排纸，页头一行「记忆 · N 块」
 * 加「新建学情」，下面是真实的记忆块。DSH 的列表、搜索、新建、编辑、冲突核对
 * 都还在 `MemoryPanel` 里（它也仍然可以作为一课右栏的「学情与偏好」用），
 * 这里只给它 B 的那张纸：同一份数据，两种入口，没有第二套读写。
 */
import type { Context } from '@deepseek-ai/cordis';
import { MemoryPanel } from './MemoryPanel.tsx';

export const MEMORY_PAGE_ID = 'studyforge.memory';

export function MemoryPage({ ctx, sessionId }: { readonly ctx: Context; readonly sessionId?: string }): React.JSX.Element {
  return <main className="sf-orig sf-page-scroll sf-memory-page" data-testid={`studyforge-page-${MEMORY_PAGE_ID}`}>
    <div className="plain-wrap">
      <MemoryPanel ctx={ctx} {...(sessionId === undefined ? {} : { sessionId })} />
    </div>
  </main>;
}
