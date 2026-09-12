# 原生记录存储（P1.3起步，P5/P6关联写入补全）

DSH rc.2 / Node24。Host入口显式root建立原生workspace，取得workspace.id后打开一个学习事实写者；配置默认时区UTC，隔离测试显式Asia/Shanghai。每个canonical学生根由proper-lockfile 4.1.2锁定，拒绝第二OS进程；崩溃后5秒租约过期可恢复，持有期间每秒续租。不使用进程内Map冒充跨进程锁。

RecordStore只补内容schema、身份归属、target kind、expectedVersion、operation指纹与版本快照；原生storage-domain.table.update负责串行执行条件比较，storage-json single负责temp/fsync/rename发布。P1每collection一个single unit；为P5批量建卡和P6骨架改径的实际关联写入，现将领域记录置于一个原生workspace快照单元（`.studyforge/sf_records.json`）。collection仍各持自己的schema/版本/操作，原件bytes仍在materials/，Session仍由DSH原生存储。损坏报错不当空记录；不迁旧格式，不新建journal。当前未做大规模容量验收。

同一记录原子保存不可变内容版本及其真实操作归属。操作指纹含实际输入和Host actor/session/purpose/expectedVersion；重试返回原操作版本，不能拿新内容复用旧operationId。重复更新在native transform内终止，不再次发布或emit。no-op记录请求去重但不造内容revision/红笔修改。read返回内容schema解析的副本，调用方不能修改存储内存。

初建因native update不支持缺失key而用一条进程内create队列补足；它在workspace独占锁之内，检查同ID并调用原生put。旧版本快照用于本课diff，不依赖Git提交。只读changedFields从真实前后快照计算，没有额外活动账。

P5的review/history机械合并使用`updateCurrent`，原生队列内按真实最新卡状态计算，operation指纹不绑定易变当前revision；用户内容替换仍必须`update`明确expectedVersion。`prepareCreate/prepareUpdate`只验证和生成候选，不写；`owner.atomic`对每个候选原行快照核对后，由**一次**native update一起发布。重复目标/陈旧行/任何schema失败整组不写；重放各对象已有operation也不再emit。该边界已用真实卡+骨架、并发普通写者、进程发布前后SIGKILL和重启验证。

## 真实多对象差额

| 操作 | 策略与归属 | 当前证据 |
|---|---|---|
| 一张卡的内容、历史、去重 | 一个记录内发布 | P1.3已验 |
| 确认的目标效果+提案状态+回执 | P5.3目标operation幂等+单项恢复；未知commit锁稿，已确认无写的失败可改稿/rebase | 11领域集成与原生确认→保存→系统回执整链PASS，UI待验 |
| 批量新卡 | 全验后prepareCreate，owner.atomic一次发布 | 原子底座已验，模型批量调用待联验 |
| 骨架改径+关联卡+未开安排 | P6.3预检后用同一atomic写入 | 底座4项真实存储/进程测试PASS，业务写者实施中 |
| 整包检查/预览/发布 | P8作品快照与窄安装提交 | 本轮P1–P7范围外 |
| 查询/设置/日历投影 | 原生单记录或纯读，无通用journal | 后续按消费者验证 |

测试真实磁盘和独立子进程：并发版本竞争、丢响应重试、跨workspace/错误类型、内容副本不反写、重启、no-op、损坏single、双进程锁、发布前/发布后SIGKILL及原操作重试。没有重写DSH持久化原语。原生插件卸载只close写者和释放锁，不删除学生记录。

`dev-isolated`现复制contracts/domain/host/client全部本地构建闭包；每包本地@studyforge引用指向同一次临时快照，第三方库继续共享锁定node_modules，避免新增domain依赖回到活源码树。
