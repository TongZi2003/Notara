import { LlmAdapter, LlmError, ToolCallId, QUOTA_EXCEEDED_CODE, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, attributionHeaders, projectToolUpdates, projectOffloadedImages, offloadedImageText } from '@deepseek-ai/dsh-llm';
import { RESOURCE } from './chatgpt-auth.js';
import { createHash } from 'node:crypto';

const contentHash = content => createHash('sha256').update(JSON.stringify(content)).digest('hex');

export function chatgptFailure(code, detail = '') {
  if (code === 'chatgpt_signin_required') return new LlmError('请在设置的 ChatGPT 账号中重新登录。', 'AUTH');
  if (code === 'chatgpt_plan_disabled') return new LlmError('请重新登录并允许 Notara 使用 ChatGPT 订阅额度。', 'AUTH');
  if (code === 'chatgpt_usage_limit' || String(code).startsWith('subscription_sharing_usage_')) return new LlmError('ChatGPT 额度暂不可用，请在 ChatGPT 的用量设置中查看，或稍后重试。', QUOTA_EXCEEDED_CODE);
  if (isContextWindowExceededError(`${code ?? ''} ${detail}`)) return new LlmError('ChatGPT 对话超过模型上下文上限。', CONTEXT_WINDOW_EXCEEDED_CODE);
  return new LlmError('ChatGPT 请求未完成，请检查连接后重试。', 'PROVIDER_ERROR');
}

/** DSH usage buckets are disjoint; Responses input_tokens includes cached input. */
function responsesUsage(raw) {
  const malformed = () => { throw new LlmError('ChatGPT 返回了无效的用量数据。', 'MALFORMED_RESPONSE'); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) malformed();
  const count = value => {
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0) malformed();
    return value;
  };
  const input = count(raw.input_tokens), output = count(raw.output_tokens);
  const cached = count(raw.input_tokens_details?.cached_tokens);
  if (cached > input) malformed();
  const total = count(raw.total_tokens === undefined ? input + output : raw.total_tokens);
  return { inputTokens: input - cached, outputTokens: output, cacheReadTokens: cached,
    ...(total === input + output ? { totalTokens: total } : {}) };
}

/** Translate the full local history; subscription HTTP requests cannot use server conversation state. */
export async function responsesRequest(options, imageContent) {
  const projected = projectToolUpdates(options.messages, options.tools, undefined, options.toolHistory);
  const messages = projectOffloadedImages(projected.messages, ref => offloadedImageText(ref));
  const input = [];
  if (options.system) input.push({ role: 'developer', content: options.system });
  for (const message of messages) {
    const replay = message.source?.replayState?.response;
    // Retain opaque encrypted reasoning and assistant phase only for unchanged content
    // from this exact account/model. Edits, compaction and account switches use plain history.
    if (message.role === 'assistant' && replay?.format === 'notara-responses-v1' && message.source.provider === options.provider && message.source.model === options.model && replay.contentHash === contentHash(message.content) && Array.isArray(replay.output)) {
      input.push(...replay.output); continue;
    }
    const content = [];
    const flush = () => { if (content.length) input.push({ role: message.role === 'system' ? 'developer' : message.role, content: content.splice(0) }); };
    if (message.role === 'tool') {
      const output = [];
      for (const block of message.content) {
        if (block.type === 'text') output.push({ type: 'input_text', text: block.text });
        else if (block.type === 'image' && imageContent) output.push(await imageContent(block));
        else if (block.type !== 'reasoning') throw new LlmError('此 ChatGPT 请求包含暂不支持的工具输出。', 'UNSUPPORTED_CONTENT');
      }
      input.push({ type: 'function_call_output', call_id: message.source.callId, output }); continue;
    }
    for (const block of message.content) {
      if (block.type === 'text') content.push({ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: block.text });
      else if (block.type === 'tool-call') { flush(); input.push({ type: 'function_call', call_id: block.id, namespace: 'notara', name: block.name, arguments: block.arguments }); }
      else if (block.type === 'image' && imageContent && message.role === 'user') content.push(await imageContent(block));
      else if (!['reasoning', 'tool-addition', 'tool-removal'].includes(block.type)) throw new LlmError('此 ChatGPT 请求包含暂不支持的内容。', 'UNSUPPORTED_CONTENT');
    }
    flush();
  }
  const tools = projected.tools?.filter(tool => tool.name !== 'tool_search').map(tool => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.parameters, strict: false }));
  return { model: options.model, input, store: false, stream: true,
    ...(tools?.length ? { tools: [{ type: 'namespace', name: 'notara', description: 'Notara learning tools', tools }] } : {}),
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}) };
}

/** SSE lines can span network chunks; incomplete streams must never be reported as success. */
export async function* responseEvents(body) {
  if (!body) throw chatgptFailure('missing_body');
  const decoder = new TextDecoder(); let buffer = '', data = [];
  const event = () => { const text = data.join('\n'); data = []; if (!text || text === '[DONE]') return null; try { return JSON.parse(text); } catch { throw chatgptFailure('invalid_event'); } };
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    if (buffer.length > 8_000_000) throw chatgptFailure('event_too_large');
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
      if (!line) { const value = event(); if (value) yield value; }
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }
  }
  buffer += decoder.decode();
  if (buffer.startsWith('data:')) data.push(buffer.slice(5).trim());
  const value = event(); if (value) yield value;
}

