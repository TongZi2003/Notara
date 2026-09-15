# Notara · ThoughtMap 对话阶段框

日期：2026-09-15

状态：设计已实现；确定性、集成和代表性浏览器场景已验收，真实模型教学质量尚未验收

实现仓库：`<DSH迁移工作区>`

## 1. 决策

本功能不新增独立的 `ConversationPlan` 存储、工作台或对话生命周期。

现有 ThoughtMap 继续保存课堂中已经形成的实际节点；所谓 Conversation Plan 是
ThoughtMap 上包住一组节点的阶段框（frame）。阶段框记录这一段对话准备完成的目标、
阶段总结和推进关系。它由教师主动调用工具推进产生，后续对话节点按照阶段边界进入当前框。

因此三层对象保持清楚：

| 对象 | 事实 | 作用 |
| --- | --- | --- |
| DSH 原生 Session 与消息 | 已经发生的对话 | 保存完整原始记录和原生 fork |
| ThoughtGraph 的 nodes/edges | 已经提炼出的课堂节点及联系 | 展示想法、问题、结论、笔记和资料关系 |
| ThoughtGraph 的 frames | 一段对话准备完成的目标与阶段边界 | 包住相关节点，显示当前推进位置 |
| `route:tree` | 跨对话课程节点 | 课程安排、开课和课程级分叉 |

`frames` 不是消息节点，也不是跨对话路线节点。它是 ThoughtMap 的结构层。

## 2. 用户体验

ThoughtMap 画面由实际节点和阶段框组成。阶段框有标题栏，显示：

- 这一阶段的目标；
- 已完成的阶段总结；
- 当前状态；
- 是否从其他阶段分叉而来；
- 相关消息、资料、卡片和笔记的数量。

阶段框内部仍然显示 ThoughtMap 节点和节点之间的边。节点保留原来的点击、编辑、
资料回跳和带入对话能力。框的位置与大小由成员节点的位置计算，不把一块矩形坐标作为
新的学习事实保存。

没有预设课程剧本时，课堂从一个空的或未分段的对话开始。教师在一个阶段告一段落时
调用阶段推进工具：当前框被关闭并得到总结，工具创建新的活动框并写入下一阶段目标。
后续形成的节点自动进入新的活动框。

有预设课程剧本时，剧本只提供教师调用阶段推进工具时的参考目标；它不替代当前对话
真实产生的节点，也不创建跨对话课程节点。

分叉阶段创建新的 frame，并通过 `parentFrameId` 关联来源阶段。原阶段保持历史可读，
新阶段成为当前活动框。回到原思路时创建新的恢复 frame，使用 `resumeFrameId` 指向
恢复的阶段；历史 frame 不重新打开，避免修改旧的消息范围。

阶段完成只表示这段对话的工作目标已完成，不表示学生掌握，也不写复习记录、学情事实
或课程收束事实。

## 3. 数据合同

现有 `ThoughtGraph` 增加 `frames` 字段，旧记录缺少该字段时按空数组读取：

```ts
type ConversationFrame = {
  id: string;
  title: string;
  goal: string;
  summary?: string;
  mode: 'root' | 'continue' | 'branch' | 'resume';
  status: 'active' | 'completed' | 'branched' | 'paused';
  parentFrameId?: string;
  resumeFrameId?: string;
  startSequence?: number;
  endSequence?: number;
  operationIds: string[];
};

type ThoughtGraph = {
  sessionId: string;
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  hidden: string[];
  frames: ConversationFrame[];
};
```

服务端生成 `id`、序列范围、状态变化、操作记录和时间信息。模型只提供学生可读的
标题、阶段总结、下一阶段目标和推进方式，不能提供 session ID、节点 ID、序列号或时间。

自动生成的对话节点通过消息 `sequence` 落入 frame：

```text
frame.startSequence <= node.sequence < frame.endSequence
```

仍然没有序列号的手工 ThoughtMap 节点必须在明确编辑时选择所属 frame；没有归属的节点
留在“未分段”区域，不猜测归属。节点不会同时复制到多个 frame；跨 frame 的关联使用
现有边或引用。

`startSequence` 与 `endSequence` 是读模型边界，不是把消息复制到 ThoughtGraph；原始
消息仍只由 DSH Session 保存。

## 4. 工具与写入

### 4.1 读取

保留 `read_thoughtmap` 作为教师读取入口，返回：

- graph version；
- 当前活动 frame；
- 所有可见 frame 的标题、目标、总结、状态和父子关系；
- 每个 frame 内的节点与资料引用；
- 未分段节点和当前对话回跳位置。

读取不会创建 frame、关闭阶段或改变节点状态。

### 4.2 推进阶段

新增窄工具 `advance_conversation_stage`。它只负责一次原子阶段转换：

```ts
{
  title: string;
  summary: string;
  nextGoal: string;
  mode?: 'continue' | 'branch' | 'resume';
  parentFrameId?: string;
  resumeFrameId?: string;
}
```

