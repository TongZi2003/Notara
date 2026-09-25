import { createHash, randomUUID } from 'node:crypto';
import { validateInteractiveRef, validateMathScene } from './interactive-data.js';

const fail = code => { throw new Error(code); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);

export const interactionPath = (sessionId, interactionId) => {
  const owner = createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 32);
  return `lesson-interaction/${owner}/${interactionId}.json`;
};

function parseDocument(content, sessionId, interactionId) {
  let value;
  try { value = JSON.parse(content); } catch { fail('interaction_document_invalid'); }
  if (!plain(value) || value.type !== 'lesson-interaction' || value.session !== sessionId || value.interactionId !== interactionId) fail('interaction_binding_invalid');
  const scene = validateMathScene(value.scene);
  return { provider: 'math', interactionId, preset: scene.preset, scene };
}

async function readDocument(io, sessionId, interactionId) {
  let document;
  try { document = await io.readJson(interactionPath(sessionId, interactionId)); }
  catch (error) { if (error.message === 'vault_file_not_found') fail('interaction_missing'); throw error; }
  const parsed = parseDocument(document.content, sessionId, interactionId);
  const ref = validateInteractiveRef({ provider: parsed.provider, interactionId: parsed.interactionId, revision: document.revision, preset: parsed.preset });
  return { ...parsed, revision: document.revision, ref };
}

function patchScene(scene, patch) {
  if (!plain(patch) || Object.keys(patch).some(key => !['parameters', 'observation'].includes(key))) fail('interactive_scene_invalid');
  const parameters = patch.parameters === undefined ? scene.parameters : { ...scene.parameters, ...patch.parameters };
  return validateMathScene({ ...scene, parameters, ...(patch.observation === undefined ? {} : { observation: patch.observation }) });
}

export function createInteractionRuntime(service) {
  const editor = sessionId => service.editorFor({ sessionId });
  const save = async (io, sessionId, interactionId, scene, revision) => {
    const content = JSON.stringify({ type: 'lesson-interaction', session: sessionId, interactionId, provider: 'math', preset: scene.preset, scene });
    const saved = await io.saveJson(interactionPath(sessionId, interactionId), content, revision);
    const ref = validateInteractiveRef({ provider: 'math', interactionId, revision: saved.revision, preset: scene.preset });
    return { ref, revision: saved.revision, scene };
  };
  return {
    async read({ sessionId, interactionId }) {
      return readDocument(await editor(sessionId), sessionId, interactionId);
    },
    async create({ sessionId, scene }) {
      const normalized = validateMathScene(scene), interactionId = randomUUID();
      return save(await editor(sessionId), sessionId, interactionId, normalized, null);
    },
    async mutate({ sessionId, interactionId, expectedRevision, patch }) {
      const io = await editor(sessionId), current = await readDocument(io, sessionId, interactionId);
      if (expectedRevision !== current.revision) fail('vault_revision_conflict');
      return save(io, sessionId, interactionId, patchScene(current.scene, patch), current.revision);
    },
  };
}
