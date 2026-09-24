# 极简前端收尾与主分支整合

## 范围

用户明确要求把本轮前端、首页和白板工作合并到本地主分支，并暂时只开放极简主题。另将设置弹窗左栏整理为紧凑导航。

- `modern-theme.css / nv-sidebar > nav`：收窄原来误匹配设置弹窗导航的后代选择器。设置左栏恢复顶对齐，标题与菜单相距18px，行高36px，选中项使用浅灰背景和小圆角。深色模式使用同一语义色；390px窄屏切换为顶部横向导航。
- `appearance.ts / readAppearance`：既有手帐配置不会重新激活未打磨主题，其纸张和字迹偏好字段继续保存。客户端与设计原型收起手帐选择入口，默认极简；保留素材，未删除手帐设计。
- Native Vault 发布版本 `0.16.13`，包含此前已验收的统一课堂顶栏、原生首页输入、单条待办、超过5张的复习汇总、双面流式白板和空板留白。
- 主目录既有研究文档不在此次前端提交范围内，不覆盖或清理。旧插件与 Native Vault 是仓库已有的独立运行入口，本次不擅自删除旧入口；日常推荐继续使用 README 的 `npm run vault`。

## 合并前验证

- PASS：`node --test examples/native-vault/*.test.js`，286/286；含板书、工具、流式参数、作用域、首页与队列投影。
- PASS：`npm run test:unit -- tests/unit/appearance.test.ts tests/unit/workspace-layout.test.ts`，6/6。
- PASS：`npm run typecheck`；Native Vault 构建5588369字节。
- PASS：真实浏览器设置导航的浅色、深色和390px窄屏操作断言；菜单与内容切换有效，控制台错误0条。证据在 `docs/evidence/settings-minimal/`。
- 首页输入框、草稿保留、发送入课、5/6/12张复习边界、两处标题居中与白板留白的浏览器断言见 `docs/evidence/home-native-composer/`。
- 未运行：真实模型教学质量、真实学生体验。本轮所有运行数据为隔离合成数据。

## 运行环境

收尾 UI 验证实例由 `scripts/dev-isolated.ts / startVaultIsolated` 启动，URL `http://127.0.0.1:65249/`，数据根 `/var/folders/6m/q0d3bw_55vl_r7px9ktfj33w0000gn/T/notara-vault-native-YoURHo`。源码工作树 `/Users/yangrundong/DSH-frontend-design`，分支 `codex/notara-modern-ui`。

合并与合并后的核验结果在完成操作后补充。
