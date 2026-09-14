# 紧凑输入栏验收

- PASS：`compact-controls-build.log`、`compact-controls-types.log`。
- PASS：`final-ui.log` 五个不同场景，包含1117px分栏同排、520px菜单不溢出、身份切换保留草稿、首页及HTML安装回归。
- PASS：`compact-menu-icons-ui.log` 一个场景，七项图标可见、保留原草稿/附件、点击不发送，发送时原生Skill才加载。
- 初次失败保留于 `initial-regression.log`：旧断言把新的按钮当select，修正后五项回归全部通过。
- `ui/`：紧凑排列和菜单截图；`menu-icons/`：加号菜单图标截图。隔离测试模型，不代表真实教学质量。
- `preview.json`：已有58354客户端的实际发布哈希，学习资料和原生会话保持。

命令（dsh，Node24.13.0）：

```sh
npm run build
npm run typecheck:tests
npm run test:e2e -- tests/e2e/creator-workspace.spec.ts tests/e2e/artifact-preview.spec.ts tests/e2e/conversation-home.spec.ts tests/e2e/workspace-docking.spec.ts --grep 'creator identity|HTML artifact|learning modes|compact Agent|student controls'
npm run test:e2e -- tests/e2e/skill-draft.spec.ts
```
