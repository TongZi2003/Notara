export const INTERACTIVE_PROVIDERS = Object.freeze(['math']);
export const INTERACTIVE_PRESETS = Object.freeze(['parabola']);
const DEFAULT_VIEWPORT = Object.freeze([-5, 5, 5, -5]);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const REVISION = /^[a-f0-9]{24}$/i;
const fail = code => { throw new Error(code); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const bounded = (value, min, max) => finite(value) && value >= min && value <= max;

function exactKeys(value, keys, code) {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code);
  return value;
}

function text(value, max) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fail('interactive_scene_invalid');
  return value;
}

export function validateInteractiveRef(value) {
  exactKeys(value, ['provider', 'interactionId', 'revision', 'preset'], 'interactive_ref_invalid');
  if (!INTERACTIVE_PROVIDERS.includes(value.provider) || !INTERACTIVE_PRESETS.includes(value.preset)
    || typeof value.interactionId !== 'string' || !UUID.test(value.interactionId)
    || typeof value.revision !== 'string' || !REVISION.test(value.revision)) fail('interactive_ref_invalid');
  return { provider: value.provider, interactionId: value.interactionId, revision: value.revision, preset: value.preset };
}

export function validateMathScene(value) {
  exactKeys(value, ['kind', 'preset', 'viewport', 'parameters', 'observation'], 'interactive_scene_invalid');
  if (value.kind !== undefined && value.kind !== 'math') fail('interactive_scene_invalid');
  if (!INTERACTIVE_PRESETS.includes(value.preset)) fail('interactive_scene_invalid');
  const viewport = value.viewport === undefined ? [...DEFAULT_VIEWPORT] : value.viewport;
  if (!Array.isArray(viewport) || viewport.length !== 4 || viewport.some(item => !finite(item))) fail('interactive_scene_invalid');
  const parameters = value.parameters ?? {};
  exactKeys(parameters, ['a', 'h', 'k'], 'interactive_scene_invalid');
  const a = parameters.a === undefined ? 0.8 : parameters.a;
  const h = parameters.h === undefined ? 0 : parameters.h;
  const k = parameters.k === undefined ? 0 : parameters.k;
  if (!bounded(a, 0.1, 3) || !bounded(h, -10, 10) || !bounded(k, -10, 10)) fail('interactive_scene_invalid');
  if (value.observation !== undefined) text(value.observation, 1200);
  if (Object.hasOwn(value, 'html') || Object.hasOwn(value, 'links')) fail('interactive_scene_invalid');
  return { kind: 'math', preset: value.preset, viewport, parameters: { a, h, k }, observation: text(value.observation, 1200) };
}

export function mathSceneSummary(scene) {
  const normalized = validateMathScene(scene);
  const { a, h, k } = normalized.parameters;
  const xPart = h < 0 ? `(x + ${Math.abs(h)})` : `(x - ${h})`;
  const yPart = k < 0 ? `- ${Math.abs(k)}` : `+ ${k}`;
  return `y = ${a}${xPart}² ${yPart}`;
}

export function interactionSceneProvider(ref) {
  return validateInteractiveRef(ref).provider;
}
