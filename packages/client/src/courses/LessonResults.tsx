import type { Context } from '@deepseek-ai/cordis';
import type { CourseView } from '@studyforge/contracts/courses';
import type { OutputProjection } from '@studyforge/domain/outputs';
import { useEffect, useState } from 'react';
import { Outputs } from '../classroom/Outputs.tsx';
import { LearningObject } from '../classroom/LearningObject.tsx';

export function LessonResults({ ctx, sessionId }: { ctx: Context; sessionId: string }): React.JSX.Element {
  const [course, setCourse] = useState<CourseView>(), [outputs, setOutputs] = useState<OutputProjection>(), [target, setTarget] = useState<string>(), [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true; setCourse(undefined); setOutputs(undefined); setTarget(undefined); setFailed(false);
    void Promise.all([ctx.remote.studyforgeCourses.read({ sessionId }), ctx.remote.studyforgeCourses.outputs({ sessionId })]).then(([metadata, result]) => {
      if (!live) return;
      if (metadata.ok && result.ok) { setCourse(metadata.value); setOutputs(result.value); } else setFailed(true);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ctx, sessionId]);
  return <section className="sf-map-section" data-testid="route-lesson-results">
    <h4>{course?.data.closure ? '已收课' : '已开课'}</h4>
    {course?.data.learningContext && <p>{course.data.learningContext.goal.title}</p>}
    {failed && <p>这节课的成果暂时无法读取。</p>}
    {target ? <LearningObject ctx={ctx} sessionId={sessionId} target={target} onBack={() => setTarget(undefined)} />
      : outputs && <Outputs projection={{ ...outputs, entries: outputs.entries.filter(entry => entry.status === 'saved') }} onOpen={entry => { if (entry.target) setTarget(entry.target); }} />}
  </section>;
}
