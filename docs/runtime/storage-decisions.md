# P1.3 原生记录存储

DSH rc.2 / Node24。Host入口显式root建立原生workspace，取得workspace.id后打开一个学习事实写者；配置默认时区UTC，隔离测试显式Asia/Shanghai。每个canonical学生根由proper-lockfile 4.1.2锁定，拒绝第二OS进程；崩溃后5秒租约过期可恢复，持有期间每秒续租。不使用进程内Map冒充跨进程锁。

RecordStore只补内容schema、身份归属、target kind、expectedVersion、operation指纹与版本快照；原生storage-domain.table.update负责串行执行条件比较，storage-json single负责temp/fsync/rename发布。每个collection是一份single unit，损坏报错不当空记录。选择single是因为本版per-record会吞掉坏文档；当前未做大规模容量验收。

同一记录原子保存不可变内容版本及其真实操作归属。操作指纹含实际输入和Host actor/session/purpose/expectedVersion；重试返回原操作版本，不能拿新内容复用旧operationId。重复更新在native transform内终止，不再次发布或emit。no-op记录请求去重但不造内容revision/红笔修改。read返回内容schema解析的副本，调用方不能修改存储内存。

初建因native update不支持缺失key而用一条进程内create队列补足；它在workspace独占锁之内，检查同ID并调用原生put。旧版本快照用于本课diff，不依赖Git提交。只读changedFields从真实前后快照计算，没有额外活动账。

## 真实多对象差额

| 操作 | 策略与归属 | 当前证据 |
|---|---|---|
| 一张卡的内容、历史、去重 | 一个记录内发布 | P1.3已验 |
| 确认的目标效果+提案状态+回执 | P5.3用目标operation幂等和单项恢复关联，明确保存与投递窗口 | 未实现，不宣称事务完成 |
| 骨架改径+关联卡+未开安排 | P6.3写者全预检后窄提交/恢复 | 未实现 |
| 整包检查/预览/发布 | P8作品快照与窄安装提交 | 本轮P1–P7范围外 |
| 查询/设置/日历投影 | 原生单记录或纯读，无通用journal | 后续按消费者验证 |

测试真实磁盘和独立子进程：并发版本竞争、丢响应重试、跨workspace/错误类型、内容副本不反写、重启、no-op、损坏single、双进程锁、发布前/发布后SIGKILL及原操作重试。没有重写DSH持久化原语。原生插件卸载只close写者和释放锁，不删除学生记录。

`dev-isolated`现复制contracts/domain/host/client全部本地构建闭包；每包本地@studyforge引用指向同一次临时快照，第三方库继续共享锁定node_modules，避免新增domain依赖回到活源码树。
