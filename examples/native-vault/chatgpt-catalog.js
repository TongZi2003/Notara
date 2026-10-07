const validId = value => typeof value === 'string' && /^[\x21-\x7e]{1,256}$/.test(value);

/** The selected SIWC account is authoritative; public API-key catalogs are unrelated. */
export function chatgptModelCatalog(response) {
  if (!Array.isArray(response?.models) || response.models.length > 2000) throw new Error('chatgpt_catalog_invalid');
  const seen = new Set(), models = [];
  for (const model of response.models) {
    if (model?.visibility !== 'list' || !validId(model.slug) || seen.has(model.slug)) continue;
    seen.add(model.slug);
    const name = typeof model.display_name === 'string' && model.display_name.trim() && model.display_name.length <= 512 ? model.display_name : model.slug;
    models.push({ id: model.slug, name });
  }
  return models;
}

export function cachedChatgptCatalog(value) {
  if (value?.format !== 1 || !Number.isSafeInteger(value.fetchedAt) || value.fetchedAt < 0 || value.fetchedAt > Date.now() + 60_000 ||
      !Array.isArray(value.models) || value.models.length > 2000 || value.models.some(model =>
        !validId(model?.id) || typeof model.name !== 'string' || !model.name.trim() || model.name.length > 512) ||
      new Set(value.models.map(model => model.id)).size !== value.models.length) return;
  return { format: 1, fetchedAt: value.fetchedAt, models: value.models.map(({ id, name }) => ({ id, name })) };
}
