import { LlmError, CONTEXT_WINDOW_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm';
import { serviceForAgent } from '@deepseek-ai/dsh-agent-preset-registry';
import { latestInputProjection, planBudget, admissionPolicy, chooseRange, createRequestPricer, measuredRequestPrice } from './context-budget-plan.js';

/** Owns automatic admission/recovery; the native engine still owns every durable transaction. */
export class ContextBudgetCoordinator {
  constructor(engine, ctx, policy = {}) {
    this.engine = engine;
    this.ctx = ctx;
    this.budgetPolicy = policy;
    engine.budgetOwnerToken = Object.freeze({});
    this.recovery = new WeakMap();
    this.learned = new WeakMap();
    this.price = createRequestPricer(ctx.llm);
    if (policy.enabled === false) return;
    ctx.sessionProjections.register(latestInputProjection);
    ctx.on('agent/request-check', (payload, next) => this.owns(payload.agent) ? this.check(payload, next) : next());
    ctx.on('agent/request-error', async (payload, next) => {
      if (!this.owns(payload.agent) || payload.failure.code !== CONTEXT_WINDOW_EXCEEDED_CODE || payload.signal.aborted) return next();
      const state = this.recovery.get(payload.agent.session);
      if (!state || state.turn !== payload.turn || state.step !== payload.step || state.retries >= 4
        || state.overflowAttempts >= state.plan.overflowLimit) return next();
      state.overflowAttempts++;
      const learned = Math.floor(state.price * .60);
      this.learned.set(payload.agent.session, { route: state.route, cap: Math.min(learned, state.plan.inputCap), at: Date.now() });
      state.plan = { ...state.plan, inputCap: Math.min(learned, state.plan.inputCap), target: Math.floor(learned * .6) };
      try {
        if (await this.reduce(payload.agent, state, payload.signal, true)) return { kind: 'retry' };
      } catch (error) {
        if (payload.signal.aborted) payload.signal.throwIfAborted();
        ctx.logger.warn(`context recovery failed: ${error.code ?? error.name}`);
      }
      return next();
    });
  }
  owns(agent) {
    if (!agent?.ctx) return false;
    const owner = serviceForAgent(this.ctx, agent, 'compaction') ?? agent.ctx.get('compaction');
    return owner?.budgetOwnerToken === this.engine.budgetOwnerToken;
  }
  summaryAllowance(agent) {
    const state = this.recovery.get(agent.session);
    return state?.reducing ? state.summaryAllowance : undefined;
  }
  async check({ agent, request, turn, step, signal }, next) {
    signal.throwIfAborted();
    const session = agent.session;
    const metadata = session.requestContext();
    const header = session.requestHeader();
    if (metadata?.provider !== request.provider || metadata?.model !== request.model
      || header?.config.provider !== request.provider || header?.config.model !== request.model) {
      throw new LlmError('当前模型与请求上下文不一致，请重试。', 'NOTARA_CONTEXT_ROUTE_MISMATCH');
    }
    const route = JSON.stringify([request.provider, request.model, metadata.contextWindow ?? null, request.maxTokens ?? null]);
    const learned = this.learned.get(session);
    const plan = planBudget({ ...this.budgetPolicy, maxTokens: request.maxTokens,
      nativePolicy: admissionPolicy(this.budgetPolicy.nativePolicy, request.provider, request.model),
      contextWindow: metadata.contextWindow,
      learnedCap: learned?.route === route && Date.now() - learned.at < 30 * 60 * 1000 ? learned.cap : undefined });
    const meter = this.ctx.tokenMeter.measure(session, session.requestHeader());
    const price = measuredRequestPrice(meter, session.requestHeader(), this.price(request));
    let state = this.recovery.get(session);
    if (!state || state.turn !== turn || state.step !== step) {
      state = { turn, step, route, retries: 0, pressureAttempts: 0, overflowAttempts: 0,
        summaryAllowance: { calls: 0 }, reducing: false };
      this.recovery.set(session, state);
    }
    Object.assign(state, { request, meter, price, plan, route });
    if (price <= plan.inputCap) return next();
    if (state.retries < 4 && !state.normalizedSystem && request.messages
      .filter(message => message.role === 'system' && message.content.length > 0).length > 1) {
      state.normalizedSystem = true;
      state.retries++;
      return { kind: 'retry', startsRequestSeries: true };
    }
    if (state.retries >= 4 || state.pressureAttempts++ >= plan.pressureLimit || !await this.reduce(agent, state, signal)) {
      throw new LlmError('这次输入与保留内容超过可用上下文预算；原始记录已保留。请缩短本次输入或切换更大窗口的模型。', 'NOTARA_CONTEXT_BUDGET_EXCEEDED');
    }
    return { kind: 'retry' };
  }
  async reduce(agent, state, signal, overflow = false) {
    const session = agent.session;
    const before = state.price;
    const beforeGeneration = session.surface.replaceGeneration;
    const pruner = this.ctx.get('toolResultPruner');
    if (pruner) {
      const generation = session.surface.contentGeneration;
      pruner.pruneSession(session);
      if (session.surface.contentGeneration > generation) {
        const pruned = measuredRequestPrice(this.ctx.tokenMeter.measure(session), session.requestHeader(),
          this.price({ ...state.request, messages: session.deriveMessages() }));
        if (pruned < before && pruned <= state.plan.inputCap) { state.retries++; return true; }
      }
    }
    const meter = this.ctx.tokenMeter.measure(session, session.requestHeader());
    const protectedSeq = this.ctx.sessionProjections.stateOf(session, latestInputProjection.key).seq;
    const breakdown = this.ctx.sessionProjections.stateOf(session, 'contextBreakdown');
    const retain = overflow ? 0 : state.plan.retain ?? (state.retries === 0
      ? Math.min(8192, state.plan.target * .4) * Math.min(1, meter.surfaceTokens / Math.max(1, before)) : 0);
    let range = chooseRange(session, meter, breakdown, protectedSeq, retain)
      ?? (state.plan.retain === undefined || overflow ? chooseRange(session, meter, breakdown, protectedSeq, 0) : null);
    if (range && retain > 0 && state.plan.retain === undefined && !overflow) {
      // Retention is a soft default. One indivisible large tool call can push
      // the retained tail far beyond it and leave only a tiny old checkpoint.
      // If even removing that checkpoint cannot reach the target, select a
      // larger balanced old span before spending a summary request on it.
      const remaining = this.priceWithoutRange(session, state, meter, range);
      if (remaining !== null && remaining > state.plan.target) {
        const broader = chooseRange(session, meter, breakdown, protectedSeq, 0);
        const broaderRemaining = broader && this.priceWithoutRange(session, state, meter, broader);
        if (broader && broader.tokens > range.tokens && broaderRemaining !== null && broaderRemaining < remaining) range = broader;
      }
    }
    if (!range || range.tokens <= 0) return false;
    state.retries++;
    state.reducing = true;
    try { await this.engine.compactRegion(range.start, range.end, agent, signal); }
    finally { state.reducing = false; }
    signal.throwIfAborted();
    const after = measuredRequestPrice(this.ctx.tokenMeter.measure(session), session.requestHeader(),
      this.price({ ...state.request, messages: session.deriveMessages() }));
    return session.surface.replaceGeneration > beforeGeneration
      && (after <= state.plan.inputCap || after < before * .95);
  }
  priceWithoutRange(session, state, meter, range) {
    const first = session.surface.nodes.indexOf(range.start), last = session.surface.nodes.indexOf(range.end);
    if (first < 0 || last < first) return null;
    const ids = new Set();
    for (const seq of session.surface.nodes.slice(first, last + 1)) {
      const message = session.deriveEventMessage(session.eventAt(seq));
      if (message !== null) ids.add(message.id);
    }
    const messages = state.request.messages.filter(message => !ids.has(message.id));
    // Never infer a saving from unmatched or already-normalized message IDs.
    if (state.request.messages.length - messages.length !== ids.size) return null;
    return measuredRequestPrice({ ...meter, surfaceTokens: Math.max(0, meter.surfaceTokens - range.tokens) },
      session.requestHeader(), this.price({ ...state.request, messages }));
  }
  boundRecovery(deps) {
    let attempts = 0;
    return { ...deps, recover: (error, agent, seqs, signal) => {
      if (signal?.aborted || attempts++ >= 2) return false;
      const before = agent.session.surface.contentGeneration;
      const recovered = deps.recover(error, agent, seqs, signal);
      // SDK recovery is synchronous; truthy Promises must never form an endless loop.
      if (recovered && typeof recovered.then === 'function') { recovered.catch(() => {}); return false; }
      return recovered === true && agent.session.surface.contentGeneration > before;
    } };
  }
}
