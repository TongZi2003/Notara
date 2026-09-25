# 白板受控互动块设计

日期：2026-09-25
状态：待评审
范围：Native Vault 课堂白板

## 目标

课堂白板继续承担流式文字板书、问题推进、公式和资料引用；在需要观察或操作时，允许老师在某个板书位置插入一个受控互动块。

第一类互动块面向数学学习，支持圆锥曲线、函数、三角形、圆、切线和参数变化。互动块在白板中以手绘手抄报风格的卡片出现，学生可以看到它与当前推导的关系；点击后展开为完整互动工作区，进行拖点、调参、测量和计算。

白板正文仍然是 Markdown，互动块不把任意 HTML、脚本或外部页面写入 Markdown。Markdown 只保存互动块的标题、位置和受控场景引用；场景本身使用结构化文档和 revision 保存。导出时生成静态图和说明，保证课堂笔记可以独立带走。

## 已确认的体验方向

- 默认显示“内嵌预览 + 展开完整工作区”两种层次。
- 内嵌状态只呈现当前图形、关键参数和一句观察提示，不塞入完整工具栏。
- 展开状态复用同一个场景，不复制一份临时图形；展开后的调整回到白板后立即反映在预览中。
- 视觉沿用当前手绘手抄报主题：纸面、手写字、彩色高亮、轻微不规则边框和板书分区。
- 流式过程先显示“正在构造互动图”的受控占位；只有场景通过校验并保存后，才显示正式互动块。
- 窄屏下互动块变为单列，完整工作区使用可滚动布局，不强行保留桌面双栏。

## 当前边界

现有 `write_lesson_board` 将板书写入绑定课堂的 `lesson-board/<session hash>.md`，前端通过工具调用增量显示临时文字，再从已保存 Markdown 读取正式板书。`board-render.js` 只渲染受控 Markdown 子集，原始 HTML 会被当作文本处理。

仓库中的 `@notara/math-workbench` 仍可作为实验插件和实现参考，但它不属于 Native Vault 默认课堂能力。互动块第一版不能依赖用户预先安装这个实验插件；Native Vault 需要拥有一个最小的内置 `math` provider。未来可以把同一 provider 合并到插件工作台，但白板数据合同不能依赖任意插件 HTML。

## 架构

### 1. 互动 provider 注册表

Native Vault 增加受控互动 provider 注册表。每个 provider 提供四个边界：

1. `validate(document)`：校验结构化场景，不接受 HTML 字符串、脚本、外部 URL 或未登记资源。
2. `renderCompact(document, actions)`：渲染白板中的紧凑预览。
3. `renderExpanded(document, actions)`：渲染展开后的完整工作区。
4. `exportSnapshot(document)`：生成静态 SVG/文本说明，供 Markdown/HTML 导出使用。

第一版只登记 `math` provider。它可以复用现有数学场景的对象语义，但不能把实验插件的 iframe 或内部运行时直接塞入 Native Vault 白板。

### 2. 板书块引用

现有板书块元数据增加可选的 `interactive` 字段。模型不填写路径、session ID、revision 或随机 ID；这些由 Host 创建和绑定。

概念结构如下：

```ts
type BoardInteractiveRef = {
  provider: 'math';
  interactionId: string;       // Host 生成
  revision: number;            // Host 保存后的版本
  preset: 'parabola' | 'conic' | 'geometry';
};
```

Markdown 的板书标记只保存 `BoardInteractiveRef` 和块布局。互动场景保存为当前课堂下的结构化文档，例如 `lesson-interaction/<session hash>/<interaction id>.json`，由 Host 以 session 绑定和 CAS 方式读写。这样拖点和调参不会把半成品频繁写进可读的板书正文，同时仍能从板书 Markdown 找到对应场景。

### 3. 模型工具

扩展 `write_lesson_board`，增加受控的 `interactive` 参数：

```ts
interactive?: {
  provider: 'math';
  preset: 'parabola' | 'conic' | 'geometry';
  scene: MathSceneInput;
}
```

模型可以描述要呈现的数学对象和初始参数，但不能指定存储路径、ID、当前 revision 或 HTML。Host 完成以下步骤：

