# Vault 教学迁移：实现与验收

日期：2026-09-21。分支 `codex/notara-vault-clean`，起点 `6592886`，包括本线程此前未提交的 Vault 改动；未修改 main、未提交或合并。用户选择的 A+B+C 已接入，旧学习数据不导入。

## 已实现

| 层 | 实现及真实入口 |
| --- | --- |
| A 基础教学 | 原生教学预设与普通助手选择；苏格拉底、费曼、讲解及结构分析；首发前设置、同课切换、恢复与清空；原生技能目录；资料/段落/PDF页或选区进入对话；模型目录、检索、正文与图像读取；原生批准后的 Markdown 写回与 CAS |
| B 记忆与图谱 | 画像和一体化锦囊；L0 入口、6 条候选页、180 字召回提示、4000 字正文分页；当前与已接入跨集检索；锦囊节点、标签组、组合筛选和一/二阶邻接；原生压缩后重装当前教法与本课要求 |
| C 路线与日志 | 独立路线分页及分屏；可选剧本和真实材料绑定；重复打开同课、再学一次新增节点；明确前课的固定片段；剧本内小结/自由课独立小结；时间、学习集、科目索引；保存验证后原生归档、重试与新输入保护 |

实现文件集中在 `examples/native-vault/`，教学正文在 `resources/vault-teaching/`。`agent-tools.js` 是模型工具合同的单点来源；`index.js` 是 UI Remote。二者按同一个真实会话工作区定位文件，并共用原生 writer。

## 验证分层

所有运行使用 Node **24.19.0**、临时 DSH_HOME、临时合成 Vault 和随机端口。每次实例内 `vault-plugin/` 固定插件快照，测试结束销毁临时数据；旧实例、用户 Vault、主分支及真实学习记录未操作。

| 证据层 | 结果 | 说明 |
| --- | --- | --- |
| 单元与真实文件接缝 | PASS，130/130 | 全部 `examples/native-vault/*.test.js`；包括真实 PDF 渲染、JSONL 冷恢复、CAS、未注册根拒绝、跨集解绑不误写、旧操作重试与新输入保护 |
| 原生 Host 集成 | PASS，5/5 | 两个 integration 文件；真实 HTTP、原生 session/批准/文件服务与日志，唯一替代是模型后端 |
| 浏览器核心流程 | PASS，4/4 | 布局、简约分屏与图谱、PDF框选摘录、教学设置/路线/锦囊/标签；课堂跳转与“再学一次”实际点击 |
| 小结日常预览补验 | PASS，1/1 | 在资产页显示可编辑正文，隐藏内部块元数据；包含图谱→资料的真实点击、草稿恢复、开课与再次学习 |
| 产品类型检查 | PASS | `tsc --build`；独立 Vault JS 由加载、合同与行为测试覆盖，不把 TS 通过宣称为其完整类型证明 |
| 构建 | PASS | 主仓构建、独立 Vault 客户端与资源复制 |
| 包清单 | PASS | `npm pack --dry-run --json`，0.5.0 包含 Host 模块、教学正文与预设，不含隔离数据/凭据 |
| 全仓测试类型检查 | FAIL，既有错误 | `teaching-rounds.test.ts` 的 detail、`tool-disclosure.test.ts` 的 ContentBlock.content、`journey.test.ts` 的旧数据形状；这些测试和相关原领域源码本轮未改 |
| 真实外部模型 | BLOCKED | 当前隔离环境没有 `DEEPSEEK_API_KEY`；不读取其他实例凭据作替代 |
| 真实学生教学效果 | 未运行 | 不以工具成功、测试模型回复或截图证明学生形成了更好的直觉与选路能力 |

实际运行命令（在此工作树根使用本机 Node 24 执行本地 CLI）：

