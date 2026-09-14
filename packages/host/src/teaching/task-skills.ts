import type { Context } from '@deepseek-ai/cordis';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { TeachingChoice } from '@studyforge/contracts/teaching';
import { activeArtifacts, artifactSkillName, installedBody } from '../creation/artifact-service.ts';

export function taskChoices(host: Context): TeachingChoice[] {
  return [...TASK_SKILLS, ...activeArtifacts(host).filter(item => ['skill', 'html'].includes(item.manifest.kind)).map(item => ({ id: artifactSkillName(item.ref, item.digest), title: item.manifest.title, description: item.manifest.description || '使用这份教学作品' }))];
}

/** Display labels survive disable/uninstall; this is not a callable skill catalog. */
export function taskLabels(host: Context): { id: string; title: string }[] {
  const labels = [...TASK_SKILLS.map(({ id, title }) => ({ id, title })), { id: 'studyforge-quiz', title: '出一组题' }];
  for (const row of host.studyforgePluginsManager.records.list(host.studyforgePluginsManager.context())) for (const version of row.data.versions) {
    if (version.creation) labels.push({ id: artifactSkillName(version.creation.ref, version.creation.digest), title: version.manifest.notara.title });
    else for (const item of version.manifest.notara.skills) labels.push({ id: artifactSkillName(row.ref + '#' + item.id, version.digest), title: item.title });
  }
  for (const row of host.studyforgeInstalledArtifacts.list(host.studyforgePluginsManager.context())) for (const version of row.data.versions) labels.push({ id: artifactSkillName(row.data.projectRef, version.digest), title: version.manifest.title });
  return labels;
}

export const TASK_SKILLS: readonly TeachingChoice[] = [
  { id: 'studyforge-semantic-search', title: '按语义查找', description: '根据当前问题检索原文、卡片和知识，解释匹配依据并定位出处。' },
  { id: 'studyforge-essay-review', title: '作文批改', description: '按明确任务和评价标准批改作文，给出可执行的修改意见。' },
  { id: 'studyforge-markdown-handout', title: '整理成讲义', description: '将指定内容整理为带出处、结构清晰的 Markdown 讲义。' },
  { id: 'studyforge-html-demo', title: '互动演示', description: '制作可预览、可修改的 HTML 教学互动演示。' },
];

/** One native skill source serves slash gestures, the plus menu and model use. */
export function installTaskSkills(host: Context, directory: string): void {
  host.effect(() => host.skills.registerProvider(control => {
    const dispose = host.studyforgePluginsManager.subscribe(control.invalidate);
    control.signal.addEventListener('abort', dispose, { once: true });
    return ({
    name: 'studyforge-tasks',
    async list(options) {
      if (options.signal?.aborted || !options.cwd || realpathSync(options.cwd) !== host.studyforgeAccess.root) return [];
      return taskChoices(host).map(skill => ({ name: skill.id, description: skill.description, provider: 'studyforge-tasks', source: 'bundled',
        invocation: { modelInvocable: true, userInvocable: true }, rank: 20, locator: skill.id }));
    },
    async get(candidate, options) {
      if (options.signal?.aborted || typeof candidate.locator !== 'string') return undefined;
      const installed = activeArtifacts(host).find(item => artifactSkillName(item.ref, item.digest) === candidate.locator);
      if (installed) {
        const resource = installedBody(host, installed.ref, installed.digest);
        return { name: candidate.name, description: candidate.description, provider: 'studyforge-tasks', source: 'workspace', invocation: candidate.invocation,
          content: resource.manifest.kind === 'html' ? `使用已安装互动演示「${resource.manifest.title}」。通过draft_artifact准备kind=html、title=${resource.manifest.title}的课堂作品，保持以下HTML正文供学生直接预览：\n${resource.body}` : resource.body };
      }
      if (!TASK_SKILLS.some(skill => skill.id === candidate.locator)) return undefined;
      return { name: candidate.name, description: candidate.description, provider: 'studyforge-tasks', source: 'bundled', invocation: candidate.invocation,
        content: readFileSync(join(directory, 'skills', candidate.locator + '.md'), 'utf8') };
    },
  }); }));
}