1. 检查当前 agent 是本课堂主教师。
2. 检查 provider 和 preset 已登记。
3. 用数学 schema 校验 scene。
4. 创建或按同名板书块更新互动文档。
5. 将 Host 生成的引用写入板书 Markdown。
6. 以保存后的 revision 返回成功结果。

更新现有互动块时，标题仍然是定位依据；场景更新必须携带 Host 最近读到的 revision。冲突时保留当前板书和场景，要求教师重新读取后再更新。

互动块本身不由模型直接调用任意 `run_code`、`eval`、网络请求或 HTML 注入能力。

## 课堂数据流

```text
主教师调用 write_lesson_board(interactive)
        |
        v
Host 校验 provider + MathScene + session
        |
        +--> 保存结构化 interaction document（CAS）
        |
        +--> 保存 lesson-board Markdown 引用（CAS）
        |
        v
事件流显示“正在构造互动图”
        |
        v
白板读取引用和场景，渲染紧凑互动块
        |
        +--> 学生调参/拖点：更新 interaction document
        |
        +--> 点击展开：显示同一 document 的完整工作区
        |
        +--> 写入观察：由学生主动确认后回到对话或板书
```

工具调用参数未完成或保存失败时，只显示暂态占位和错误状态；取消、拒绝或 CAS 冲突不会留下看似成功的互动块。

## 数学互动块第一版

内嵌预览支持：

- 抛物线和一般圆锥曲线的静态构造；
- 参数滑块；
- 允许拖动的点；
- 坐标轴、焦点、顶点、切线等关键标记；
- 一句由当前场景生成的观察说明；
- “展开互动图”和“把当前观察带入对话”入口。

展开工作区再提供：

- 对象列表和参数编辑；
- 视区缩放；
- 几何关系的添加和删除；
- 测量值和公式计算；
- 撤销、重做和场景保存。

第一版不追求覆盖所有几何作图工具，先保证一个完整的“提出猜想 → 调整对象 → 观察变化 → 回到板书解释”的闭环。

## 安全与权限

- 白板 Markdown 不执行任意 HTML、JavaScript、iframe 或外部资源。
- provider 是代码登记项，不由模型动态创建。
- 场景只能通过对应 provider 的 schema 保存。
- provider 的动作只能修改当前课堂绑定的 interaction document。
- 互动文档和板书都使用 revision/CAS，避免展开工作区覆盖课堂刚刚更新的内容。
- HTML 导出使用 provider 的静态快照；导出文件不携带运行脚本。
- 如果未来允许第三方 provider，必须沿用插件的 opaque iframe、固定 digest、CSP 和 nonce 消息边界；第三方 provider 不直接获得 Vault Remote、路径或凭据。

## 验证

### 纯逻辑

- 未登记 provider、未知 preset、非法对象引用和超限场景被拒绝。
- HTML、script、iframe、外部 URL 不会进入互动文档。
- interaction 引用解析、同名更新和 revision 冲突行为正确。
- 导出得到静态图和说明，不含脚本。

### 集成

- 新课堂创建互动块后，刷新和重新打开仍能恢复同一个场景。
- 拖点或调参保存后，白板预览和展开工作区读取同一 revision。
- 板书保存成功而场景保存失败时，不显示完整互动块；两者状态如实呈现。
- 当前课堂关闭后重新进入，interaction 文档仍与原课堂绑定，不能被另一课堂读取。

### 浏览器

- 流式板书过程中互动块显示受控占位，完成后替换为真实预览。
- 点击展开和关闭不会生成第二份场景。
- 调参、拖点、“带入对话”和“写入板书”均有可见结果。
- 801px、手机窄屏和无互动 provider 三种状态都有明确布局和错误提示。
- 课堂板书和互动块的手绘风格保持统一，白板仍以文字推进为主。

## 非目标

- 不支持在板书正文中粘贴任意 HTML。
- 不把所有实验插件恢复到默认课堂。
- 不让互动块代替教师的文字解释和问题推进。
- 不把互动操作自动推断为学生已经掌握。
- 不在第一版同时实现物理、化学和历史地图互动块。
