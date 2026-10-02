import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { REMOTE_SETTINGS_METHODS, REMOTE_SETTINGS_PHASES, REMOTE_SETTINGS_NOTICES } from './remote-settings-contract.js';

const credentials = { url: process.env.NOTARA_REMOTE_SETTINGS_URL, token: process.env.NOTARA_REMOTE_SETTINGS_TOKEN };
delete process.env.NOTARA_REMOTE_SETTINGS_URL;
delete process.env.NOTARA_REMOTE_SETTINGS_TOKEN;
const CONFIG_FIELDS = ['publicHost', 'username', 'ngrokPath', 'proxyPort', 'ngrokApiPort'];
const SAVE_FIELDS = [...CONFIG_FIELDS, 'password', 'authtoken'];

/** Only explicit display fields cross the Host/browser boundary, even if a launcher regresses. */
export function publicRemoteSettings(value) {
  if (!value || typeof value !== 'object' || !REMOTE_SETTINGS_PHASES.includes(value.phase)) throw new Error('remote_bridge_unavailable');
  const config = {};
  for (const field of CONFIG_FIELDS) {
    const item = value.config?.[field];
    if (field.endsWith('Port')) { if (Number.isInteger(item) && item > 0 && item <= 65535) config[field] = item; }
    else if (typeof item === 'string' && item.length <= 1000) config[field] = item;
  }
  const result = { available: value.available === true, phase: value.phase, configured: value.configured === true, canDisable: value.canDisable === true || value.phase === 'enabled', config,
    hasPassword: value.hasPassword === true, hasAuthtoken: value.hasAuthtoken === true };
  if (Object.hasOwn(REMOTE_SETTINGS_NOTICES, value.code)) result.code = value.code;
  if (value.phase === 'enabled' && typeof value.url === 'string') {
    try {
      const url = new URL(value.url);
      if (url.protocol === 'https:' && url.hostname === config.publicHost && !url.username && !url.password && !url.port && url.pathname === '/login' && !url.search && !url.hash) result.url = url.href;
    } catch { /* A malformed public link is never rendered. */ }
  }
  return result;
}

function validInput(method, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('remote_input_invalid');
  if (Object.keys(input).some(key => !(method === 'save' && SAVE_FIELDS.includes(key)))) throw new Error('remote_input_invalid');
  if (method === 'save') {
    for (const key of ['publicHost', 'username']) if (typeof input[key] !== 'string' || !input[key].trim()) throw new Error('remote_input_invalid');
    for (const [key, value] of Object.entries(input)) {
      if (key.endsWith('Port')) { if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error('remote_input_invalid'); }
      else if (typeof value !== 'string' || value.length > 1000 || /[\r\n\0]/.test(value)) throw new Error('remote_input_invalid');
    }
  }
  return input;
}

export function createRemoteSettingsBridge({ url = credentials.url, token = credentials.token } = {}, fetcher = fetch) {
  if (url && (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url) || !token)) throw new Error('remote_bridge_unavailable');
  const unsupported = { available: false, phase: 'unsupported', configured: false, config: {}, hasPassword: false, hasAuthtoken: false, code: 'remote_unsupported' };
  return {
    async call(method, input) {
      if (!REMOTE_SETTINGS_METHODS.includes(method)) throw new Error('remote_input_invalid');
      validInput(method, input);
      if (!url || !token) {
        if (method === 'status') return unsupported;
        throw new Error('remote_unsupported');
      }
      try {
        const response = await fetcher(`${url}/remote/${method}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(input), signal: AbortSignal.timeout(method === 'status' ? 5000 : 60_000) });
        const value = await response.json();
        if (!response.ok) throw new Error(Object.hasOwn(REMOTE_SETTINGS_NOTICES, value?.code) ? value.code : 'remote_bridge_unavailable');
        return publicRemoteSettings(value);
      } catch (error) { throw new Error(Object.hasOwn(REMOTE_SETTINGS_NOTICES, error?.message) ? error.message : 'remote_bridge_unavailable'); }
    },
  };
}

export function installRemoteSettings(ctx) {
  const bridge = createRemoteSettingsBridge();
  class RemoteSettings extends TypertRemoteService {
    constructor(scope) { super(scope, 'notaraRemote'); }
    status(input) { return bridge.call('status', input); }
    save(input) { return bridge.call('save', input); }
    enable(input) { return bridge.call('enable', input); }
    disable(input) { return bridge.call('disable', input); }
  }
  Object.defineProperty(RemoteSettings.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
    value: { version: 1, methods: REMOTE_SETTINGS_METHODS.map(method => ({ method, invocation: { kind: 'direct' } })) },
  });
  ctx.plugin(RemoteSettings);
}
