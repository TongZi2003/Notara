# ChatGPT 订阅账号

在 **设置 → ChatGPT 账号** 点击 **Continue with ChatGPT**，在 OpenAI 登录页选择账号、工作区并允许 Notara 使用订阅额度。完成后回到 Notara，在对话的模型选择器中选择该 ChatGPT 账号下的模型。工作员也可在教室设置中选择这些模型。已有 API 服务商的配置继续可用。

支持多个账号或工作区连接。相同邮箱的连接用短标签区分；重新登录保留原连接与工作区。点击“查看可用模型”向 OpenAI 获取当前账号的模型目录，目录可见不代表每次调用都一定有额度。实际请求失败会显示原因，不会自动转为付费 API 调用。可在[ChatGPT 用量设置](https://chatgpt.com/settings/usage)查看和管理授权。

0.24.3 在成功登录时获取一次目录，同账号的并发读取合并为一次请求。已有连接优先使用自己的缓存，点击“刷新可用模型”重新获取；刷新失败保留上次有效结果并提示失败。新增 GPT 型号直接采用账号接口返回的可见目录，不用随包名单筛选。退出、授权失效或重新登录会清除旧目录；账号接口返回空列表时不会借用另一个账号的模型。

首次登录必须在运行 Notara 的电脑上完成。OpenAI 的开源应用流程使用 `127.0.0.1` 回调，远程手机上的浏览器无法访问电脑的回调端口。通过 ngrok 使用时，先在电脑登录，再从远程页面选择模型。远程访问者使用的是该 Notara 实例保存的账号，因此公网访问密码只应交给你允许使用这些账号的人。

## 数据与退出

登录令牌保存在本实例 `DSH_HOME/notara-chatgpt/accounts.json`，独立于学习资料与浏览器存储。Windows ACL 只允许当前用户和 SYSTEM，Unix 目录权限 0700、文件权限 0600。写入采用原子替换；刷新在单个运行实例内串行执行，与 Vault 的数据根锁一起避免刷新令牌竞争。不要手工共享、提交或复制该文件。

退出会停止该账号的进行中请求、尝试撤销刷新令牌并清除本地凭据，保留账号与 client ID 对应关系供重新登录。网络故障导致远端撤销未确认时，界面明确提示去 ChatGPT 设置断开连接。用户的 ChatGPT 历史对话不会被导入。

## 实现与限制

- 使用官方动态客户端注册、PKCE、state、nonce、OpenAI JWKS 签名与 issuer/audience/expiry 校验。无需 API key 或 client secret。
- 使用 `https://api.openai.com/v1/models` 与 `/responses`；请求固定 `store: false`、`stream: true`，每次发送本地保留的上下文。仅收到 `response.completed` 才判成功。
- 原生会话保留 OpenAI 返回的加密推理项与助手阶段；仅对同一账号、同一模型且消息正文未变的历史回放，切换账号、编辑或压缩后不重放旧的加密项。
- 本地学习工具通过 namespace function tools 接线，保留 DSH 原生工具权限和审批。文本与图片、工具输入/输出映射到 Responses；文件沿用 DSH 的本地文件工具。此入口不提供 OpenAI 托管 Code Interpreter、文件搜索、音视频或图片生成。
- ChatGPT 订阅预览不支持 `temperature`、`max_output_tokens` 等字段，因而此提供方不传这些值；教室里填写的输出 token 预算不能作为此接口的服务端硬上限。
- 本功能面向开源、本地自托管的个人实例。账号资格、模型与限额由 OpenAI 决定；商业远程托管场景需要另行确认服务商支持。

依据：[官方注册与登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。模型目录合同核对日期：2026-10-08。

## 验证范围

确定性测试覆盖真实 loopback HTTP 回调、模拟授权端签名验证、令牌刷新与退出、模型目录、工具历史映射、SSE 分片与错误处理。浏览器测试覆盖设置入口、官方授权跳转参数、取消登录与不在浏览器存储凭据。它们不消耗订阅额度，也不能替代用户实际账号的授权与真实推理验收。0.24.3 的独立验收实例另已通过用户真实授权：目录返回 7 个型号，包含 GPT-6.1-Sol、GPT-6-Sol 和 GPT-6-Luna，并完成 GPT-6-Luna 的一轮真实对话；不由此推定其他型号或账号的调用权限。
