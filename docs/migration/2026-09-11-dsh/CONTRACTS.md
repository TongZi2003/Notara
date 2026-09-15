# v2.3 跨阶段共同契约

用户已接受[独立精简审计](<独立审计报告>)。本版覆盖v2.2中的自建通用机制、教学硬阈值和过粗版本要求；产品行为源仍为B@3831987，新增界面以[UI-FIRST-RELEASE.md](UI-FIRST-RELEASE.md)为准。原生接入及限制见[SIMPLIFICATION.md](SIMPLIFICATION.md)。以下是学习领域合同；原生API类型直接引用安装SDK，不再手抄一套。

## 1. 文件、阶段与检查命令

新路径相对仓库根目录。P0已有构建/Remote/隔离运行/E2E保持；P1增加unit/integration与同源schema检查，P1.5就建立live入口核验原生web/subagents/prompt/storage的组合，P9增加全量/打包。路径是明确责任的建议落点：同职责可并入已有文件，交接记录映射，不为满足清单创建空包装组件或服务。

~~~json
{
  "test:unit": "vitest run --config vitest.unit.config.ts",
  "test:integration": "vitest run --config vitest.integration.config.ts",
  "check:contracts": "tsx scripts/check-contracts.ts",
  "test:live": "tsx scripts/test-live.ts",
  "test:all": "tsx scripts/test-all.ts",
  "pack:plugins": "tsx scripts/pack-plugins.ts"
}
~~~

测试参数对应实际文件，零匹配失败；临时DSH home/空学习空间/独占端口与进程由fixture管理。fake只验协议，live记录真实请求/工具/结果；缺外部配置单列BLOCKED，其他可运行部分继续。执行相关检查，不在每个小任务重跑所有模型场景。

## 2. 最小身份、版本与范围

~~~ts
type WorkspaceId = string;
type SessionId = string; // DSH原生身份
type EntityRef = string; // 已有学习对象或原生记录的稳定引用；外网命中无需分配
type Revision = number;
type Digest = string;
type VersionToken = Revision | Digest; // 一个对象选一个适用的比较令牌
type Purpose = 'learning' | 'creation';
interface RecordScope { subjects?:string[]; } // 缺省为通用适用，非读取权限
type LearnerMemoryKind = string; // 默认目录：ability/habit/preference，可配置分类
type PublicResult<T> =
  | {ok:true;value:T}
  | {ok:false;code:string;studentMessage:string;retryable:boolean};
interface HostContext {
  workspaceId:WorkspaceId;
  sessionId?:SessionId;
  actor:'student' | 'teacher' | 'system';
  purpose:Purpose;
}
interface MutationContext extends HostContext {
  operationId:string;
  expectedVersion?:VersionToken;
}
~~~

账号/身份、原生消息时间、对象实际版本由Host提供；模型只写内容和有意义的对象/适用范围选择。普通learning可读本人跨集/跨科资料；默认关注只是导航和检索提示。明确通用偏好可保存通用范围，含混时Skill询问；不再设置“模型不能选global”或持久unresolved状态。

creation与learning使用明确原生composition/tool policy。StudyForge只补原生没有的学生目录、目标作品和必要reference授权数据，不按五教学配置各复制grants。损坏的授权不能默默放开。临时改语气、换教法不改变授权。读取范围由真实文件/工具backend保证，不能只依靠cwd；不额外要求防御未纳入部署环境的同机恶意进程。

错误直接利用原生工具/SDK结果；学习写者只补实际需要的field/expected/nextAction与保存状态，不能为统一格式重建所有native错误枚举。已保存、待投递、版本记录失败分别说明；不可观测的“用户消费完成”不建状态机。

## 3. 持久事实与写入

DSH拥有会话创建/名称/输入接受/requestId/事件窗口/重放。StudyForge保存原件版本、普通卡、知识、学情、课程教学元数据、组织、待确认编辑稿和作品/包；不复制Session CRUD或给每条输入再写一份证据表。目录和物理存储布局由具体记录及原生storage能力确定，不先按服务数量划出存储系统。

