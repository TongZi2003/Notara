import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';
import { join } from 'node:path';
import { ChatgptAccounts } from './chatgpt-auth.js';
import { ChatgptAdapter } from './chatgpt-provider.js';
import { CHATGPT_METHODS, CHATGPT_AUTHENTICATED_EVENT } from './chatgpt-contract.js';

/** Account management uses the same authenticated native Remote gateway as settings. */
export function installChatgpt(ctx) {
  ctx.plugin({ name: 'notara-chatgpt', inject: ['llm'], apply(scope) {
    if (!process.env.DSH_HOME) return;
    let registration, adapter;
    const accounts = new ChatgptAccounts(join(process.env.DSH_HOME, 'notara-chatgpt'), { onChange: change => {
      const routes = accounts.data.accounts.filter(a => a.accessToken && a.scopes.includes('chatgpt.tokens.use.direct')).map(a => `notara-chatgpt-${a.id}`);
      if (registration) registration.replace(routes);
      else if (routes.length) { adapter = new ChatgptAdapter(accounts, scope.get('attachments')); registration = scope.llm.registerAdapter(routes, adapter); }
      const provider = `notara-chatgpt-${change?.accountId}`;
      if (change?.reason === 'signed-in' && routes.includes(provider)) {
        adapter.resetCatalog(provider);
        void adapter.refreshModels(provider).then(() => {
          // A directory read may have cached a failed first request. Invalidate
          // it once the account catalog arrives, using the same native event.
          scope.emit(CHATGPT_AUTHENTICATED_EVENT, provider);
        }).catch(() => {});
        scope.emit(CHATGPT_AUTHENTICATED_EVENT, provider);
      }
    } });
    class ChatgptRemote extends TypertRemoteService {
      constructor(context) { super(context, 'notaraChatgpt'); }
      async call(method, input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => k !== 'id') || (input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 100))) throw new Error('chatgpt_input_invalid');
        try { return await method(); }
        catch (error) { throw new Error(/^chatgpt_/.test(error.message) ? error.message : error.code === 'AUTH' ? 'chatgpt_signin_required' : error.code === QUOTA_EXCEEDED_CODE ? 'chatgpt_usage_limit' : 'chatgpt_request_failed'); }
      }
      status(input) { return this.call(() => accounts.status(), input); }
      begin(input) { return this.call(() => accounts.begin(input.id), input); }
      cancel(input) { return this.call(() => { accounts.cancel(); return {}; }, input); }
      signOut(input) { return this.call(() => accounts.signOut(input.id), input); }
      models(input) { return this.call(async () => {
        const provider = `notara-chatgpt-${input.id}`;
        const models = await (adapter ?? new ChatgptAdapter(accounts)).refreshModels(provider);
        scope.emit(CHATGPT_AUTHENTICATED_EVENT, provider);
        return { models };
      }, input); }
    }
    Object.defineProperty(ChatgptRemote.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', { value: { version: 1, methods: CHATGPT_METHODS.map(method => ({ method, invocation: { kind: 'direct' } })) } });
    scope.plugin(ChatgptRemote);
    scope.effect(() => { void accounts.status().then(() => accounts.onChange()).catch(() => {}); return () => { accounts.close(); registration?.(); }; });
  } });
}
