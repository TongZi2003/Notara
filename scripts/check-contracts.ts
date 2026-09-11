import assert from 'node:assert/strict';
import { z } from 'zod';
import { CONTRACT_SCHEMAS, CONTRACT_JSON_SCHEMAS, MODEL_CONTENT_SCHEMAS, CardContentSchema, KnowledgeContentSchema, MemoryDraftSchema, MemoryObservationSchema, LessonMaterialsSchema } from '../packages/contracts/src/index.ts';

for (const [name, schema] of Object.entries(CONTRACT_SCHEMAS)) {
  assert.deepEqual(CONTRACT_JSON_SCHEMAS[name], z.toJSONSchema(schema, { io: 'input' }));
}
const examples = {
  'card-content': { title: '检查条件', front: '', sections: [{ heading: '复习', body: '作者内容' }] },
  'knowledge-content': { title: '分母条件', body: '同除之前先分情况' },
  'memory-content': { kind: 'habit', body: '本题先检查定义域', evidenceRefs: ['E1'] },
};
const authority = ['workspaceId', 'sessionId', 'actor', 'id', 'createdAt', 'updatedAt', 'revision', 'version', 'operationId', 'expectedVersion'];
for (const [name, schema] of Object.entries(MODEL_CONTENT_SCHEMAS)) {
  const sample = examples[name as keyof typeof examples];
  assert(schema.safeParse(sample).success, name);
  for (const field of authority) assert(!schema.safeParse({ ...sample, [field]: 'forged' }).success, name + ':' + field);
  assert.equal(CONTRACT_JSON_SCHEMAS[name]?.additionalProperties, false);
}
assert.equal(CardContentSchema.parse(examples['card-content']).sections[0]?.heading, '复习');
assert.equal(KnowledgeContentSchema.parse(examples['knowledge-content']).body, '同除之前先分情况');
assert(!KnowledgeContentSchema.safeParse({ ...examples['knowledge-content'], review: {} }).success);
assert(!MemoryDraftSchema.safeParse({ ...examples['memory-content'], basis: [{}] }).success);
assert(!MemoryObservationSchema.safeParse({ kind: 'habit', body: 'x', basis: [{}] }).success);
assert.deepEqual(LessonMaterialsSchema.parse({ materials: [] }), { materials: [] });
assert(!LessonMaterialsSchema.safeParse({ materials: [], initialIndex: 0 }).success);
console.log('PASS: ' + Object.keys(CONTRACT_SCHEMAS).length + ' same-source JSON schemas; authority excluded; authored history headings preserved');
