import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundled = new URL('./teaching/manifest.json', import.meta.url);
const source = new URL('../../resources/vault-teaching/manifest.json', import.meta.url);
const manifestUrl = existsSync(bundled) ? bundled : source;
const root = new URL('./', manifestUrl);
const resourceUrl = path => {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) throw new Error('teaching_resource_invalid');
  let url;
  try { url = new URL(path, root); } catch { throw new Error('teaching_resource_invalid'); }
  if (url.protocol !== root.protocol || url.host !== root.host || !url.pathname.startsWith(root.pathname)) throw new Error('teaching_resource_invalid');
  return url;
};
export const TEACHING_PRESET = 'notara-teacher';
/**
 * The shipped teaching skills describe a Desktop contract. Keep their bodies
 * intact and append this explicit Web-host translation to the live prompt.
 */
export const WEB_PLATFORM_MAPPING = `## Web 平台工具映射
以下映射是 Web 宿主说明，不改写上方学习 Skill 原文，也不增加本轮权限。只能调用实际工具清单中存在的能力；缺少工具、权限或回执时说明限制，不伪造完成。

- Desktop 的 notara <cmd> 在 Web 不是 shell 命令。主教师通过实际的 vault_command 工具传入 {command, input}，只调用它公布的领域命令；write-batch 使用 command="write-batch"、input={files: [...]}。不要拼接桌面 CLI、--input 参数或临时命令。工作员没有 vault_command；只用本次实际提供的 vault_read、vault_search、vault_save、bash 等工具及其当前权限。
- 白板只由主教师的 write_lesson_board 操作：先 list / read，再用真实 expectedRevision 和 ops 调用 apply；交互图的局部 sceneOps 放在对应 patch 操作旁。需要时用该工具的 undo 和真实 commitId。工作员不得直接改白板文件，也没有白板工具。
- 课堂设置、打开课程节点和正式小结分别使用主教师实际提供的 set_teaching_settings、open_learning_lesson、save_lesson_summary。它们不是通用文件命令；工作员不能代行课堂生命周期操作。
- 加载教学 Skill 时使用当前请求实际提供的原生 skill 工具；工作员没有该工具时，只依据 Host 已注入的 Skill 正文。Vault 内普通学习资料用实际提供的 vault_read / vault_search。固定教学示例资源只有在 Bash 实际提供且 DSH_NOTARA_TEACHING 已设置时，才可从该变量指向的目录读取；不要猜测路径。不要模拟 notara skill 或 notara resource 命令。
- PDF 书签和页面只在主教师拥有 vault_command 时使用 pdf-outline、pdf-page，以 input.path 和真实页码读取。页面图像作为 Host 附件返回，是否可供当前模型查看取决于图像输入能力；没有图像回执或能力时，不声称核对了页图。要把 PDF 原页交给工作员时，把 pdf-page 回执中的 embed 原样放进 ask_worker.sources；Host 会重新核对 PDF revision 并按工作员模型图像能力传图。Web 没有 Desktop 的 imageRef / recovery CLI 参数；读取或保存冲突时重新读取并核对真实 revision，不绕过版本检查。工作员无 vault_command 时不得假定可运行这些命令。
- 联网只用本轮工具清单中的 web_search / web_fetch，并遵守提供者、凭据和沙箱实际结果。允许列表、Bash 或桌面 Skill 原文都不能单独证明联网可用；失败时如实报告未验证。`;
export const teachingManifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
export const teachingChoices = teachingManifest.choices.map(({id,title,description})=>({id,title,description}));
export const defaultTeachingRef = teachingManifest.default;
/** Previously saved calls and classroom drafts can still resolve to the merged resources. */
export const teachingLegacyAliases = Object.freeze({
  socratic: 'mixed', feynman: 'mixed', lecture: 'mixed', structural: 'mixed',
  brainstorm: 'consolidation', 'markdown-handout': 'material-outline', 'route-planning': 'lesson-preparation',
});
export function canonicalTeachingId(id) { return teachingLegacyAliases[id] ?? id; }
export function teachingResource(path) {
  return readFileSync(teachingResourcePath(path), 'utf8');
}
export function currentTeachingBody(id) {
  const choice = teachingManifest.choices.find(item=>item.id===canonicalTeachingId(id));
  if (!choice) throw new Error('teaching_choice_invalid');
  return teachingResource(choice.file);
}
export function teachingResourcePath(path) {
  try { return fileURLToPath(resourceUrl(path)); }
  catch (error) {
    if (error instanceof Error && error.message === 'teaching_resource_invalid') throw error;
    throw new Error('teaching_resource_invalid', { cause: error });
  }
}