- 单卡内容、学习历史、已处理operation和所需前后revision可作为一个记录原子提交，优先使用storage-domain.update及已安装storage-json。RecordStore只加领域schema和条件更新，不自己重写fsync/临时文件/发布步骤。
- P1.3先验证单记录的版本冲突与幂等，列出真实多对象操作：跨卡骨架改径、跨对象确认效果、整包发布。能缩成一次记录提交的先缩；确需多记录原子性时，在该业务写者设计窄提交/恢复，并补对应故障用例。
- 原生storage不提供跨表事务或跨进程锁。以一个实际workspace写者接入，若可能有两个进程写同一空间，须证明拒绝或串行；不能把进程内链当跨进程保证。无需提前建覆盖所有读取/设置/投影的通用journal。
- 红笔所需前后内容与operation归属保留于实际内容修改；P8的Git提交失败不丢领域成功和旧版本。expectedVersion只用被改对象所需令牌，不让模型同时填写Revision/Digest。
- 原稿若能稳定引用DSH工具调用/消息则保存native引用；学生编辑稿和确认时采用的内容单独保存。确认所见版本与实际写入同版、重试同一效果不再执行；原生引用不足以恢复时才保留必要原稿快照。

| 领域差额 | 首次接入 | 后续消费者 |
|---|---|---|
| storage/record-store.ts：read/update，native单记录条件更新 | P1.3 | 卡/知识/设置；多对象由具体写者补足 |
| access/execution-binding.ts：最小用途/学生授权 | P1.4 | 课堂/Creator/资料读取 |
| Host native-capabilities.ts：组合验证与公共原生调用接线 | P1.5 | P2会话、P4web、P7帮手/prompt |
| courses/course-metadata.ts：bind/read/update教学附加信息 | P2.1 | 路线/产出/小结 |
| evidence/evidence-query.ts：catalogue/resolve，原生输入按需投影 | P2.3 | 复习/学情/收课 |
| materials/material-service.ts、Host session-resource.ts | P3.1 | 原件/定位/卡/包 |
| materials/learning-search.ts：本地学习对象查询 | P4.2 | 主/子搜索；web走原生工具 |
| courses/lesson-resource-projection.ts：read | P4.1 | 本课引用；标签生命周期归DSH |
| cards/card-service.ts、knowledge/knowledge-service.ts | P5.1–P5.2 | 编辑/学习/资料 |
| proposals/proposal-service.ts | P5.3 | 所见稿确认与失败恢复 |
| review/review-service.ts | P5.4 | 学习记录/日期投影 |
| organization服务 | P6.1–P6.4 | 集/路线/计划/共同编辑 |
| organization/calendar-projection.ts、roadmap-projection.ts | P6.5 | 日历/日报/时间筛选 |
| materials/book-exploration.ts | P6.6 | 单书脑图/列表 |
| memory服务；Host teaching配置与prompt section | P7.1–P7.3 | 学情/五主预设 |
| Host teaching委派接线 | P7.4 | 原生subagents；命题结果登记 |
| courses/handoff-service.ts、class-close-service.ts | P7.5 | 确认收课/接续/日报 |
| creation与package服务 | P8 | 文件版本编辑、作品快照验收与安装 |

表内名称是职责边界，不要求全部成为独立类/文件；已有原生对象直接消费，只有实际转换或领域写者才新增代码。

## 4. 来源、混合材料与消息

~~~ts
type SourceLocator =
  | { kind:'pdf'; page:number; rect?:[number,number,number,number] }
  | { kind:'image'; rect?:[number,number,number,number] }
  | { kind:'text'; start:{line:number;column:number}; end:{line:number;column:number} }
  | { kind:'docx'; part:string; blockId:string; start:number; end:number };
interface MaterialContext {
  materialId:string;
  versionId:string;
  locator?:SourceLocator;
}
interface SourceAnchor extends MaterialContext { locator:SourceLocator; quote?:string; }
type LessonMaterial =
  | { kind:'source'; source:MaterialContext }
  | { kind:'card'; cardRef:EntityRef };
interface LessonMaterials {
  materials:LessonMaterial[]; // 教学安排/明确关联的引用，非预览标签清单或读取白名单
  initialIndex?:number;      // 不填则首项；空列表不可填
}
interface SelectionSnapshot { text:string; sources:SourceAnchor[]; }
interface MessageEnvelope {
  messageId:string; // 绑定DSH已有submission/requestId，不另造并行提交身份
  text:string;
  context: { selection?:SelectionSnapshot; currentMaterial?:LessonMaterial };
}
~~~

这组纯数据 schema 在 P1.2 建立，P3/P4 才实现操作。PDF 页码与文本行号从 1 开始；列和 DOCX offset 用 UTF-16，从 0 起、结束不含；rect 为规范原件坐标[0,1]正面积。PDF rotation/crop、图片 EXIF、DOM 渲染映射须往返验证；DOCX 不用显示页码或全文 quote 搜索代替稳定结构定位。跨页/跨块拆多 anchor。原件固定版本，DSH file URI 是临时传输地址。

