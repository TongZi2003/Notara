import type { Context } from '@deepseek-ai/cordis';
import type { MutationContext } from '@studyforge/contracts';
import { ProposalEffectRejected, type ProposalEffectItem, type ProposalExecutor } from '@studyforge/domain/proposals';
import { routeValidators } from './organization-service.ts';
import { checkHandoffProposal, closeConfirmedHandoff } from './handoff-service.ts';
import { validateCoursePatch } from './course-service.ts';
import { courseRecordRef } from '@studyforge/domain/courses';
import { SkeletonError } from '@studyforge/domain/skeleton';

/** Each confirmation invokes its real writer; the receipt describes its result. */
export function proposalExecutor(host: Context): ProposalExecutor {
  return {
    async validate(ctx, item) {
      const effect = item.effect;
      switch (effect.kind) {
        case 'card-create': await host.studyforgeCardService.check(ctx, effect.content); return;
        case 'plan-create': await host.studyforgePlanService.check(ctx, effect.content); return;
        case 'route-add': {
          const validators = routeValidators(host, host.studyforgeTeachingCatalog.choices.map(choice => choice.id));
          await validators.materials(ctx, effect.content.materials);
          if (effect.content.decl.teachingRef) await validators.teachingRef(ctx, effect.content.decl.teachingRef);
          if (effect.content.parent) host.studyforgeRouteService.node(host.studyforgeRouteService.read(ctx), effect.content.parent);
          return;
        }
        case 'set-create': {
          for (const materialId of effect.content.materials) await host.studyforgeMaterialService.get(ctx, materialId);
          return;
        }
        case 'handoff': checkHandoffProposal(host, ctx); return;
      }
      if (!item.target || typeof item.baseline !== 'number') throw new Error('proposal_target_baseline_invalid');
      switch (effect.kind) {
        case 'knowledge-collect': host.studyforgeKnowledgeService.read(ctx, item.target, item.baseline); return;
        case 'lesson-edit':
          if (!ctx.sessionId || item.target !== courseRecordRef(ctx.sessionId)) throw new Error('proposal_lesson_target_invalid');
          await validateCoursePatch(host, ctx, effect.patch); return;
        case 'card-edit': await host.studyforgeCardService.preview(ctx, item.target, item.baseline, effect.patch); return;
        case 'review': host.studyforgeCardService.read(ctx, item.target, item.baseline); return;
        case 'plan-edit': await host.studyforgePlanService.preview(ctx, item.target, item.baseline, effect.patch); return;
        case 'set-edit': host.studyforgeSetService.read(ctx, item.target, item.baseline); return;
        case 'route-edit':
          if (item.target !== 'route:tree') throw new Error('proposal_route_target_invalid');
          host.studyforgeRouteService.node(host.studyforgeRouteService.read(ctx), effect.nodeId); return;
        case 'skeleton-save': {
          if (item.target !== 'skeleton:' + effect.materialId) throw new Error('proposal_skeleton_target_invalid');
          const current = await host.studyforgeSkeletonService.read(ctx, effect.materialId);
          if ((current.revision ?? 0) !== item.baseline) throw new SkeletonError('skeleton_version_conflict',
            '目录已更新。请先调用 read_skeleton 读取当前目录，保留已有章节，再重新提交这份增补草案。');
          await host.studyforgeSkeletonAuthoring.preview(ctx, effect.materialId, item.baseline, effect.change); return;
        }
        case 'handoff-edit': host.studyforgeHandoffService.read(ctx, item.target, item.baseline); return;
      }
    },
    async apply(context, item) {
      try { return await applyEffect(host, context, item); }
      catch (error) {
        const typed = error as { name?: string; code?: string } | null;
        // prepareCreate's existing-row refusal is before publication. Older
        // versions mislabeled it as an uncertain save and offered endless retry.
        if (typed?.name === 'RecordError' && (typed.code === 'record_exists'
          || item.effect.kind === 'skeleton-save' && typed.code === 'version_conflict')) {
          throw new ProposalEffectRejected(typed.code, false);
        }
        // Only deterministic pre-publication refusals unlock editing. Storage
        // failures after publication still retain the original operation.
        if (['CardError', 'KnowledgeError', 'SetError', 'RouteError', 'MaterialReadError', 'ZodError'].includes(typed?.name ?? '') ||
          /^(version_conflict|record_missing|target_invalid|plan_|skeleton_)/.test(typed?.code ?? '')) {
          throw new ProposalEffectRejected(typed?.code ?? 'content_rejected');
        }
        throw error;
      }
    },
  };
}
const receipt = (target: string, revision: number, title: string) => ({ target, revision, title });
const authored = (view: { ref: string; version: number; content: { title: string } }) => receipt(view.ref, view.version, view.content.title);
async function applyEffect(host: Context, context: MutationContext, item: ProposalEffectItem) {
  const target = item.target;
  const requiredTarget = (): string => { if (!target) throw new ProposalEffectRejected('proposal_target_missing'); return target; };
  switch (item.effect.kind) {
    case 'lesson-edit': {
      if (!context.sessionId || requiredTarget() !== courseRecordRef(context.sessionId)) throw new ProposalEffectRejected('proposal_lesson_target_invalid');
      await validateCoursePatch(host, context, item.effect.patch);
      const view = await host.studyforgeCourseMetadata.update(context, item.effect.patch);
      return receipt(requiredTarget(), view.version, '本课设置');
    }
    case 'card-create': return authored(await host.studyforgeCardService.create({ ...context, actor: 'student' }, item.effect.content));
    case 'card-edit': return authored(await host.studyforgeCardService.edit({ ...context, actor: 'student' }, requiredTarget(), item.effect.patch));
    case 'knowledge-collect': {
      const proposal = host.studyforgeProposalService.read(context, item.proposalRef);
      const attempt = proposal.items.find(row => row.id === item.itemId)?.attempt;
      if (!attempt) throw new Error('proposal_attempt_missing');
      return authored(await host.studyforgeKnowledgeService.collect({ ...context, actor: 'system' }, requiredTarget(), {
        confirmationId: context.operationId, collectedAt: attempt.at,
      }));
    }
    case 'review': {
      const { expectedVersion: _ignored, ...ctx } = context;
      return authored((await host.studyforgeReviewService.record({ ...ctx, actor: 'system' }, requiredTarget(), item.effect.record)).card);
    }
    case 'plan-create': return authored(await host.studyforgePlanService.create(context, item.effect.content));
    case 'plan-edit': return authored(await host.studyforgePlanService.edit(context, requiredTarget(), item.effect.patch));
    case 'set-create': {
      const view = await host.studyforgeSetService.create(context, item.effect.content);
      return receipt(view.ref, view.version, view.name);
    }
    case 'set-edit': {
      const view = await host.studyforgeSetService.update(context, requiredTarget(), item.effect.patch);
      return receipt(view.ref, view.version, view.name);
    }
    case 'route-add': {
      let content = item.effect.content;
      if (item.effect.parentItem) {
        const parentItem = item.effect.parentItem;
        const proposal = host.studyforgeProposalService.read(context, item.proposalRef);
        const parent = proposal.items.find(candidate => candidate.id === parentItem);
        if (!parent || parent.status === 'rejected' || !parent.attempt || parent.draft.effect.kind !== 'route-add') throw new ProposalEffectRejected('route_parent_not_saved');
        const parentId = host.studyforgeRouteService.createdNodeId({ ...context, operationId: parent.attempt.operationId });
        if (!host.studyforgeRouteService.read(context).nodes.some(node => node.id === parentId)) throw new ProposalEffectRejected('route_parent_not_saved');
        content = { ...content, parent: parentId };
      }
      const view = await host.studyforgeRouteService.add(context, content);
      return receipt(view.ref, view.version, item.effect.content.title);
    }
    case 'route-edit': {
      const view = await host.studyforgeRouteService.edit(context, item.effect.nodeId, item.effect.patch);
      return receipt(view.ref, view.version, host.studyforgeRouteService.node(view, item.effect.nodeId).title);
    }
    case 'skeleton-save': {
      const view = await host.studyforgeSkeletonAuthoring.save(context, item.effect.materialId, item.effect.change);
      if (view.revision === undefined) throw new Error('saved_skeleton_revision_missing');
      const material = await host.studyforgeMaterialService.get(context, item.effect.materialId);
      return receipt('skeleton:' + view.materialId, view.revision, material.title + ' · 目录');
    }
    case 'handoff': return await closeConfirmedHandoff(host, context, item);
    case 'handoff-edit': {
      const view = await host.studyforgeHandoffService.correct(context, requiredTarget(), item.effect.correction);
      return receipt(view.ref, view.version, view.title);
    }
  }
}
