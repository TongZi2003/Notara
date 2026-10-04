// Shared task identities and capabilities. Prompt bodies live in teaching resources.
export const WORKER_PRESETS = Object.freeze([
  { id: 'problem', name: '题目研究员', description: '独立研究一道完整题，理解原解并交付题卡。' },
  { id: 'lesson', name: '课时备课员', description: '按课程框架完善一节课的讲练与教师参考。' },
  { id: 'review', name: '核验员', description: '针对具体疑点核对原文和产物，给出依据与修改建议。' },
  { id: 'general', name: '通用工作员', description: '独立研究完整知识单元，解释动机、条件与联系；也可查阅资料和整理证据。' },
  { id: 'exercise', name: '出题员', description: '围绕学习目标设计小测和变式，并先自行检查解答。' },
].map(Object.freeze));
import { pluginEventType } from './plugin-events.js';
const reading = ['read', 'glob', 'grep', 'read_image'];
export const WORKER_TOOLS = Object.freeze({
  none: Object.freeze([]),
  // Existing read settings retain their original capabilities.
  read: Object.freeze([...reading]),
  'read-only': Object.freeze([...reading, 'vault_read', 'vault_search', 'web_search', 'web_fetch', 'bash']),
  workspace: Object.freeze([...reading, 'vault_read', 'vault_search', 'vault_save', 'web_search', 'web_fetch', 'bash']),
});
export function workerToolScope(session) {
  const value = session?.snapshotEvents?.().findLast(event => pluginEventType(event.type) === 'notara/worker-capabilities')?.data?.tools;
  return Object.hasOwn(WORKER_TOOLS, value ?? '') ? value : 'read';
}
export const workerAllows = (session, name) => WORKER_TOOLS[workerToolScope(session)].includes(name);
export const workerPreset = id => WORKER_PRESETS.find(item => item.id === id);
