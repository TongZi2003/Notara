/**
 * P6 plan authoring defaults: a campaign draft only has to name the plan, its
 * quota and its window. The stored shape does not change — the omit-able fields
 * normalize to `null`/`[]` — and the model-facing `propose_plan` schema has to
 * carry those defaults, because the provider validates that JSON Schema before
 * the tool ever runs.
 *
 * `registerOrganizationTools` builds its input with exactly the discriminated
 * union below and passes it through the same `toolSchema` converter, so the
 * shape asserted here is the production schema expression, independent of the
 * shared build artifact that the host resolves `@studyforge/contracts/plans`
 * through at runtime.
 */
import { expect, test } from 'vitest';
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools';
import { z } from 'zod';
import { PlanContentSchema, PlanPatchSchema, type PlanContentDraft } from '../../packages/contracts/src/plans.ts';
import { registerOrganizationTools } from '../../packages/host/src/tools/organization-tools.ts';
import { toolSchema } from '../../packages/host/src/tools/tool-schema.ts';

interface SchemaNode {
  type?: string | string[];
  const?: unknown;
  default?: unknown;
  required?: string[];
  additionalProperties?: unknown;
  properties?: Record<string, SchemaNode>;
  oneOf?: SchemaNode[];
}
interface Registered { name: string; description: string; parameters: Record<string, unknown>; output: { schema: unknown } }

/** The registrar's own input expression, so the assertion is build-independent. */
const planInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), content: PlanContentSchema }).strict(),
  z.object({ action: z.literal('edit'), target: z.string().min(1), patch: PlanPatchSchema }).strict(),
]);

function registeredTools(): Registered[] {
  const registered: Registered[] = [];
  const host = {
    effect: (fn: () => void) => { fn(); },
    tools: { register: (tool: Registered) => { registered.push(tool); } },
  } as unknown as Parameters<typeof registerOrganizationTools>[0];
  registerOrganizationTools(host);
  return registered;
}
function campaignBranch(root: SchemaNode): SchemaNode {
  const create = root.oneOf!.find(branch => branch.properties?.action?.const === 'create')!;
  return create.properties!.content!.oneOf!.find(branch => branch.properties?.kind?.const === 'campaign')!;
}

const CAMPAIGN = { kind: 'campaign', title: '期末复习', dailyCount: 10, start: '2026-09-01', end: '2026-09-30' } as const;
const FILLED = { ...CAMPAIGN, learningSetRef: 'set:1', tags: ['三角'], cards: ['card:1'], schedule: [{ date: '2026-09-02', cards: ['card:1'] }] };

test('an omitted campaign draft normalizes to the stored shape and explicit fields stay verbatim', () => {
  expect(PlanContentSchema.parse(CAMPAIGN)).toEqual({ kind: 'campaign', title: '期末复习', learningSetRef: null, tags: [],
    cards: [], dailyCount: 10, start: '2026-09-01', end: '2026-09-30', schedule: [] });
  // A student's real itinerary and set are stored exactly as sent.
  expect(PlanContentSchema.parse(FILLED)).toEqual(FILLED);
  // Omission is a wire-draft affordance only; the parsed value keeps every field.
  const draft: PlanContentDraft = CAMPAIGN;
  expect(PlanContentSchema.parse(draft)).toHaveProperty('schedule', []);
});

test('the model-facing campaign schema requires only title/dailyCount/start/end and carries the omit defaults', () => {
  const schema = toolSchema(planInput) as SchemaNode;
  expect(() => assertSupportedJsonSchema(schema as never)).not.toThrow();
  const campaign = campaignBranch(schema);
  expect([...campaign.required!].sort()).toEqual(['dailyCount', 'end', 'kind', 'start', 'title']);
  expect(campaign.properties!.learningSetRef!.default).toBeNull();
  expect(campaign.properties!.tags!.default).toEqual([]);
  expect(campaign.properties!.cards!.default).toEqual([]);
  expect(campaign.properties!.schedule!.default).toEqual([]);
  // The one number the teacher really chooses stays explicit.
  expect(campaign.properties!.dailyCount!.default).toBeUndefined();
  // The nullable set reference is still a typed union, not an unconstrained node.
  expect(campaign.properties!.learningSetRef!.oneOf!.map(branch => branch.type)).toEqual(['string', 'null']);
  // The create branch is a closed object; the book branch keeps its own required fields.
  const create = schema.oneOf!.find(branch => branch.properties?.action?.const === 'create')!;
  expect(create.additionalProperties).toBe(false);
  const book = create.properties!.content!.oneOf!.find(branch => branch.properties?.kind?.const === 'book')!;
  expect([...book.required!].sort()).toEqual(['entries', 'kind', 'materialId', 'title']);
  // Editing keeps the default-free patch shape.
  const edit = schema.oneOf!.find(branch => branch.properties?.action?.const === 'edit')!;
  expect([...edit.required!].sort()).toEqual(['action', 'patch', 'target']);
});

