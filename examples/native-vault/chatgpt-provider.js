import { LlmAdapter, LlmError, ToolCallId, QUOTA_EXCEEDED_CODE, CONTEXT_WINDOW_EXCEEDED_CODE, isContextWindowExceededError, attributionHeaders, projectToolUpdates, projectOffloadedImages, offloadedImageText } from '@deepseek-ai/dsh-llm';
import { RESOURCE } from './chatgpt-auth.js';
import { createHash } from 'node:crypto';
import { chatgptModelCatalog } from './chatgpt-catalog.js';

const contentHash = content => createHash('sha256').update(JSON.stringify(content)).digest('hex');

function responseOutputMatchesContent(output, content) {
  if (!Array.isArray(output) || output.length === 0 || !Array.isArray(content)) return false;
  const visible = [];
  for (const item of output) {
    if (item?.type === 'reasoning') continue;
    if (item?.type === 'function_call') {
      if (typeof item.call_id !== 'string' || typeof item.name !== 'string' || typeof item.arguments !== 'string'
        || item.namespace != null && item.namespace !== 'notara') return false;
      visible.push({ type: 'tool-call', id: item.call_id, name: item.name.replace(/^notara\./, ''), arguments: item.arguments });
      continue;
    }
    if (item?.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part?.type === 'output_text' && typeof part.text === 'string') visible.push({ type: 'text', text: part.text });
        else if (part?.type === 'refusal' && typeof part.refusal === 'string') visible.push({ type: 'text', text: part.refusal });
        else return false;
      }
      continue;
    }
    return false;
  }
  const expected = content.filter(block => block.type === 'text' || block.type === 'tool-call');
  return visible.length === expected.length && visible.every((block, index) => {
    const candidate = expected[index];
    return block.type === candidate.type && (block.type === 'text'
      ? block.text === candidate.text
      : block.id === candidate.id && block.name === candidate.name && block.arguments === candidate.arguments);
  });
}

function completedEventOutput(addedItems, doneItems) {
  if (doneItems.size === 0) return undefined;
  const indexes = [...new Set([...addedItems.keys(), ...doneItems.keys()])].sort((left, right) => left - right);
  if (doneItems.size !== indexes.length || indexes.some((index, position) => index !== position || !doneItems.has(index))) return undefined;
  return indexes.map(index => doneItems.get(index));
}

function completedResponseOutput(output, addedItems) {
  if (!Array.isArray(output) || output.length === 0) return undefined;
  const indexes = [...addedItems.keys()].sort((left, right) => left - right);
  if (indexes.length && (output.length !== indexes.length || indexes.some((index, position) => index !== position))) return undefined;
  return output;
}

function providerFailureFacts(response) {
  const status = response?.status;
  const requestId = response?.headers?.get?.('x-request-id');
  return {
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    ...(typeof requestId === 'string' && /^[\x21-\x7e]{1,128}$/.test(requestId) ? { requestId } : {}),
  };
}