export class ChatgptAdapter extends LlmAdapter {
  constructor(accounts, attachments) { super(); this.accounts = accounts; this.attachments = attachments; }
  accountId(provider) { return provider.replace(/^notara-chatgpt-/, ''); }
  providerInfo(provider) {
    const account = this.accounts.data?.accounts.find(a => a.id === this.accountId(provider));
    return { id: provider, name: `ChatGPT · ${account?.email || '订阅账号'} · ${account?.id.slice(0, 6) || ''}` };
  }
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 0 }; }
  async listModels(provider) {
    try {
      const access = await this.accounts.access(this.accountId(provider));
      const result = await this.accounts.json(`${RESOURCE}/models`, { headers: { authorization: `Bearer ${access}`, ...attributionHeaders() } });
      if (!Array.isArray(result.models)) throw chatgptFailure('catalog_invalid');
      return result.models.filter(m => m.visibility === 'list' && typeof m.slug === 'string').map(m => ({ provider, id: m.slug, name: m.display_name || m.slug }));
    } catch (error) { if (error.message?.startsWith('chatgpt_')) throw chatgptFailure(error.message); throw error; }
  }
  async resolveModel(provider, model) {
    // Do not invent context-window or output-budget metadata. Actual inference proves access.
    return { provider, id: model, name: model, systemPromptUpdate: 'in-history', inputModalities: ['text', 'image'] };
  }
  async *stream(options) {
    const controller = new AbortController(), id = this.accountId(options.provider);
    const release = this.accounts.track(id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10 * 60_000), ...(options.signal ? [options.signal] : [])]);
    try {
      const access = await this.accounts.access(id); signal.throwIfAborted();
      const request = await responsesRequest(options, async block => {
        if (!this.attachments) throw new LlmError('图片读取服务暂不可用。', 'UNSUPPORTED_CONTENT');
        const scale = Math.min(1, 2048 / Math.max(block.attachment.width, block.attachment.height));
        const version = await this.attachments.readImageRequest(block.attachment, { width: Math.max(1, Math.round(block.attachment.width * scale)), height: Math.max(1, Math.round(block.attachment.height * scale)), maxBytes: 5_000_000 }, signal);
        return { type: 'input_image', image_url: `data:${version.mediaType};base64,${Buffer.from(version.data).toString('base64')}` };
      });
      const response = await this.accounts.request(`${RESOURCE}/responses`, { method: 'POST', signal, headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', ...attributionHeaders() }, body: JSON.stringify(request) });
      if (!response.ok) {
        if (response.status === 401) throw chatgptFailure('chatgpt_signin_required');
        let code, detail; try { const error = (await response.json()).error; code = error?.code; detail = error?.message ?? error?.type; } catch {}
        throw chatgptFailure(response.status === 429 ? 'chatgpt_usage_limit' : code, detail);
      }
      let completed = false, nextIndex = 0, toolCalls = false, replayState;
      const blocks = new Map();
      for await (const event of responseEvents(response.body)) {
        if (event.type === 'response.failed' || event.type === 'error') throw chatgptFailure(event.response?.error?.code || event.code, event.response?.error?.message || event.message);
        if (event.type === 'response.incomplete') throw new LlmError('ChatGPT 回复不完整，请缩小问题后重试。', 'PROVIDER_ERROR');
        if (event.type === 'response.output_item.added' && event.item?.type === 'function_call') {
          const item = event.item;
          const block = { index: nextIndex++, type: 'tool-call', id: ToolCallId(item.call_id), name: item.name.replace(/^notara\./, ''), arguments: item.arguments || '' };
          blocks.set(`tool:${event.output_index}`, block); toolCalls = true;
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' };
          yield { type: 'tool-call-delta', index: block.index, id: block.id, name: block.name, argumentsDelta: block.arguments };
        } else if (event.type === 'response.function_call_arguments.delta') {
          const block = blocks.get(`tool:${event.output_index}`); if (!block) throw chatgptFailure('invalid_event');
          block.arguments += event.delta;
          yield { type: 'tool-call-delta', index: block.index, id: block.id, argumentsDelta: event.delta };
        } else if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
          const key = `text:${event.output_index}:${event.content_index}`; let block = blocks.get(key);
          if (!block) { block = { index: nextIndex++, type: 'text', text: '' }; blocks.set(key, block); yield { type: 'block-start', index: block.index, blockType: 'text' }; }
          block.text += event.delta; yield { type: 'text-delta', index: block.index, text: event.delta };
        } else if (event.type === 'response.completed') {
          if (event.response?.status !== 'completed') throw chatgptFailure('incomplete');
          completed = true;
          if (Array.isArray(event.response.output)) {
            const output = event.response.output.filter(item => ['reasoning', 'message', 'function_call'].includes(item.type));
            replayState = { response: { format: 'notara-responses-v1', contentHash: contentHash([...blocks.values()].map(({ index, ...block }) => block)), output } };
          }
          for (const block of blocks.values()) { const { index, ...content } = block; yield { type: 'block-end', index, block: content }; }
          const usage = event.response.usage;
          if (usage !== undefined) yield { type: 'usage', usage: responsesUsage(usage) };
          break;
        }
      }
      if (!completed) throw chatgptFailure('stream_interrupted');
      yield { type: 'finish', reason: { kind: toolCalls ? 'tool-calls' : 'stop' }, ...(replayState ? { replayState } : {}) };
    } catch (error) { if (error.message?.startsWith('chatgpt_')) throw chatgptFailure(error.message); throw error; }
    finally { release(); }
  }
}
