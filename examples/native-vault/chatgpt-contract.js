export const CHATGPT_METHODS = Object.freeze(['status', 'begin', 'cancel', 'signOut', 'models']);
export const CHATGPT_NOTICES = Object.freeze({
  chatgpt_connected: '已连接。在对话的模型选择器中选择 ChatGPT 账号下的模型即可开始。',
  chatgpt_plan_disabled: '账号已连接，但尚未允许使用订阅额度。请重新登录并授予该权限。',
  chatgpt_signed_out: '已退出此账号。',
  chatgpt_revocation_unconfirmed: '已清除本地登录信息，未能确认远端撤销。请在 ChatGPT 设置中断开 Notara。',
  chatgpt_consent_declined: '已取消授权。',
  chatgpt_signin_expired: '登录已超时，请重试。',
  chatgpt_signin_required: '登录已过期或被撤销，请重新登录。',
  chatgpt_network_error: '无法连接 ChatGPT，请检查网络后重试。',
  chatgpt_usage_limit: '订阅额度暂不可用，请查看 ChatGPT 用量设置。',
  chatgpt_storage_invalid: '本地登录记录无法读取，请检查备份后恢复，或联系维护者。',
  chatgpt_storage_permissions: '无法保护登录记录的访问权限，请检查当前系统账号权限。',
  chatgpt_identity_invalid: '无法验证 OpenAI 返回的身份，请重新登录。',
  chatgpt_request_failed: 'ChatGPT 请求未完成，请检查网络和账号状态后重试。',
});
