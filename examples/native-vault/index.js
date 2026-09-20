import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { join } from 'node:path';
import { createVaultStore, safeRelativePath } from './vault.js';

const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';
const MAX_CONTENT_LENGTH = 2_000_000;

function fail(code) {
  throw new Error(code);
}

function objectInput(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('vault_input_invalid');
  return value;
}

function stringInput(value, name, max = 200_000) {
  if (typeof value !== 'string' || value.length > max) fail(`vault_${name}_invalid`);
  return value;
}

function exactInput(value, required, optional = []) {
  const input = objectInput(value), allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) fail('vault_input_invalid');
  for (const key of required) if (!Object.hasOwn(input, key)) fail('vault_input_invalid');
  return input;
}

function limitInput(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum) fail('vault_limit_invalid');
  return value;
}

function pathInput(value, name = 'path') {
  try { return safeRelativePath(stringInput(value, name, 1_000)); }
  catch { fail('vault_path_invalid'); }
}

function expectedRevision(value) {
  if (value !== null && (typeof value !== 'string' || value.length > 100)) fail('vault_revision_invalid');
  return value;
}

function valuesInput(value) {
  const input = objectInput(value);
  for (const [key, item] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key) || (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean')) fail('vault_template_values_invalid');
  }
  return input;
}

export class NotaraVaultRemote extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'notaraVault');
    this.store = createVaultStore(join(process.cwd(), 'vault'));
  }

  async list(input) {
    const data = exactInput(input, [], ['prefix']);
    return this.store.list(data.prefix === undefined ? undefined : pathInput(data.prefix, 'prefix'));
  }

  async read(input) {
    const data = exactInput(input, ['path']);
    return this.store.read(pathInput(data.path));
  }

  async save(input) {
    const data = exactInput(input, ['path', 'content', 'expectedRevision']);
    const content = stringInput(data.content, 'content', MAX_CONTENT_LENGTH);
    return this.store.save(pathInput(data.path), content, expectedRevision(data.expectedRevision));
  }

  async search(input) {
    const data = exactInput(input, ['query'], ['limit']);
    return this.store.search(stringInput(data.query, 'query', 2_000), limitInput(data.limit, 50, 100));
  }

  async query(input) {
    const data = exactInput(input, ['where'], ['limit']);
    const where = objectInput(data.where);
    if (Object.keys(where).length > 12) fail('vault_query_invalid');
    return this.store.query(where, limitInput(data.limit, 100, 500));
  }

  async links(input) {
    const data = exactInput(input, ['path']);
    return this.store.links(pathInput(data.path));
  }

  async templates(input) {
    exactInput(input, []);
    return this.store.templates();
  }

  async createFromTemplate(input) {
    const data = exactInput(input, ['templatePath', 'path', 'values', 'expectedRevision']);
    return this.store.createFromTemplate(pathInput(data.templatePath, 'template_path'), pathInput(data.path), valuesInput(data.values), expectedRevision(data.expectedRevision));
  }

  async tasks(input) {
    const data = exactInput(input, ['path']);
    return this.store.tasks(pathInput(data.path));
  }

  async toggleTask(input) {
    const data = exactInput(input, ['path', 'line', 'checked', 'expectedRevision']);
    if (!Number.isInteger(data.line) || data.line < 1) fail('vault_task_not_found');
    if (typeof data.checked !== 'boolean') fail('vault_task_invalid');
    return this.store.toggleTask(pathInput(data.path), data.line, data.checked, expectedRevision(data.expectedRevision));
  }
}

// The standalone prototype is JavaScript, so it cannot use the TypeScript
// generator. Keep the same marker shape the protocol decorator writes; the
// Gateway then derives conservative src-json descriptors from the methods.
Object.defineProperty(NotaraVaultRemote.prototype, REMOTE_METHOD_DESCRIPTOR, {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze(['list', 'read', 'save', 'search', 'query', 'links', 'templates', 'createFromTemplate', 'tasks', 'toggleTask'].map(method => Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' }) }))),
  }),
});

export function apply(ctx) {
  ctx.plugin(NotaraVaultRemote);
}
