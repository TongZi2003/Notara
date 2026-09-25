import test from 'node:test';
import assert from 'node:assert/strict';
import { createInteractionRuntime } from './interactive-runtime.js';

const scene = () => ({ preset: 'parabola', parameters: { a: 0.8, h: 0, k: 0 } });

function memoryIO() {
  const files = new Map();
  return {
    async read(path) {
      const row = files.get(path);
      if (!row) throw new Error('vault_file_not_found');
      return row;
    },
    async save(path, content, expectedRevision) {
      const current = files.get(path);
      const revision = current?.revision ?? null;
      if (expectedRevision !== revision) throw new Error('vault_revision_conflict');
      const next = { content, revision: revision === null ? 'a'.repeat(24) : 'b'.repeat(24) };
      files.set(path, next);
      return next;
    },
    async readJson(path, expectedRevision) { return this.read(path, expectedRevision); },
    async saveJson(path, content, expectedRevision) { return this.save(path, content, expectedRevision); },
    files,
  };
}

test('creates and reopens an interaction only inside its owning classroom', async () => {
  const io = memoryIO();
  const runtime = createInteractionRuntime({ editorFor: async () => io });
  const first = await runtime.create({ sessionId: 'lesson-a', scene: scene() });
  const reopened = await runtime.read({ sessionId: 'lesson-a', interactionId: first.ref.interactionId });
  assert.equal(reopened.scene.parameters.a, 0.8);
  assert.deepEqual(reopened.ref, first.ref);
  await assert.rejects(runtime.read({ sessionId: 'lesson-b', interactionId: first.ref.interactionId }), /interaction_missing|interaction_binding_invalid/);
});

test('rejects a stale interaction revision without overwriting the current scene', async () => {
  const io = memoryIO();
  const runtime = createInteractionRuntime({ editorFor: async () => io });
  const first = await runtime.create({ sessionId: 'lesson-a', scene: scene() });
  const current = await runtime.mutate({ sessionId: 'lesson-a', interactionId: first.ref.interactionId, expectedRevision: first.revision, patch: { parameters: { a: 1.2 } } });
  await assert.rejects(runtime.mutate({ sessionId: 'lesson-a', interactionId: first.ref.interactionId, expectedRevision: first.revision, patch: { parameters: { a: 0.4 } } }), /vault_revision_conflict/);
  const reopened = await runtime.read({ sessionId: 'lesson-a', interactionId: first.ref.interactionId });
  assert.equal(reopened.revision, current.revision);
  assert.equal(reopened.scene.parameters.a, 1.2);
});