MessageEnvelope通过原生composer/context codec在发送时冻结；提交echo/ack/Queue/Steer由ui-conversation owner处理，selection优先，否则当前项。卡引用由 Host 解析卡和来源，没有来源的生成题也合法。当前预览来自DSH原生active tab和renderer位置，不另存一套activeTab/打开列表。课程引用、已接受消息引用和产出形成“本课资料”投影；关闭标签不删引用，移除课程关联不删原件/旧消息。适用范围与依据引用只使用实际已接受材料，不把全部课程引用当作学生全部做过。

模型规划选材料时使用Host候选短引用，Host转成上面结构；路线上materials不再是book|cards|none单union。保存教学引用顺序，通过原生预览打开默认项；不要求全部打开/读入模型。骨架节点={path,sources:SourceAnchor[]}，非连续来源保留列表。

### 4.1 DSH原生预览接缝

依[DSH-PREVIEW.md](DSH-PREVIEW.md)：Host的resolveForSession把稳定版本引用解析为该真实Session可读文件，使用fileAddressFor生成地址。Client经ctx.sidebarRight.openResource打开，标签内回调用tab.actions；不用非公开openResourceIn/adopt。卡片注册自己的资源/标签类型，仍归原生Tab生命周期，隐藏答案不走原始文件全文预览。

StudyForge只补选区、locator及明确课程引用。当前输入取native active tab及该renderer的阅读位置；原生侧栏刷新会重置，持久来源靠SourceAnchor重新打开，不承诺已保存完整布局。文本/代码line导航不等于PDF/MD/DOCX定位，新增导航字段必须走公开扩展并自行schema验证。没有真实会话的资料阅读不创建占位课，也不借其他Session授权。

原生workspaceFiles不自动限制所有文件read在workspace内；P1.4需把学生读取边界落实到该Session真实filesystem backend，测试直接Remote访问也不可绕过。

### 4.2 本地查询与原生web（P4.2）

外网搜索直接使用web_search/web_fetch或ctx.web，provider、取消、来源和截断均沿原生结构；主搜索和搜索subagent共用工具注册。不新建统一SearchService、外网EntityRef或可变readState。已安装provider是否可用由P1.5/P4.2真实验证，外部失败不丢本地结果，不从模型散文造URL。

本地查询保留材料版本/locator、卡/知识ref和实际内容片段；普通文件glob/grep/read在已授权范围内可复用，卡背/知识特殊查询才补领域读取。原生grep可能通过subprocess绕过ctx.fs，因此授权检查必须覆盖实际执行路径。临时搜索结果列表可把本地对象和外部URL一起展示，不保存成新事实。引用外部内容导入后才得到MaterialVersion；实际已读/部分读取直接来自read/fetch结果，相关性和是否继续读归Skill判断。

## 5. 学情与采用的依据

EvidenceQuery从原生已接受输入按需提供E短别名、真实时间和对象候选，不再有accept/证据入库/双重恢复状态。写学习记录或学情时才保存它真正采用的native引用与必要对象内容版本；若原始记录不能永久解析，保存最小引用片段以保证后续可核验，不能复制全课历史。

- 来源角色区分学生自述、真实课堂作答与其他内容；系统回执/模型答案不能伪装成学生原话。对象必须存在，旧版本/发生时间可解析。
- 学情用自由正文表达观察、依据、适用情境及不确定性；分类默认ability/habit/preference，支持配置，不用分类禁止保存合理观察。知识内容仍归独立KnowledgeRecord，不复活concept知识桶。
- 移除“至少两个对象才准保存”与按对象数生成verifiedAbility。一次观察可以保存为有情境的观察，两次也不能由代码自动认证；推断强弱、需否继续取证由Skill判断，UI展示真实来源。
- 当前修订采用的依据集合与历史版本足以投影current/prior，不为迁移依据再加独立状态字段/转换流程。修订保留原始出处，不强迫继续引用已被反证否定的话。
- 偏好使用学生真实表达；通用/学科范围是可编辑的适用范围，不是账号授权。新记录不按标题偷合并；同目标的并发修订仍校验版本。

## 6. 确认、内容编辑与回执

普通卡作者正文与review/rewrite系统历史分开，正文标题“复习/重写”不特殊截断。普通卡teacher links_add增量、学生可删；知识/锦囊同一自由body与身份，没有第二复习梯子。

