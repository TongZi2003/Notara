/** One reader belongs to one fixed Vault client, method and input. An unchanged
 * reply reuses its exact value object: React need not compare whole JSON trees. */
export function createProjectionReader(read) {
  let cached = null, generation = 0;
  return {
    invalidate() { generation++; cached = null; },
    async read(input = {}) {
      const ticket = ++generation, prior = cached;
      const result = await read({ ...input, projectionRevision: prior?.revision ?? null });
      if (!result?.ok) return result;
      const snapshot = result.value;
      // Keep simple adapters/older in-process callers working without a token.
      if (snapshot?.kind !== 'notara-projection') return result;
      if (typeof snapshot.revision !== 'string' || !/^[a-f0-9]{64}$/.test(snapshot.revision)) throw Error('vault_projection_invalid');
      if (snapshot.unchanged === true) {
        if (!prior || prior.revision !== snapshot.revision) throw Error('vault_projection_missing');
        return { ...result, value: prior.value };
      }
      if (!Object.hasOwn(snapshot, 'value')) throw Error('vault_projection_invalid');
      if (ticket === generation) cached = { revision: snapshot.revision, value: snapshot.value };
      return { ...result, value: snapshot.value };
    },
  };
}
