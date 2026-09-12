# G3 — PASS（2026-09-12）

R/dsh，DSH 0.1.5-rc.2，产品B@3831987。P3.1–P3.4已由主Agent集成、返工和验收；P4/P5准备代码同时存在，不能据此接受G4/G5。

## 已验证

- 原件不可变版本：8项真实文件/存储集成。导入只建资料，显式新版不替换v1，重试返回原operation版本；同名、假文件、symlink逃逸拒绝。逐级目录验证保证拒绝前不在外部symlink中创建空目录。
- 实际图文读取：3项区域集成，2项原生Host集成。PDF用物理页与规范crop/rotation坐标，图片应用EXIF，文本/DOCX读真实区间；真实裁图通过native attachments进入下一次可控模型请求。无OCR时不虚构文本。
- DOCX稳定索引16项单测，骨架10项集成。命名空间/UTF-8/解压体积验证，跨run/重复正文/表格路径明确；骨架只校验/投影，不抢P6确认写者。
- 11项真实Chromium场景全部通过：导入/同名/显式新版/刷新、无课浏览（native session ID集合不变）、MD数学、实际尺寸图片、PDF翻页缩放/坏页、HTML沙箱、原生右栏、DOCX重复结构/降级/真实公式、目录失败重试。
- 正式build与生成Remote PASS；测试strict PASS；25项同源schema检查PASS。图像工具验证使用可控adapter，不是外部实模证据。

## 主Agent返工与裁决

- 使用原生公共MarkdownText；正式打包external原生primitives，不另复制其依赖树。PDF worker内联、CSS随Cordis scope注入/清理，字体data URL。
- PDF只发布完成的离屏画布；尺寸保持原件比例，真正改变显示zoom。DOCX异步渲染使用独立容器，旧结果不覆盖新资料，清理body/style和URL。
- DOCX只有完整路径集合、数量与可逆文本一致才绑定block ID；结构展平/无法映射时整篇不给伪定位。公式/图像仍按原件显示，不把公式假作普通索引文字。
- 原测试的公式fixture是错误嵌套，现为合法段落级oMath，并断言math节点真实包含y=2、可见且有尺寸。主Agent查看screens/docx-mixed.png确认公式、表格和图片。
- P4搜索接入期间暴露DSH仅接受oneOf的schema约束，已为互斥类型的anyOf/type数组作等价转换；任意重叠union仍拒绝，新增2项回归。保留失败日志，不将启动失败归为UI回归。

## 证据

`backend.log`（P3 23项）、`docx-index.log`（16项）、`p3-final-build.log`、`p3-final-e2e.log`（11项）、`p34-native-final.log`（P3 2项+P4来源原生1项）、`tool-schema.log`、`screens/`。后续编译/验收仍需覆盖P4改动后的P3回归。

## 限制与剩余

复杂DOCX无法精确映射时可预览但不可声称有稳定选区；无文本层PDF不提供伪OCR。实际外部模型/搜索凭据仍BLOCKED。P4真实选择/来源往返、P5–P7功能继续实施；P8/P9不在本轮范围。