修改原因是可选说明；前后版本负责真实diff，删除reason必填/minor例外门槛。数学内容先正常渲染和提示可定位的问题，编辑元数据不被未改旧正文阻断。语义改写质量、批评强弱、是否补例子归教学Skill。

确认保存采用的稿件版本、明确目标及真正需要的效果；pending跨刷新保留。已成功项不重复，失败项可重试；异步回调回原对象。只对实际跨记录效果保留窄事务，不能为了“统一确认”把所有直接编辑都改成多轮审批。收到回执继续教学，不重做已经完成的写入。

## 7. 复习与收课

五档忘/糊/牢/涉/初、三通道和默认梯[1,3,7,14,30,60,120]仍是可执行的复习产品规则。review缺省表示未学；创建/阅读/搜索/关联不生成检验。发生时间来自作答，不能用迟确认时间替代。

同一occurrence重试只应用一次；较新且卡/梯子基线匹配才正常推进，较旧/不匹配保留真实历史而不覆盖新due；未学且基线改变保守初始化。refit不新造证据，知识没有复习梯子。后续更正沿明确目标，不能用新事件伪装重评旧作答。

一原生对话一课。关页/静默不收课；学生确认propose_handoff后保存并关闭。失败重试原单，课后主动讨论仍原课、无r2/自动新小结义务；只处理回执时没有学习写工具。已有冻结复习按原发生时刻完成，课后新制卡不追回漏记旧检验。接续课固定当时收到的handoff版本，更正不追溯改旧接续。

## 8. 五教学配置、原生Skill/prompt与Creator

五种首版选择是数据配置：资料整理、诊断分析、苏格拉底授课、头脑风暴拓展、搜索，稳定键来自配置目录。一个学习composition承载共享工具，五条配置描述教法/入口；不把它们定成不可扩展的领域enum或各自复制授权。用户自制配置仍可安装。

开课与本课选择共用目录。DSH原生agent-presets只允许空会话切composition；同课切换因此保存一个教学选择和可选临时要求，由systemPrompt.section的动态provider在下一次assembly生成完整文本。底层in-history/leading-system处理归DSH loop，不自造provider能力判断/提示更新状态机。保留session、材料、草稿、模型/effort。

日常Skill读取使用ctx.skills.registerProvider，加载/目录/失效沿原生实现。临时改语气/补要求写会话覆盖文本即可，不要求Creator检查安装；发布可复用版本才走包管理。公共包仍固定已绑定版本，个人知识写KnowledgeService，不恢复私人.d目录写法。

搜索/命题/制作/审读复用ctx.subagents，任务/persona/toolFilter/outputSchema按需配置；返回、取消、父子目录和用量沿原生。spawn空历史仍可能继承提示/工具/resources，必须检查实际出站内容满足该角色需要；persona覆盖不等于完全隔离。命题只额外验证产物→登记原卡；点名帮手显示原文。

Creator编辑按被改文件及真正依赖的版本校验，复用原生fs observation/条件写；不以整个工作台digest阻断不相关文件修改。check/preview/install才冻结整作品快照，安装内容必须是已检查/真实预览过的版本。跨文件修改只有实际需要原子发布才批量提交。制作/审读根据任务需要调用，不固定每次小改都走两模型。

制作权限限定所选作品及已授予reference；原生fs-sandbox读取不受限，不能裸放工具后声称安全。只补部署场景需要的读写边界，不用未证明的同机攻击假设把所有平台判不可用。课堂图示仍用已验证的受限执行方式，探索和存模具不自动产生学习事实。

## 9. 原生对话、修订和调试

执行[DSH-NATIVE-EXPERIENCE.md](DSH-NATIVE-EXPERIENCE.md)。ui-conversation/Session Controller是唯一提交、事件窗口和assembler；ui-chat/MarkdownText拥有流式正文/语义滚动。StudyForge只注册教学类型和renderer，不另建message-store/send-coordinator/reconcile或第二事件源。

模型选择由modelDirectories/session.selectModel权威持有，exact adapter决定effort枚举，下一请求生效；用途/权限不随模型切换。token使用native Turn及tokenUsage投影，contextPressure/contextBreakdown估算单列；retry与final替代按原生fold，reasoning为输出子集，不重复计数，缺失不报0。

内容变更的只读投影形状如下，字段来自事务，不由模型填写：
~~~ts
interface ObjectChange {
  operationId: string;
  target: EntityRef;
  sessionId?: SessionId;
  actor: 'student' | 'teacher' | 'system';
  beforeRevision: Revision | null; // 新建才可null
  afterRevision: Revision;
  changedFields: string[];
  committedAt: string;
}
~~~
版本引用解析到真正保存的内容；本课按sessionId选择operation，不用全仓Git HEAD范围代替。红笔/技术diff读同一差异，普通当前正文不被删除线污染，不能提前公开答案。跨课交错版本不合成伪“本课净修改”。

