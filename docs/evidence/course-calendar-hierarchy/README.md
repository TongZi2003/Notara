# 课程 / 日历 / 模型图标验收

2026-09-14，Node v24.13.0，独立临时Host与锁定的Playwright。界面使用真实Remote与原生Session，涉及模型的测试使用隔离回声模型。

- PASS：正式build与tests typecheck。
- PASS：day-activity 2单元；day-projection 10 + native-route-binding 3集成。
- PASS：course-calendar-hierarchy 4、composer-icon-controls 1、课程/日期/编辑/布局/日历相关回归8，共主线程13个不同浏览器场景。最终503恢复场景额外覆盖地图直接进入已开课课堂仍可用。
- PASS（侧车）：workspace-docking 5 + two-themes 3。
- 截图核验：现代与手帐同一层级，课程字体15/16px，日历卡片动作13/15px；802px页面及390px展开/收起侧栏。模型自然411px和330/380/440px图标实际绘制与菜单可用，宽栏恢复文字。
- 原58354预览保留home、classroom与端口更新；热更新确认超时后受控重启本预览，数据文件SHA256前后完全相同。实际4节课去重、父子折叠、15题卡+目录调整在来源课堂下可见；输入框383.984px时模型SVG为16×16可见，菜单正常。
- 未运行真实模型教学质量和全仓测试；旧conversation-home的默认手帐假设失败另记于开发交接。

完整命令、初始失败、审查修正与运行态边界：`docs/dev-log/2026-09-14-DSH-course-calendar-hierarchy.md`（仓库根）。
