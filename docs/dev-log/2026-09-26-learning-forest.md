# 浅色主题学习森林（0.16.20）

日期：2026-09-26。工作树：`/Users/yangrundong/DSH`，分支 `design/minimal-polish`，基线 `f9d0003` 加未提交工作区。插件版本 0.16.19 → 0.16.20。未提交、未合并、未更新真实用户实例。

## 目标

用户预览星图后否定了浅色主题的两个候选：暮色和花园，其中花园被认为“太猎奇”。改为在浅色主题下用 Forest（专注森林）式等距森林表达同一份学习投影。深色主题保留深夜星图。以下三点经用户确认：

- 知识图谱使用 Forest 式地块，不画关系线。
- 课程路线使用林间小路。
- 暮色、花园两个候选以及 `notara-star-day` 浏览器开关全部删除。

## 实际改动与锚点

- `examples/native-vault/star-light.js`（新）：`starHash`、`starLight`、`splitTree` 从星图模块抽出，星图与森林共用，避免两个模块互相引用；`star-map-client.js` 重新导出前两者。
- `examples/native-vault/forest-client.js`（新）：
  - `forestLayout`：每个拆分树的根占一块方形地块，节点按层级种在离父节点最近的空格，外圈一格不种树；没有拆分关系的节点合入“草甸”；地块按行打包，前角格立专题木牌（`groups`）。
  - `routeForestLayout`：主线沿 `j=0` 的土路排开；补练在路下、拓展在路上；阶段路牌立在该阶段首课之前的路边。
  - `forestGrowth` / `FOREST_FORMS`：土堆、嫩芽、小树苗、树、阔叶树、灌木、石头、银杏、木桩，不存在枯死或失败形态。
  - `forestLush`：只有已点亮的节点让脚下草地变绿，覆盖度由此在地面上呈现。
  - `forestHit`：点击热区按树高、窄于格子；前排格子的层级更高。
  - `forestBounds`：适配视图时框住整块地和树冠。
  - `paintForest` / `paintForestNode`：左亮右暗的双色扁平画法，只有轻微摇动与首次长成两种动效。
- `examples/native-vault/star-map-client.js`：
  - 删除 `DAY_SKIES`、暮色 `SKIES.dusk`、花园全部绘制代码和 `notara-star-day`。
  - `skyOf` 在深色主题返回 `night`，其余返回 `forest`；`StarMap` 按主题选择 `paintForest` 或星空绘制。
  - 主题切换会触发重新适配视图；画布用 `isolation:isolate`，树的 z-index 不会越出画布。
  - 森林下的标签：专题靠木牌，树只在放大后或悬停/选中时显示名称，课程名始终显示。
  - `StarLegend` 改为按主题的 `LEGEND` 表；`StarReading` 在森林下使用“生长 / 状态”措辞；`createStarMap` 返回 `useSky`。
- `examples/native-vault/views-client.js / GraphView`、`examples/native-vault/routes-client.js`：按主题选择 `forestLayout` / `routeForestLayout` 或原星图布局。入口在浅色下叫“森林”，画布叫“知识森林 / 课程森林”。掌握度读取失败的提示改为中性的“掌握度暂时…”。
- `tests/e2e/native-vault-star-map.spec.ts`：
  - 浅色走森林路径：木牌、图例、“生长”详情，旧的 `notara-star-day` 不再生效。
  - 深色实时切到深夜，课程页在两种主题下都覆盖。
  - 画面变化检查改为统计 RGB，因为森林地块不透明，树摇动时透明度通道不变。
- `examples/native-vault/forest-client.test.js`（新）：覆盖生长、草地、热区、布局、路线和适配边界，共 9 项。
- `docs/superpowers/specs/2026-09-25-learning-star-map-design.md`：白昼方案改为森林，新增“森林视觉映射”；状态行原来指向不存在的 `2026-09-25-learning-star-map.md`，改为指向本文。
- `examples/native-vault/package.json` 升到 0.16.20；`AGENTS.md` 补充当前事实行；`client.js` 为重新构建的分发产物。

## 验证

| 层级 | 结果 | 命令与证据 |
| --- | --- | --- |
| 单元 | PASS，342/342 | `node --test examples/native-vault/*.test.js`。其中一次整套运行里 `math-latex.test.js` 的“multiline display math and chemistry…”失败一次，单独连跑 3 次、整套重跑都通过；该文件本轮未改动，记为偶发，尚未定位 |
| 森林单测 | PASS，9/9 | `node --test examples/native-vault/forest-client.test.js`；各项先见红再实现 |
| 构建 | PASS | `npm run build:native-vault` |
| 类型检查 | PASS | `npm run typecheck` |
| 合同检查 | PASS，96 | `npm run check:contracts` |
| e2e 星图 | PASS，1/1 | `npm run test:e2e -- tests/e2e/native-vault-star-map.spec.ts`，含控制台错误断言 |
| e2e 极简回归 | PASS，2/2 | `npm run test:e2e -- tests/e2e/native-vault-minimal.spec.ts` |
| 真实浏览器截图 | 已人工查看 | `docs/evidence/learning-forest/`：知识森林、课程森林、深夜、801px、深色课程；截图脚本同时记录页面报错为 0 |
| 真实模型 / 真实学生体验 | 未运行 | 合成资料与测试模型，不做教学质量结论 |

## 运行环境

- 预览使用 `startVaultIsolated({ testModel: true })` 的隔离实例和 E2E 同款合成资料；预览另加一个“函数与导数”专题，共 13 张卡片。
- 每次重新构建后都会停掉旧实例、用新快照重启；最后一次实例为 `http://127.0.0.1:51204/`。启动脚本和截图脚本放在会话临时目录，不进仓库。

## 未完成与下一入口

- 大图下森林逐格绘制，没有做离屏缓存；超过数千节点时的帧率未测量。
- 草地只根据当前画出来的节点变绿：逐级展开尚未展开的叶子不会让草地变绿，父节点树的大小仍然反映完整聚合。
- `math-latex.test.js` 的偶发失败需另查。