用户本次明确开放模型/effort/token控制与Raw JSON调试入口。普通教学正文仍去技术化，显式调试可查看本会话技术字段和原始记录，默认只读、关闭；不扩大账号权限，不从Host配置额外读凭据，公开导出独立。Raw使用原生窗口，标明分页/transient，领域事务另标来源；切view不新开模型或写事实。

## 10. 单书层级与明确拆解（P6.6）

~~~ts
interface BookNodeBase {
  key:string; title:string; parentKey?:string; sources:SourceAnchor[];
}
type BookNode = BookNodeBase & (
  | {kind:'book'}
  | {kind:'section'; path:string}
  | {kind:'card' | 'knowledge'; target:EntityRef}
);
interface BookStructure {
  material:MaterialContext;
  skeletonRevision?:Revision; // 尚无骨架时缺省
  nodes:BookNode[];
}
interface BookExploration {
  read(ctx:HostContext, material:MaterialContext):Promise<PublicResult<BookStructure>>;
}
interface BookBreakdownIntent {
  material:MaterialContext;
  nodePath?:string; // 缺省表示书根，非空须为真实骨架节点
  skeletonRevision?:Revision;
  sources:SourceAnchor[]; // 已知范围；尚未读取的书根可以为空
}
~~~

书根→任意层骨架→原卡/已收录知识是读侧关系；知识不复制成普通卡。初始仅根可见是UI展开状态，不是清空nodes或删持久骨架。脑图/列表共用BookStructure，卡详情共用P5。切换/展开/来源定位不写学习事实、不发模型请求。

BookBreakdownIntent不是直接写者授权；明确动作经Host验证后进入资料整理课，P7读取并提案，保存继续走P5/P6确认。保存版本冲突先重读合并，兄弟章/来源/既有卡保全。P3/P4负责资料页左侧renderer与来源定位；DSH课堂右侧仍自己管理原生标签，两边不维护同步openTabs。

## 11. 日历与日报共用日期投影（P6.5）

~~~ts
interface DateQuery { date:string;timeZone:string; }
interface ActivityItem { kind:string;title:string;target?:EntityRef;sourceRefs:EntityRef[]; }
interface CalendarDay extends DateQuery {
  relation:'past' | 'today' | 'future';
  asOf:string;
  activity:ActivityItem[];
  dueCount:number;
  overdueCount:number;
  scheduledCourses:{target:EntityRef;title:string}[];
}
interface CalendarProjection {
  readDay(ctx:HostContext, query:DateQuery):Promise<PublicResult<CalendarDay>>;
}
interface RoadmapProjection {
  filter(ctx:HostContext, range:{from:string;to:string;timeZone:string}|null):
    Promise<PublicResult<{matched:EntityRef[];context:EntityRef[]}>>;
}
interface DailyReportSettings {
  enabled:boolean;
  timeZone:string;
  localTime?:string; // HH:mm，开启时需配置
  lastGenerated?:{date:string;timeZone:string;at:string}; // Host记录最近成功生成
}
~~~

日历与日报只有一份readDay。活动项由真实输入时间、领域写入和review occurrence查询，摘要据此呈现；ActivityItem是UI投影，不建立新的活动账。过去显示真实活动/原安排，今天已做和剩余，未来只给当前schedule预测到期与已排课。未学/知识不计到期，同卡去重；参与课堂与完成分开。读取失败不能报零活动。

设置通过原生单记录storage保存。ctx.timeout/interval负责插件生命周期清理，到配置时刻调用同一日期聚合并通知日历刷新，成功后只记最近生成时刻；不另建DailyReportService/readDay/scheduler类。恢复后刷新当前/最近到期日期，其他旧日按需查询，晚确认按真实发生日自然出现；不要求离线期间每个旧日先写一份缓存。

不强制日报sourceDigest/revision/启用区间/全历史补算队列；若实际性能测量需要缓存，再补可删除重建的缓存。生成时间与活动时间分开，时区自然日边界不按固定24小时推算。应用关闭期间不保证准点执行。DSH schedule向原课发送follow-up，与本功能不同，不用于触发课堂或新增模型调用。未选定默认几点，仍可配置；不新增推送/邮件。日报不能自动收课、写handoff或修改学习记录。