```sh
NODE24=/Users/yangrundong/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node
"$NODE24" --test examples/native-vault/*.test.js
"$NODE24" node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts tests/integration/native-vault-teaching.test.ts tests/integration/native-vault-memory.test.ts --maxWorkers=1
"$NODE24" node_modules/playwright/cli.js test tests/e2e/native-vault-layout.spec.ts tests/e2e/native-vault-minimal.spec.ts tests/e2e/native-vault-pdf.spec.ts tests/e2e/native-vault-teaching.spec.ts --workers=1 --reporter=line
"$NODE24" node_modules/typescript/bin/tsc --build
"$NODE24" node_modules/tsx/dist/cli.mjs scripts/build.ts
"$NODE24" node_modules/tsx/dist/cli.mjs scripts/build-native-vault.ts
"$NODE24" node_modules/typescript/bin/tsc -p tsconfig.tests.json
```

## 原生请求证据及其限度

`native-vault-teaching.test.ts` 使用实际 Host，`vault-http.ts` 通过浏览器同一 Remote Event 通路回答批准，没有绕过工具层直接调用保存函数：

- 首条请求已经含所选费曼教法、目标与临时要求；切教法后当前生效快照改变。原生 in-history 仍保留旧快照，不能用整个历史不含旧教法来判断切换。
- 重启实例后设置和课堂身份恢复，普通预设没有教学技能与工具。
- PDF 第 2 页真实文本和对应图片附件出现在下一条模型请求中。
- 允许写入实际落盘；拒绝没有文件；外部编辑后旧引用写入失败并保留外部内容。
- 两条路线交错上课仍采用显式前课；有剧本仅追加原文，自由课独立保存，原生归档列表真实变化。

`native-vault-memory.test.ts` 验证：不点名最终方法的题目结构查询得到候选，再展开真实经历和反例；跨两个已注册工作区查询；旧 ref 拒绝；文件删除后候选刷新；三个任务 Skill 正文实际加载；原生 `/compact` 确实压缩，之后教法和临时要求仍进入请求。

该记忆流程的合成后端测量：15 条主请求、5 次记忆工具调用、首请求 29,918 字节（其中工具 schema 14,673 字节）；启动后的流程约 1.38 秒。L0 配置上限 1200 Unicode 字符，任务背景另计。数据只说明本次接线和体积，不代表真实模型延迟、费用或教学质量。

**A06、A07 的真实教学任务和 B02 的语义主动召回质量仍未验收。** 测试脚本主动发出检索调用，不能据此声称真实教师总能想起合适的经历。任务资源与加载通路已迁入，正常教学表现需外部模型验证。

## 实现裁决与失败修复

- 原生 Session.append 原来丢弃 ignorable，未知事件会导致冷读失败。严格版本补丁只补写侧信封，不扩大已知事件词表；未打补丁时插件拒绝写入。
- 总结截止点在 `tools/pre-execute` 固定，时机为真实输入已入日志、批准尚未等待。原先在 assembly 固定会得到 empty，导致归档永远不完成，已由原生 HTTP 复验修正。
- 小结第一次保存后，目标文件和集合共同固定；更换课堂背景不制造第二块。移动在原集合按课堂块定位，缺失/多义如实处理。
- 原生 fs 当前不提供额外逐集读批准 API；集合登记限定检索范围，实际读沿原生文件服务和本机访问能力，写另走原生批准。未注册工作区不能默默建立另一份 Vault。
- 画布 HTML 按钮从 SVG 子树移出；路线图例和顶栏恢复正常布局；实例复制插件避免其他构建热重载；草稿存储实现保留 Map 的读写/存在性行为。
- 独立审查的 P0/P1/P2 已修正，复审确认没有新阻塞。两个尚不触发本插件路径的 P3 观察保留在原始审查记录中，不作为产品验收通过的替代。

没有迁入旧 Proposal、多角色回合、复习调度和可执行 HTML，也没有导入旧学习数据。版本哈希仍不是可回读的历史全文仓库。

## 浏览器截图

合成资料的新隔离实例：[路线](route-bench.png)、[标签与锦囊](graph-tags.png)、[教学设置](teaching-settings.png)。
