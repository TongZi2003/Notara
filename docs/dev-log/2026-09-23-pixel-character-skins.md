# 2026-09-23 像素教室五种角色外观

## 目标与实际改动

在 `codex/notara-vault-clean` 工作树的现有教室像素视图替换角色，并用真实浏览器截图检查。工作树已有大量未提交改动；本轮只写像素插件、它的构建适配和本记录，安装前逐文件检查原始摘要。

- `examples/pixel-classroom/package.json`：0.3.0 → 0.4.0。
- `src/character-skins.ts`：大肥鱼、GPT、Claude、Kimi、GLM 的统一登记、默认外观、按岗位保存的本地选择、图集解码。
- `src/ClassroomApp.tsx`：显式 palette、hueShift=0；复用已有角色对象更新外观，不重建任务或座位；人物详情提供折叠外观入口。
- `src/character-art.ts`、`src/sprite-cache.ts`：在原 16×32 世界坐标矩形中绘制较清晰的角色帧。保留原始逻辑帧，轮廓、点击、出入场特效及家具仍使用原版引擎。镜像匹配只在首次遇到帧对象时计算，后续用 WeakMap。
- `scripts/build-pixel-classroom.ts`：新增独立绘图缓存适配的构建别名，不编辑上游源码。
- `public/assets/ai-characters/`：五套 112×96 逻辑图集及 448×384 细节图集，合计105帧；每套正面/背面/侧面、行走/工作/阅读。独立署名文件区分同人角色和上游 MIT 家具/引擎。
- `art/ai-characters/`：保留内置 image_gen 生成源图、提示规格、机械导入脚本和导入报告。校正生成的大肥鱼侧面方向，统一尺度和脚底基线。Kimi 的工作帧采用生成的茶具姿态。

## 生图接口修复

本轮另按用户授权修复了本机 `/Users/yangrundong/.codex/model-router/router.mjs`：只新增 POST `/v1/images/generations` 与 `/v1/images/edits` 两个精确入口，原样转发 JSON/压缩体/multipart 到原 OpenAI 订阅后端。现有 OpenAI/DeepSeek 对话分流及凭据隔离不变。

- 原实现新图片用例先失败为404；修复后的18项原路由测试与10项图片测试全部通过（28/28）。
- 图片接口真实验证：1次无参考生图、5次带参考图生成，路由日志均为 OpenAI HTTP 200。
- 补丁已经安装并重载，健康检查200。原文件备份：`~/.codex/model-router/backups/image-routing-20260923-124455/`。没有新增图像API key或改用CLI生图。

## 验证

- PASS 构建：Node 24.13.0 执行 `node node_modules/tsx/dist/cli.mjs scripts/build-pixel-classroom.ts`，输出547546 bytes。
- PASS 类型：`node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM --skipLibCheck examples/pixel-classroom/src/character-skins.ts examples/pixel-classroom/src/character-art.ts examples/pixel-classroom/src/sprite-cache.ts`。
- PASS 资产：10张生产图集尺寸、alpha通道、各21个非空帧检查；方向与细节图集人工目检。
- PASS 真实浏览器：Codex 内置浏览器进入新隔离实例的「教室→像素」，实际显示五种外观、六个岗位；折叠外观选择包含五项；核验员由Claude换为Kimi后岗位仍为review，刷新重进后保持Kimi，最后恢复Claude。
- PASS 浏览器控制台：本次捕获 error/warn 为空，包含刷新后的新初始化。
- 截图自检：人物未显示黑色底框，比例、地面占位、侧面和背面可读；细节图集避免直接16×32压缩造成的五官丢失；折叠时保持原界面简约。
- 验证实例：`http://127.0.0.1:64880/`，数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-eHyv1f`，入口为 `scripts/dev-isolated.ts` 的 `startVaultIsolated({pixelClassroom:true,testModel:true})`。使用合成资料与测试模型，正式数据和已运行的其他实例未改。
- 未运行：本轮没有付费真实模型教学质量验收；完整后台任务执行/取消/查看分析流程没有重跑，不由空任务状态或截图推定。

证据：`docs/evidence/pixel-character-skins/classroom-final.png`、`character-picker-final.png`、`verification.json`、`console.json`。

## 下一入口

新版已在工作树构建并在独立课堂显示，浏览器预览保留。日常服务仍需要按现有启动器的冻结插件快照升级流程启动新版，不能把旧实例的显示当作0.4.0的证据。