export function chatgptFailure(code, detail = '', facts = {}) {
  const classification = [code, ...(Array.isArray(detail) ? detail : [detail])]
    .filter(value => typeof value === 'string').join(' ');
  const options = {
    ...(Number.isInteger(facts.status) && facts.status >= 100 && facts.status <= 599 ? { status: facts.status } : {}),
    ...(typeof facts.requestId === 'string' && /^[\x21-\x7e]{1,128}$/.test(facts.requestId) ? { requestId: facts.requestId } : {}),
  };
  if (code === 'chatgpt_signin_required') return new LlmError('请在设置的 ChatGPT 账号中重新登录。', 'AUTH', options);
  if (code === 'chatgpt_plan_disabled') return new LlmError('请重新登录并允许 Notara 使用 ChatGPT 订阅额度。', 'AUTH', options);
  if (code === 'chatgpt_usage_limit' || String(code).startsWith('subscription_sharing_usage_')) return new LlmError('ChatGPT 额度暂不可用，请在 ChatGPT 的用量设置中查看，或稍后重试。', QUOTA_EXCEEDED_CODE, options);
  if (isContextWindowExceededError(classification)) return new LlmError('ChatGPT 对话超过模型上下文上限。', CONTEXT_WINDOW_EXCEEDED_CODE, options);
  const status = Number.isInteger(options.status) && options.status >= 400 ? `（HTTP ${options.status}）` : '';
  return new LlmError(`ChatGPT 请求未完成${status}，请检查连接后重试。`, 'PROVIDER_ERROR', options);
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
    if (message.role === 'assistant' && replay?.format === 'notara-responses-v1' && message.source.provider === options.provider && message.source.model === options.model && replay.contentHash === contentHash(message.content) && responseOutputMatchesContent(replay.output, message.content)) {
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
  constructor(accounts, attachments) { super(); this.accounts = accounts; this.attachments = attachments; this.catalogRequests = new Map(); }
  accountId(provider) { return provider.replace(/^notara-chatgpt-/, ''); }
  providerInfo(provider) {
    const account = this.accounts.data?.accounts.find(a => a.id === this.accountId(provider));
    return { id: provider, name: `ChatGPT · ${account?.email || '订阅账号'} · ${account?.id.slice(0, 6) || ''}` };
  }
  providerRetryPolicy() { return { mode: 'normal', maxRetries: 0, retryableCodes: [], initialDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 0 }; }
  listModels(provider) { return this.accountModels(provider); }
  refreshModels(provider) { return this.accountModels(provider, true); }
  resetCatalog(provider) {
    const id = this.accountId(provider);
    this.catalogRequests.get(id)?.controller.abort();
    this.catalogRequests.delete(id);
  }
  async accountModels(provider, force = false) {
    const id = this.accountId(provider);
    try {
      if (!force && this.accounts.cachedModels) {
        const cached = await this.accounts.cachedModels(id);
        if (cached) return cached.map(model => ({ provider, ...model }));
      }
      if (!this.catalogRequests.has(id)) {
        const controller = new AbortController(), release = this.accounts.track?.(id, controller);
        const work = (async () => {
          const access = await this.accounts.access(id);
          const account = this.accounts.data?.accounts.find(value => value.id === id);
          const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
          signal.throwIfAborted();
          const result = await this.accounts.json(`${RESOURCE}/models`, { signal, headers: { authorization: `Bearer ${access}`, ...attributionHeaders() } });
          signal.throwIfAborted();
          const models = chatgptModelCatalog(result);
          if (this.accounts.cacheModels) await this.accounts.cacheModels(id, account, models);
          signal.throwIfAborted();
          return models;
        })().finally(() => { release?.(); if (this.catalogRequests.get(id)?.work === work) this.catalogRequests.delete(id); });
        this.catalogRequests.set(id, { work, controller });
      }
      return (await this.catalogRequests.get(id).work).map(model => ({ provider, ...model }));
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
        const facts = providerFailureFacts(response);
        if (response.status === 401) throw chatgptFailure('chatgpt_signin_required', '', facts);
        let upstream = {}; try { upstream = (await response.json())?.error ?? {}; } catch {}
        const details = [upstream.type, upstream.message].filter(value => typeof value === 'string');
        throw chatgptFailure(response.status === 429 ? 'chatgpt_usage_limit' : upstream.code, details, facts);
      }
      let completed = false, nextIndex = 0, toolCalls = false, replayState;
      const blocks = new Map();
      const addedItems = new Map(), doneItems = new Map();
      for await (const event of responseEvents(response.body)) {
        if (event.type === 'response.failed' || event.type === 'error') {
          const upstream = event.response?.error ?? event.error ?? {};
          const details = [upstream.type, upstream.message, event.message].filter(value => typeof value === 'string');
          throw chatgptFailure(upstream.code ?? event.code, details, providerFailureFacts(response));
        }
        if (event.type === 'response.incomplete') throw new LlmError('ChatGPT 回复不完整，请缩小问题后重试。', 'PROVIDER_ERROR', providerFailureFacts(response));
        if (event.type === 'response.output_item.added' && Number.isSafeInteger(event.output_index) && event.output_index >= 0 && event.item && typeof event.item === 'object') {
          addedItems.set(event.output_index, event.item);
        }
        if (event.type === 'response.output_item.done' && Number.isSafeInteger(event.output_index) && event.output_index >= 0 && event.item && typeof event.item === 'object') {
          doneItems.set(event.output_index, event.item);
        }
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
          const visibleBlocks = [...blocks.values()].map(({ index, ...block }) => block);
          const eventOutput = completedEventOutput(addedItems, doneItems);
          const completedOutput = completedResponseOutput(event.response?.output, addedItems);
          const output = eventOutput && responseOutputMatchesContent(eventOutput, visibleBlocks)
            ? eventOutput
            : responseOutputMatchesContent(completedOutput, visibleBlocks) ? completedOutput : undefined;
          if (output) {
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
