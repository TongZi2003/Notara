# 大肥鱼默认人设补全

日期：2026-09-23。工作树 `codex/notara-vault-clean`，Native Vault 0.14.9。

## 目标与改动

按用户要求，基于少量公开资料补全默认大肥鱼人设。沿用用户确定的“爱吃白饭的鲸鱼娘女仆”，不增加世界书机制或新人物配置。

- `resources/vault-teaching/persona.md`：补充形象、性格反差、喜好、称呼、说话节奏、情境短句、教学互动和助教协作习惯；保留首次介绍在工具完成后的最终可见答复中出现的约束。
- 人格与教学职责分层：保持教法可切换、实际证据判断学情、只有真实记录才能提起共同经历。人格不扩大权限，也不保证模型能力。
- `examples/native-vault/package.json`：0.14.8 → 0.14.9，供后续安装识别更新。默认人格仍由 `teacherPersona` 加载；已保存的自定义人格不被替换。
- 来源放在本记录，不进入常驻人格正文；没有引入逐轮随机内容、时间或动态提醒。

## 公开依据与创作边界

本轮于 2026-09-23 只读核对以下公开来源：

| 来源 | 实际核对到的信息 | 人设采用方式 |
| --- | --- | --- |
| [DeepSeek-R1 官方 README](https://github.com/deepseek-ai/DeepSeek-R1/blob/main/README.md)，Introduction / Model Summary | 官方公开推理模型与开放研究，描述 R1-Zero 的 self-verification、reflection 行为 | 将认真求解、愿意核验与纠错作为创作灵感；不是当前模型能力保证，也不是官方人格 |
| [ZipZipPipe《大AI和小AI们》](https://www.bilibili.com/video/BV1tE9XBbErS)，通过公开视频信息接口读取标题、作者和简介 | 作者明确作品为 AI 拟人娘化，鲸鱼娘基于“上善无形”原创角色二创，并声明 CC BY-NC-SA 4.0 | 延续已在像素教室署名的鲸鱼娘参考；不据此推断所有性格与白饭喜好都有统一原设 |
| [原作者动态链接](https://t.bilibili.com/1231980045693616162)，由作者提供的 [短链](https://b23.tv/Kn7yvnF) 重定向得到 | 已核实跳转目标；动态正文接口返回 -352，未取得正文 | 原作细节仍未独立核实，不引用未读到的人设或许可正文 |

蓝发、白头饰、深蓝裙与白围裙、小鲸尾来自本项目已生成形象，见 `examples/pixel-classroom/art/ai-characters/prompt-specifications.json` 的 deepseek 项；既有外观署名继续以 `public/assets/ai-characters/ATTRIBUTION.md` 为准。

白饭喜好、女仆教师定位由用户确定；温厚务实、粉笔便笺、轻微自嘲、关注策略选择等是本项目原创的教学适配，不宣称为 DeepSeek 官方设定，也未从公开视频复制台词。

## 验证与生效范围

- PASS：`npm run build:native-vault`，以 Node v24.13.0 构建。
- PASS：`node --test examples/native-vault/persona.test.js examples/native-vault/teaching-resources.test.js`，7/7；资源源文件与构建副本一致，默认／自定义人格装配和工作员隔离检查通过。
- PASS：`git diff --check`；正文 1820 字符，低于既有人格设置 4000 字符上限。人工读稿核对语气、边界和首次介绍约束，没有把具体措辞写成测试断言。
- 未运行：真实模型长对话、浏览器新人设演示；本轮不以资源检查宣称角色长期稳定。

仅改人格正文和包版本，未修改 UI、工具或持久化接线。当前已打开的隔离课堂仍使用创建时安装的旧快照，不热改快照，不把旧页当作新人设的验收证据；新文案随下一次安装或新实例加载。
