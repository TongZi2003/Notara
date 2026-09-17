import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { TeachingResourceSchema } from '@studyforge/contracts/teaching';
import { toolSchema } from './tool-schema.ts';
import { teacherContext, rejected } from './learning-context.ts';
import { proposeFromTool, proposalOutput } from './proposal-tools.ts';
import { bundledNodes, overrideRef, overrideRow, teachingResource } from '../teaching/teaching-overrides.ts';

const readInput = z.object({ nodeId: z.string().min(1) }).strict();
const proposeInput = z.object({ nodeId: z.string().min(1), body: z.string().min(1) }).strict();

/** Teacher-side transparency and co-authoring over the bundled teaching texts. */
export function registerTeachingTools(host: Context): void {
  host.effect(() => host.tools.register({
    name: 'read_teaching',
    description: '读取一份内置教学文本的当前生效版本：共同规则、诊断引导、教学预设、任务技能或委派角色。返回标题、来源、是否被本空间覆盖与完整正文。改动教法前先读同一 nodeId 的现行文本。',
    parameters: toolSchema(readInput),
    output: { schema: toolSchema(TeachingResourceSchema),
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(TeachingResourceSchema.parse(value)) }] },
    async execute(args) {
      const { nodeId } = readInput.parse(args);
      return teachingResource(host, nodeId);
    },
  }));
  host.effect(() => host.tools.register({
    name: 'propose_teaching',
    description: '向学生提案修改一份内置教学文本（共同规则/教学预设/任务技能/委派角色）。先用read_teaching读同一nodeId的现行正文，改动后的完整正文放进body；学生确认后才成为本空间覆盖版本，内置原文始终保留可恢复。不要把对单个学生的教法判断写成全局教法。',
    parameters: toolSchema(proposeInput), output: proposalOutput(),
    async execute(args, execution) {
      const { nodeId, body } = proposeInput.parse(args);
      const node = bundledNodes(host).find(item => item.id === nodeId);
      if (!node) throw rejected('这个nodeId不是可修改的内置教学节点；先read_teaching列出可修改项');
      await teacherContext(host, execution);
      const baseline = overrideRow(host, nodeId)?.version ?? 0;
      return proposeFromTool(host, execution, { title: '修改教法《' + node.title + '》',
        items: [{ target: overrideRef(nodeId), baseline, effect: { kind: 'teaching-override', nodeId, title: node.title, body } }] });
    },
  }));
}
