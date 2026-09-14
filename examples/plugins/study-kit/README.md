# 出题与复盘

Notara 插件系统第一版示例。无需依赖、不执行本机代码，提供“出一组题”技能与“学习复盘”工作台。

在“插件 → 安装插件 → 开发目录”中选择本目录，查看安装内容并确认。也可以在本目录执行 `npm pack`，将生成的 `.tgz` 通过“本地插件包”导入。

安装后：在课堂“＋”或 `/` 选择“出一组题”；在课堂视图打开“学习复盘”，填写内容后点击“整理为笔记”，检查宿主显示的完整文字，再确认保存。笔记在资料页可查看；停用或卸载本插件后仍保留。

## HTML 工作台协议

HTML 自包含，不访问网络。宿主注入 `window.Notara`：

```js
window.Notara.saveNote({ title: '我的笔记', body: '我独立整理的正文' });
const unsubscribe = window.Notara.onSaved(({ title }) => console.log(title));
```

`saveNote` 仅请求显示确认界面，不直接保存。HTML 不能选择目标卡 id、课堂、复习结果，也不能直接调用宿主 Remote。需在贡献中声明 `permissions: ["save-note"]`。

主题自动更新，正文和控件默认跟随宿主字体；样式可使用 `--notara-background`、`--notara-surface`、`--notara-text`、`--notara-muted`、`--notara-border`、`--notara-accent`、`--notara-font`、`--notara-font-size`、`--notara-heading-size`、`--notara-radius`。不要硬编码整页颜色、字体或大字号。
