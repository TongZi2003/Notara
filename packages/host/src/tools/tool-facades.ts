import type { Context } from '@deepseek-ai/cordis';
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { TOOL_FACADES, resolveFacadeTool } from '@studyforge/contracts/tool-facades';
import { rejected } from './learning-context.ts';

/**
 * Constant wire surface over the full classroom registry. Each facade's
 * `method` field names the wrapped tool; `input` carries that tool's own
 * parameter schema verbatim, so there is exactly one parameter contract per
 * operation. The wrapped tools stay registered and callable — a model that
 * already knows an exact name may still call it, and history written by either
 * form resolves through TOOL_FACADES.
 */
const FACADE_DESCRIPTIONS: Record<string, string> = {
  find: '列出或检索资料、卡片、学习集、计划、学习记录和作答证据。method选范围，input填该方法的完整参数。',
  open: '读取一个学习对象的完整内容：资料原文、卡片、方法笔记、学情记录、学习集、计划、路线、目录骨架、本课安排、课后小结、Markdown文档或当前教法。',
  note: '记录学习事实与想法：学情观察与更正、方法笔记与修订、学习目标、思维图标记。同一对象的再次观察用*_revise并入已有记录，不另建新档。',
  update: '直接修改已确认存在的对象：卡片内容、Markdown资料。先open读取再改。',
  record: '登记窄直写事实：复习记录、诊断批量登记卡片、引用本课资料。',
  propose: '向学生提交待确认提案：卡片、复习、学习集、计划、路线、目录、本课设置、课后小结、新同学、教法。确认前未生效，不替学生确认。',
  create: '新建资料或作品：Markdown资料、导入已上传文件、可共同编辑的作品草稿。',
  board: '课堂工作台：列出与读取工作文档、更新文档、查看学生和教师在工作台上的写入轨迹，数学场景的读取、编辑、还原与计算。文档schema由读取结果给出。',
  classroom: '教室与同学：查看教室状态、向同学派发或追问任务、与学生共建世界书条目、调整情景亲密度。',
  stage: '课堂阶段：读取思维图阶段、原子推进当前阶段、沉淀已结束阶段的小结。',
  delegate: '委派独立帮手：检索、命题、助教、同伴角色任务；返回真实childId后用send_message/interrupt_agent管理。帮手全部只读——产物以原话或受控登记返回，任何写入与提案只能由本会话提交，不要派帮手去保存或提案。',
  round: '多角色教学回合：命题→学生作答→同伴评审→助教勘误。open开一轮，answer把学生原话送入，correct推进勘误，read看状态，stop收止。学生在回合面板也可作答与求勘误，同一份记录。',
};

const callShape = z.object({ method: z.string().min(1), input: z.unknown() }).strict();

/** pi-ai tags tool calls whose argument payload never parsed; surface the real
 * cause instead of a schema error so the model stops retrying formats. */
function malformedRaw(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const raw = (args as { __malformed_arguments?: unknown }).__malformed_arguments;
  return typeof raw === 'string' ? raw.slice(0, 200) : undefined;
}

function innerOf(facade: string, args: unknown): string | undefined {
  return resolveFacadeTool(facade, args);
}

function innerInput(args: unknown): unknown {
  return args && typeof args === 'object' && !Array.isArray(args) ? (args as { input?: unknown }).input : undefined;
}

/** Per-facade one-line method table for the constant prompt section. */
export function facadeMethodText(host: Context): string {
  const sections: string[] = [
    '# 本课能力',
    'tools里是常驻的全部能力，不再按需加载：每个门面工具用method选具体操作、input填该操作的完整参数，参数形状以该方法自身的schema为准。下面按门面列出method及用途说明（括号内是内部实现名，直呼同样有效）。',
  ];
  for (const [facade, methods] of Object.entries(TOOL_FACADES)) {
    const rows: string[] = [];
    for (const [method, inner] of Object.entries(methods)) {
      const def = host.tools.get(inner);
      const summary = def?.description.split(/[。；\n]/u)[0]?.replace(/\s+/gu, ' ').trim() ?? '';
      rows.push(`- ${method}（${inner}）— ${summary}`);
    }
    sections.push(`## ${facade}\n${rows.join('\n')}`);
  }
  return sections.join('\n\n');
}

export function registerFacadeTools(host: Context): void {
  for (const [facade, methods] of Object.entries(TOOL_FACADES)) {
    const options = Object.entries(methods).map(([method, inner]) => {
      const def = host.tools.get(inner);
      if (!def) throw new Error(`facade_inner_missing:${inner}`);
      return { method, inner, parameters: def.parameters };
    });
    const parameters = {
      oneOf: options.map(option => ({
        type: 'object',
        properties: {
          method: { type: 'string', const: option.method },
          input: option.parameters,
        },
        required: ['method', 'input'],
        additionalProperties: false,
      })),
    } as JsonSchemaNode & Record<string, unknown>;
    const definition = (args: unknown): ToolDefinition | undefined => {
      const inner = innerOf(facade, args);
      return inner ? host.tools.get(inner) : undefined;
    };
    host.effect(() => host.tools.register({
      name: facade,
      description: `${FACADE_DESCRIPTIONS[facade] ?? '课堂能力'} method只能取本工具schema中列出的值。`,
      parameters,
      output: {
        // Wrapped methods return different canonical shapes; the annotation-only
        // schema is the subset's unconstrained form, and each value is rendered
        // and meta-projected by the wrapped definition it actually came from.
        schema: {} as JsonSchemaNode,
        render: (args, value) => definition(args)?.output.render(innerInput(args), value)
          ?? [{ type: 'text' as const, text: JSON.stringify(value) }],
        presentationMeta: (args, value) => definition(args)?.output.presentationMeta?.(innerInput(args), value) ?? null,
      },
      async execute(args, execution) {
        const malformed = malformedRaw(args);
        if (malformed !== undefined) throw rejected(`${facade}的调用参数未能通过解析（原始片段：${malformed}）——是模型输出的工具参数格式与传输层不兼容，不是参数填错。请如实告知用户：当前模型可能无法正常使用课堂工具，建议切换模型后重试；不要再重复同一调用。`);
        if (args === null || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length === 0) throw rejected(`${facade}收到的调用参数为空。若你已在调用中填写了 method 与 input，说明参数在送达前丢失——当前模型可能与工具传输格式不兼容。请如实告知用户并建议切换模型，不要继续重复同一调用。`);
        const data = callShape.parse(args);
        const inner = innerOf(facade, data);
        if (!inner) throw rejected(`method=${data.method}不在${facade}的方法列表中；从该工具schema列出的method中选择`);
        const def = host.tools.get(inner, execution.agent);
        if (!def) throw rejected(`${facade}的${data.method}方法当前不可用`);
        return def.execute(data.input ?? {}, execution);
      },
    }));
  }
}
