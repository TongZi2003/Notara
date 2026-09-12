# P7 最终浏览器验收记录

此文件根据 validation 子 Agent 的实际工具返回归档，**不是复制的进程 stdout**；原始 Playwright 结果状态见 `browser-last-run.json`，主 Agent 已检查截图与相关测试源码。

命令（Node v24.13.0；当前 dsh 目录；正式构建；独立临时 runtime）：

```sh
node node_modules/@playwright/test/cli.js test \
  tests/e2e/coauthor-handoff.spec.ts tests/e2e/lesson-continuity-native.spec.ts \
  --output .runtime/p7-accepted-results --reporter=list
```

结果：exit 0，5/5 PASS，0 skip，1.3 分钟。

1. 学生改写小结正文后确认：截止点与清单不动，小结与关闭一次写入且重启仍在。
2. 更正写出新的一版，接续课固定在明确选定的旧版上。
3. 课后小结在课上可读可改，并能从这一版真的开出一节接续课。
4. 同一次开课重试只开一节课，也不按日期自动顺延。
5. 原生收课→课后输入→同日日历日报→从这版开下一节并固定 pin。

第 3 项通过实际可见按钮开课，断言 composer `contenteditable=true`，从 UI 发送后核对新 Session 的实际模型请求。第 5 项在 Playwright runner 内主要走真实 native Remote，未冒称整项都经浏览器交互。二者均使用可控模型 adapter，不是实模。