Host 在当前 `sessionId` 和当前 graph version 下：

1. 读取活动 frame 和当前 Session 的最后可见 sequence；
2. 将活动 frame 写入 `summary`、`endSequence` 和终态；
3. 创建新的 frame，写入 `nextGoal`、`startSequence` 和关系字段；
4. 一次提交新的 graph version；
5. 返回活动 frame、关闭的 frame 和可回跳节点。

没有活动 frame 时，调用会创建 `mode: root` 的第一个 frame；第一次阶段推进不需要
先伪造一段历史总结。调用失败或版本冲突时，旧 frame 和原有节点保持不变，重读后再试。
相同 `operationId` 重试返回原结果，不创建第二个 frame。

`advance_conversation_stage` 中的总结由教师在读取当前 ThoughtMap 后生成，工具负责
版本、边界、身份和原子写入。工具不另起模型回合，也不把完整教学计划塞进提示词。

### 4.3 节点写入与编辑

现有 `mark_thought` 继续用于创建实际 ThoughtMap 节点。创建时由 Host 自动绑定当前
活动 frame；手工编辑允许把未分段节点放入一个已存在的 frame，但不能修改已经关闭的
消息范围。

现有 `studyforgeTrace.edit` 继续负责节点、边和隐藏状态，并扩展为受限的 frame 编辑：

- 修改标题、目标或总结；
- 暂停活动 frame；
- 调整手工节点所属 frame；
- 不允许通过普通编辑重新打开已关闭 frame；
- 不允许把 frame 的终态改成学生掌握或复习结果。

所有写入继续使用当前 RecordStore 的 `operationId`、`expectedVersion` 和 CAS 语义，
不增加第二个写者。

## 5. 与现有实现的关系

### 保留

- DSH Session 是原始对话事实源；
- `ThoughtNode`、`ThoughtEdge` 和现有资料/卡片回跳；
- ThoughtGraph 的版本控制和重启恢复；
- ThoughtMap 的节点编辑、缩放、布局和主题；
- `route:tree` 及课程页的跨对话课程路线；
- 原生 fork 的独立 Session 语义。

### 改变

- 阶段的产生从“成功笔记写入后读侧自动分组”改为“教师调用阶段推进工具后创建 frame”；
- ThoughtMap 默认按 frame 展示节点，连续消息不再直接充满主画布；
- 当前 frame 成为对话内部的推进上下文；
- 阶段总结成为 frame 的内容，相关笔记和资料成为其节点或引用。

### 不采用

- 不把 `RouteNode` 用作内部步骤；
- 不把每条用户/AI消息当作路线节点；
- 不把原生 fork 树当作 ThoughtMap frame；
- 不增加独立 `ConversationPlan` RecordStore、独立 session 或课程页入口；
- 不从打开、浏览、展示或笔记保存自动推导阶段完成；
- 不把阶段完成写成掌握、复习或课程关闭。

## 6. 兼容与迁移

旧 ThoughtGraph 读取时 `frames` 默认为空。旧的 `event:*`、`stage:*` 节点继续可回看，
但不会自动被改写成新的 frame。新对话使用显式 frame；旧图需要用户或教师第一次调用
`advance_conversation_stage` 后才开始出现新的阶段框。

现有 `summarize_stage` 在过渡期保留为旧阶段总结入口，只能更新旧的阶段节点；新课堂优先
使用 `advance_conversation_stage`。当旧阶段没有明确 boundary 时，不把它补成伪造的
Conversation Plan。

## 7. 验收场景

1. **无剧本动态课堂**：空对话开始，教师推进第一阶段；生成一个 frame，随后两条实际
   ThoughtMap 节点自动进入；刷新后 frame 和节点归属不变。
2. **阶段推进**：当前 frame 有总结和下一目标；再次推进后旧 frame 可回看，新 frame
   高亮，之后的节点只进入新 frame。
3. **阶段分叉**：从当前阶段创建 branch frame；新问题产生的节点进入分支框，父 frame
   和分支关系可回看，原节点不被搬走。
4. **资料与总结回跳**：frame 内节点可以打开原对话、资料、卡片和 ThoughtMap 详情；
   回跳不改变阶段状态。
5. **冲突与重试**：两个窗口同时推进同一阶段，只有一个提交成功；另一个收到版本冲突，
   原 frame、节点和新目标均不丢失；相同 operationId 重试不重复创建。
6. **旧图兼容**：旧记录没有 `frames` 时仍可读取节点和边；不会把原始消息或旧阶段
   自动改造成新阶段框。
7. **课程路线隔离**：推进内部 frame 不增加 `route:tree` 节点；在课程路线中打开的
   对话仍可以拥有自己的内部 frame。

## 8. 范围外

- 跨对话课程路线的重新设计；
- ThoughtMap 的新绘图引擎；
- 自动生成完整课程剧本；
- 从对话表现推导掌握、学情或复习状态；
- 原生 fork 生命周期的改造；
- 多人同时编辑同一个课堂阶段。
