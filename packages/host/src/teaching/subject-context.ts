import type { Context } from '@deepseek-ai/cordis';
import type { HostContext } from '@studyforge/contracts';
import type { CourseMetadataData } from '@studyforge/contracts/courses';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { RecordStore } from '@studyforge/domain/storage';
import { activeArtifacts, installedBody } from '../creation/artifact-service.ts';

export const SubjectBindingSchema = z.object({ subjects: z.array(z.string()), pins: z.array(z.object({ ref: z.string(), digest: z.string() })) });
declare module '@deepseek-ai/cordis' { interface Context { studyforgeSubjectBindings: RecordStore<typeof SubjectBindingSchema>; } }
const key = (context: HostContext): string => createHash('sha256').update(context.sessionId!).digest('hex');
export async function pinSubjects(host: Context, context: HostContext, course: CourseMetadataData): Promise<void> {
  const subjects = lessonSubjects(host, context, course), id = key(context);
  const current = host.studyforgeSubjectBindings.list(context).find(row => row.ref === 'subjectbinding:' + id);
  if (current && JSON.stringify(current.data.subjects) === JSON.stringify(subjects)) return;
  const data = { subjects, pins: activeArtifacts(host).filter(item => item.manifest.kind === 'subject' && item.manifest.subjects.some(subject => subjects.includes(subject))).map(item => ({ ref: item.ref, digest: item.digest })) };
  const mutation = { ...context, operationId: 'subjects:' + id + ':' + (current?.version ?? 0), expectedVersion: current?.version ?? 0 };
  if (current) await host.studyforgeSubjectBindings.update(mutation, current.ref, data, () => data);
  else await host.studyforgeSubjectBindings.create(mutation, id, data);
}

/** Subject selection is applicability, never a filesystem or access boundary. */
export function lessonSubjects(host: Context, context: HostContext, course: CourseMetadataData): string[] {
  if (course.subjects !== undefined) return [...new Set(course.subjects)];
  if (!course.learningSetRef) return [];
  return [...new Set(host.studyforgeSetService.read(context, course.learningSetRef).subjects)];
}

export function subjectBrief(host: Context, context: HostContext, course: CourseMetadataData): string {
  const subjects = lessonSubjects(host, context, course);
  const binding = host.studyforgeSubjectBindings.list(context).find(row => row.ref === 'subjectbinding:' + key(context));
  // Native sections can be evaluated before the assemble middleware persists
  // the first binding. The first request must use the same current versions;
  // subsequent requests use the durable pins, including disabled old versions.
  const pins = binding && JSON.stringify(binding.data.subjects) === JSON.stringify(subjects) ? binding.data.pins : activeArtifacts(host).filter(item => item.manifest.kind === 'subject' && item.manifest.subjects.some(subject => subjects.includes(subject))).map(item => ({ ref: item.ref, digest: item.digest }));
  const bodies = pins.map(pin => { const resource = installedBody(host, pin.ref, pin.digest); return `学科教法：${resource.manifest.title}\n${resource.body}`; });
  return [(subjects.length ? `本课涉及科目：${subjects.join('、')}。按明确科目选择教法；资料路径和书名不能替代该选择。跨科问题可以使用各科方法，新增科目由学生在本课选择。`
    : '本课未指定科目，使用通用教学方法；不强制选科目，也不从文件路径推断科目归属。'), ...bodies].join('\n\n');
}
