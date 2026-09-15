# P3：原资料、版本与丰富预览 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans；G2 PASS 后执行四项，交 G3 review。

**Goal:** 资料可以直接学习，无需先拆书；四类主要原件可预览并为准确定位准备索引。
**Architecture:** Host管理不可变版本，官方DSH预览优先；衍生图文缓存不改变原件身份。
**Tech Stack:** TS、DSH document preview、PDF引擎、docx-preview公共API、OOXML索引。

## 全局约束
阅读B/.pi/skills/book-prep/SKILL.md和app/js/screens/reader.js。上传不自动生成骨架/卡/路线。物理PDF页从1起，印刷页号只为显示。新类型支持与定位证据分开。

## P3.1：导入、原件版本和资源授权
**文件：** packages/domain/src/materials/{material-service,version-store,import-validation}.ts；packages/host/src/materials/{resource-service,session-resource}.ts；packages/client/src/materials/ImportMaterial.tsx；tests/integration/material-version.test.ts；tests/e2e/material-import.spec.ts。
**输入：** P1身份/事务/来源schema；**输出：** import/createVersion/get/resolve及Host resolveForSession，MaterialVersion={materialId,versionId,title,mediaType,digest,byteLength,importedAt}。

- [ ] 实现文件/拖放/图片上传，同名拒绝覆盖；“新版本”显式操作，原件保留。导入后直接读，不自动要求整理或归入学习集。
- [ ] MIME/内容头/文件名、集中大小限制、staging发布验证；中断/失败不出现半资料。
- [ ] 稳定material/version仍是事实身份；resolveForSession把同一不可变原件解析到真实Session读后端，通过官方fileAddressFor生成预览地址，同书不按课复制。地址不替代事实ID；P1授权边界覆盖原生文件Remote，未经授权的绝对路径/跨账户/软链拒绝。
- [ ] 导入v2推进当前指针，已存在v1 anchor仍解析v1；多卡共享version bytes。
- [ ] 测同名、重复操作、损坏、磁盘不足、未归集、跨账户和重启；独立比较保存/读取bytes digest。
- [ ] 运行 npm run test:integration -- tests/integration/material-version.test.ts、npm run test:e2e -- tests/e2e/material-import.spec.ts、typecheck；提交。

## P3.2：官方renderer与页面生命周期
**文件：** 现有preview注册接线及实际需要的packages/client/src/materials/MaterialPreview.tsx；tests/e2e/official-preview.spec.ts；tests/fixtures/materials/README.md及合成原件。
**输入：** P0注册API、授权resource；**输出：** openMaterial和分格式能力表，供课堂右栏及P6.6资料页左阅读区共用。

- [ ] 复用DSH Session右栏及PDF/图片/Markdown/HTML/code/text renderer，加载/重读/renderer选择/Tab生命周期归官方owner。按DSH-PREVIEW.md核验公开API，写docs/runtime/preview-contract.md；学生标题显示资料名，截图确认不泄露Host绝对路径。
- [ ] 抽出可在资料页挂载的同一renderer/locator接口；课堂标签由DSH持有，资料页阅读位置由自己的view持有。无Session读取沿P3.1 workspace授权resource-service，不借别课file URI；单纯阅读不得建课。实际公开组件不能独立挂载时，将窄格式适配复用到两个入口，不能假称controller支持无Session。
- [ ] 只注册实际新增格式/定位能力，不镜像原生preview registry/capability状态。现有renderer可直接挂载时就复用，不为文件清单另造空组件。
- [ ] 缺少区域/定位能力时，在DSH相同preview注册机制内加viewer adapter；不能依赖未导出的内部组件或另建旧SPA。
- [ ] 测扫描PDF、中文公式MD、代码/文本、EXIF图片、SVG、沙盒HTML。HTML不加allow-same-origin绕过选择限制。
- [ ] 保留native tab生命周期：切课或收起右栏不误删它保留的record；关闭tab/插件卸载才释放其订阅、worker与ObjectURL。renderer自身重挂载处理旧请求隔离；raw bytes不进session JSON。
- [ ] 真实浏览器检查正常与损坏文件；只把实际支持能力标PASS，空白不能当成功。
- [ ] 运行 npm run test:e2e -- tests/e2e/official-preview.spec.ts、typecheck/build；提交截图与限制。

## P3.3：DOCX稳定索引与显示映射
**文件：** packages/domain/src/materials/docx/{index-docx,normalize-text}.ts；packages/client/src/materials/docx/{DocxPreview.tsx,dom-map.ts}；tests/unit/docx-index-v2.test.ts；tests/e2e/docx-render.spec.ts。
**输入：** exact DOCX bytes；**输出：** DocxBlock={part,blockId,text}与规范化offset映射。

- [ ] 实施时核验并锁定docx-preview公开renderAsync和许可；不将实验parser节点作为身份，不宣称Word精确分页。
- [ ] OOXML按部件/段落/表格结构给稳定blockId；保留run合并、空格、tabs、换行和UTF-16 offset规则。
- [ ] renderer DOM映射须区分相同文字的不同段落/单元格。不能全文搜索第一处quote后说精确定位。
- [ ] fixture含中文、emoji、跨run、两相同段落、重复表格、公式、图片、分页符；实际查看公式/表格未丢。
- [ ] 页眉/脚注等无可靠映射的部分明确只预览；主要正文/表格往返不能通过则交Codex，不降级成伪页码。
- [ ] 运行 npm run test:unit -- tests/unit/docx-index-v2.test.ts、npm run test:e2e -- tests/e2e/docx-render.spec.ts、typecheck；提交。

## P3.4：按需读取、来源校验与渐进骨架
**文件：** packages/domain/src/materials/{read-material,skeleton-service,region-preview}.ts；packages/host/src/tools/material-tools.ts；packages/client/src/materials/MaterialOutline.tsx（读取用，不提前造P6.6的第二套脑图）；tests/integration/material-read-region.test.ts。
**参考：** B/.pi/skills/book-prep/SKILL.md；B的read.region反馈合同；dev/tests/card-chapter-r11.sh。
**输入：** 原件版本/索引；**输出：** readMaterial、previewRegion、SkeletonService.read/validate，后续确认写者在P6。

- [ ] 读取返回实际图/文和来源位置，扫描PDF无文本层时不伪造OCR；图片部分返回确实发送给模型的裁图，不只回坐标。
- [ ] 预览裁区返回真实图像及对应版本/页/区域，便于模型核对；保存时验证来源版本与几何坐标。是否需要再次看图、换整页或继续精细裁图由Skill判断，不要求先领取预览票据，也不写死每页每轮两次预算。调用失败/截断如实回传，不能只回坐标宣称已返回图像。
- [ ] MD行与DOCX block不随渲染变化；非连续资料保存多anchor，不拼成假的连续页段。过界/缺version拒绝。
- [ ] 骨架节点用path+sources，支持按章追加，保全其他章。根可尚无骨架，层级不限固定深度，初次阅读不自动生成；P6.6把它投影为书根起步的逐层脑图/列表。此处只提供结构能力；主轴/知识/卡/路线的教学流程在P7.3接真实服务，不新造全书完成进度实体。
- [ ] 删缓存重建原件不变；测试物理/印刷页差异、跨页题、过界、失效来源、裁图与返回位置不一致、未拆书直接读。
- [ ] 运行 npm run test:integration -- tests/integration/material-read-region.test.ts、本阶段回归/typecheck/build；交G3。
**G3：** 预览、版本和原文读取真实可用，DOCX有稳定索引；P4才验最终选择/回跳，不把preview成功等同定位成功。
