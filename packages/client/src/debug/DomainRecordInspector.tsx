import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { CourseView } from '@studyforge/contracts/courses';
import { useEffect, useState } from 'react';

/**
 * Read-only projection of this lesson's stored metadata, shown inside the debug
 * surface. Nothing here writes: the P5 confirmation path is not connected, so
 * the inspector shows only what `studyforgeCourses.read` already returned and
 * never invents a confirmation or a pending draft.
 */
export function DomainRecordInspector({ sessionId, readCourse }: {
  readonly sessionId: string;
  readonly readCourse: (input: { sessionId: string }) => Promise<RemoteResult<CourseView>>;
}): React.JSX.Element {
  const [state, setState] = useState<{ status: 'loading' | 'unavailable' } | { status: 'ready'; view: CourseView }>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    readCourse({ sessionId }).then(
      result => { if (live) setState(result.ok ? { status: 'ready', view: result.value } : { status: 'unavailable' }); },
      () => { if (live) setState({ status: 'unavailable' }); },
    );
    return () => { live = false; };
  }, [sessionId, readCourse]);
  return <section className="sf-raw-domain" data-testid="sf-raw-domain">
    <h3>课程记录（只读）</h3>
    <p className="sf-note">这里是这节课已经存下的元数据；只能看，改动要走的确认通路还没有接上。</p>
    {state.status === 'loading' && <p className="sf-note" role="status">正在读…</p>}
    {state.status === 'unavailable' && <p className="sf-note" role="status">暂时读不到这节课的记录。</p>}
    {state.status === 'ready' && <pre className="sf-raw-json" data-testid="sf-raw-domain-json">{JSON.stringify(state.view, null, 2)}</pre>}
  </section>;
}
