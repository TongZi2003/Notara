export const REMOTE_SETTINGS_METHODS = Object.freeze(['status', 'save', 'enable', 'disable']);
export const REMOTE_SETTINGS_PHASES = Object.freeze(['disabled', 'starting', 'enabled', 'stopping', 'error', 'unsupported']);
export const REMOTE_SETTINGS_NOTICES = Object.freeze({
  remote_input_invalid: '设置格式不正确，请检查填写的内容。',
  remote_configuration_invalid: '请检查域名、用户名、密码和端口设置。',
  remote_configuration_required: '请先填写并保存远控设置。',
  remote_ngrok_missing: '没有找到 ngrok，请先安装，或在高级设置中填写程序路径。',
  remote_ngrok_unconfigured: '请填写 ngrok Authtoken，或先完成这台电脑上的 ngrok 账号配置。',
  remote_busy: '远控正在切换状态，请稍后重试。',
  remote_start_failed: '远控未能启动。请检查 ngrok 账号、域名、网络和端口；本地课堂仍可使用。',
  remote_stop_failed: '远控尚未确认关闭，请刷新状态后重试。',
  remote_save_failed: '设置未能保存，请检查运行目录是否可写。',
  remote_bridge_unavailable: '暂时无法联系远控服务，请稍后重试。',
  remote_unsupported: '当前启动方式不支持远控设置，请使用本版本的 Notara 启动器。',
});