test('the registered propose_plan carries exactly the same-source schema', () => {
  const plan = registeredTools().find(tool => tool.name === 'propose_plan')!;
  expect(() => assertSupportedJsonSchema(plan.parameters as never)).not.toThrow();
  const registered = plan.parameters as SchemaNode;
  const source = toolSchema(planInput) as SchemaNode;
  // Field-level first, so a stale artifact reports the real difference instead
  // of one opaque object diff: an unbuilt contracts lib still marks the four
  // omit-able fields as required and carries no defaults.
  const registeredCampaign = campaignBranch(registered), sourceCampaign = campaignBranch(source);
  expect([...registeredCampaign.required!].sort()).toEqual([...sourceCampaign.required!].sort());
  for (const field of ['learningSetRef', 'tags', 'cards', 'schedule']) {
    expect(registeredCampaign.properties![field]!.default, field).toEqual(sourceCampaign.properties![field]!.default);
  }
  expect(registeredCampaign.properties!.dailyCount!.default, 'dailyCount').toBeUndefined();
  // Whole-schema equality: the registrar registers `toolSchema(planInput)` with
  // this very expression, so anything but an exact match means the model-facing
  // schema is not the contract this test just validated.
  expect(registered).toEqual(source);
});

test('invalid campaign drafts still fail and a patch never injects defaults', () => {
  expect(() => PlanContentSchema.parse({ ...CAMPAIGN, dailyCount: 0 })).toThrow();
  expect(() => PlanContentSchema.parse({ ...CAMPAIGN, dailyCount: 2.5 })).toThrow();
  expect(() => PlanContentSchema.parse({ ...CAMPAIGN, end: '2026-08-01' })).toThrowError(/campaign end precedes start/);
  expect(() => PlanContentSchema.parse({ ...CAMPAIGN, extra: true })).toThrow();
  const { dailyCount, ...withoutQuota } = CAMPAIGN;
  expect(dailyCount).toBe(10);
  expect(() => PlanContentSchema.parse(withoutQuota)).toThrow();
  // `PlanPatchSchema` is the edit wire shape: omitted fields stay omitted, so a
  // patch can never reset the itinerary the student arranged.
  expect(PlanPatchSchema.parse({})).toEqual({});
  expect(PlanPatchSchema.parse({ dailyCount: 4 })).toEqual({ dailyCount: 4 });
  expect(PlanPatchSchema.parse({ schedule: [{ date: '2026-09-02', cards: ['card:1'] }] }))
    .toEqual({ schedule: [{ date: '2026-09-02', cards: ['card:1'] }] });
});

test('the tool descriptions carry the authoring, archive and parent guidance', () => {
  const tools = registeredTools();
  const plan = tools.find(tool => tool.name === 'propose_plan')!;
  expect(plan.description).toContain('learningSetRef/tags/cards/schedule都可省略');
  expect(plan.description).toContain('schedule非空表示学生明确的整份日程');
  expect(plan.description).toContain('按每天dailyCount张的额度选卡');
  expect(plan.description).toContain('read_plan');
  const lesson = tools.find(tool => tool.name === 'propose_lesson_settings')!;
  expect(lesson.description).toContain('archived只表示把这节课归入归档');
  expect(lesson.description).toContain('propose_handoff');
  const route = tools.find(tool => tool.name === 'propose_route')!;
  expect(route.description).toContain('read_route');
  expect(route.description).toContain('parent:null');
  expect(route.description).toContain('parentIndex');
});
