/**
 * 人格文本的纯装配。
 *
 * 这里不读文件、不 import 任何 Node 或客户端模块：默认形象正文由 Host 在组装系统提示时传入
 * （`teacherPersona(settings, teachingResource('persona.md'))`），同一套规则也给工作员拼独立人格。
 * 所以教师运行时与浏览器 bundle 都能直接引用它，不会把 Node 依赖带进客户端。
 *
 * 输出只取决于当前配置：同一份 persona 永远得到同一段文本，不掺时间、随机数或轮次提醒，
 * 模型请求的稳定前缀才不会被每轮改写。人格只改表达方式，不改职责、权限与真实性。
 */

/** 老师人格与工作员人格共用的长度上限（字符数）。 */
export const PERSONA_TEXT_LIMIT = 4000;

/** 归一化人格文本：非字符串或纯空白一律当作「未设置」，回落到默认角色。 */
export function personaText(value) { return typeof value === 'string' ? value.trim() : ''; }

/** 自定义老师人格只改说话方式：教学职责、工具与权限边界、真实性要求不变，仍用中文回应。 */
const TEACHER_STYLE_GUARD = '以上人格只决定称呼、语气与表达风格，不改变你的教学职责、工具与权限边界以及真实性要求；仍按中文回应学生。';

/** 工作员同样只是换了说话方式：职责、材料边界、工具范围与交付要求由角色正文决定。 */
const WORKER_STYLE_GUARD = '以上人格只决定称呼、语气与表达风格，不改变你的工作员职责、材料边界、工具范围与交付要求；仍按中文交付。';

/**
 * 老师的人格正文。没写自定义人格就用 Host 传入的默认形象；写了就用它替换默认形象，
 * 并明确风格不覆盖职责、权限与真实性。默认正文原样返回，所以不配置时提示完全不变。
 */
export function teacherPersona(settings, defaultText) {
  const custom = personaText(settings?.persona);
  if (custom) return `${custom}\n\n${TEACHER_STYLE_GUARD}`;
  return typeof defaultText === 'string' ? defaultText : '';
}

/**
 * 工作员的人格正文：角色任务正文 + 这一位工作员的独立人格。
 * 空串只用角色任务正文（旧配置与不配置的行为一致），填写后也只是追加风格，不换角色、不扩权限。
 */
export function workerPersona(roleText, persona) {
  const custom = personaText(persona);
  return custom ? `${roleText}\n\n## 独立人格\n\n${custom}\n\n${WORKER_STYLE_GUARD}` : roleText;
}
