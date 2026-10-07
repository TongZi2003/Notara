import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const requestHeadersBefore = `function requestHeaders(headers) {
	const attribution = attributionHeaders();
	const reserved = new Set(Object.keys(attribution).map((name) => name.toLowerCase()));
	return {
		...Object.fromEntries(Object.entries(headers ?? {}).filter(([name]) => !reserved.has(name.toLowerCase()))),
		...attribution
	};
}`;

const requestHeadersAfter = `${requestHeadersBefore}
function openCodeGoSessionTransform(baseUrl, sessionId) {
	if (typeof sessionId !== "string" || sessionId.trim().length === 0) return {};
	let parsed;
	try {
		parsed = new URL(baseUrl);
	} catch {
		return {};
	}
	if (
		parsed.protocol !== "https:" ||
		parsed.hostname !== "opencode.ai" ||
		parsed.port !== "" ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.search !== "" ||
		parsed.hash !== "" ||
		(parsed.pathname !== "/zen/go" &&
			parsed.pathname !== "/zen/go/" &&
			parsed.pathname !== "/zen/go/v1" &&
			parsed.pathname !== "/zen/go/v1/")
	) return {};
	return {
		transformHeaders: (headers) => {
			const transformed = { ...headers };
			for (const name of Object.keys(transformed)) {
				const lowerName = name.toLowerCase();
				if (lowerName === "x-opencode-session" || lowerName === "user-agent") delete transformed[name];
			}
			transformed["x-opencode-session"] = sessionId;
			transformed["user-agent"] = \`Notara (+https://github.com/TongZi2003/Notara) \${attributionHeaders()["user-agent"]}\`;
			return transformed;
		}
	};
}`;

const streamHeadersBefore = `					headers: requestHeaders(profile.headers)`;
const streamHeadersAfter = `${streamHeadersBefore},
					...openCodeGoSessionTransform(model.baseUrl, options.sessionId)`;

const importBefore = 'import { homedir } from "node:os";';
const importAfter = `import { notaraGoCatalog } from "./opencode-go-catalog.mjs";
import { notaraSubscriptionCatalogs } from "./notara-subscription-model-catalog.mjs";
${importBefore}`;
const catalogBefore = `function catalogModels(provider) {
	if (!catalogProviders().has(provider)) return /* @__PURE__ */ new Map();
	const models = getBuiltinModels(provider);
	return new Map(models.map((model) => [model.id, model]));
}`;
const catalogAfter = `function catalogModels(provider, baseURL) {
	if (!catalogProviders().has(provider)) return /* @__PURE__ */ new Map();
	const installed = getBuiltinModels(provider);
	const models = provider === "opencode-go" ? notaraGoCatalog.models(installed, baseURL) : notaraSubscriptionCatalogs.models(provider, installed, baseURL);
	return new Map(models.map((model) => [model.id, model]));
}`;
const discoveryBefore = 'async function discoverModels(request, storedProfile) {';
const discoveryAfter = `async function discoverModels(request, storedProfile, resolveSubscriptionAuth) {
	if (request.provider === "opencode-go" && notaraGoCatalog.matches(request.baseURL)) {
		try { await notaraGoCatalog.refresh({ force: true, signal: request.signal }); }
		catch (error) {
			if (request.signal?.aborted) throw error;
			throw new LlmError("OpenCode Go live model metadata could not be refreshed; the last valid catalog is retained. Retry discovery or configure a protocol explicitly", "DISCOVERY_FAILED");
		}
	} else if (notaraSubscriptionCatalogs.matches(request.provider, request.baseURL)) {
		try {
			const auth = ["openai-codex", "github-copilot"].includes(request.provider) ? await resolveSubscriptionAuth?.(request) : void 0;
			await notaraSubscriptionCatalogs.refresh(request.provider, { signal: request.signal, auth, installed: getBuiltinModels(request.provider) });
		} catch (error) {
			if (request.signal?.aborted) throw error;
			throw new LlmError("The subscription model catalog could not be refreshed; sign in first for account catalogs. The last valid catalog is retained", "DISCOVERY_FAILED");
		}
	}`;
const applyBefore = 'function apply(ctx, config) {';
const applyAfter = `async function apply(ctx, config) {
	const goCatalogHome = launchEnvironmentOf(ctx).get("DSH_HOME")?.value;
	const catalogHome = typeof goCatalogHome === "string" && goCatalogHome.trim() ? goCatalogHome : resolve(homedir(), ".dsh");
	const catalogAccounts = Object.fromEntries(await Promise.all(["openai-codex", "github-copilot"].map(async provider => {
		const ref = config.providers.get()?.[provider]?.apiKeyEnv;
		if (typeof ref === "string" && isCredentialRefName(ref)) {
			const key = ctx.get("credentials") ? (await ctx.get("credentials").resolve(credentialRef(ref)))?.value : launchEnvironmentOf(ctx).get(ref)?.value;
			if (typeof key === "string" && key.trim()) return [provider, { apiKey: key, catalogIdentity: key }];
		}
		const credential = await credentialStoreFrom(ctx).read(provider).catch(() => void 0);
		return [provider, credential?.type === "oauth" ? { apiKey: credential.access, catalogIdentity: credential.refresh } : credential?.type === "api_key" ? { apiKey: credential.key, catalogIdentity: credential.key } : void 0];
	})));
	await Promise.all([notaraGoCatalog.load(catalogHome), notaraSubscriptionCatalogs.load(catalogHome, catalogAccounts)]);`;
const memoBefore = '\tlet lastRaw;\n\tlet memoized;';
const memoAfter = '\tlet lastRaw;\n\tlet lastGoRevision;\n\tlet memoized;';
const reuseBefore = '\t\tif (raw === lastRaw && memoized !== void 0) return memoized;';
const reuseAfter = '\t\tif (raw === lastRaw && lastGoRevision === notaraGoCatalog.revision + notaraSubscriptionCatalogs.revision && memoized !== void 0) return memoized;';
const memoUpdateBefore = '\t\tlastRaw = raw;\n\t\tmemoized = next;';
const memoUpdateAfter = '\t\tlastRaw = raw;\n\t\tlastGoRevision = notaraGoCatalog.revision + notaraSubscriptionCatalogs.revision;\n\t\tmemoized = next;';
const discoveryRegistrationBefore = `	ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => discoverModels({
		...request,
		...signal === void 0 ? {} : { signal }
	}, () => storedDiscoveryProfile(request.provider)));`;
const discoveryRegistrationAfter = `	const resolveCatalogAuth = async (request, signal) => {
		const collection = createModels(auth);
		const key = request.apiKey ?? await storedDiscoveryProfile(request.provider)?.resolveApiKey();
		const provider = catalogProvider(request.provider);
		collection.setProvider({ ...provider, auth: routeAuth({ namesCredential: key !== void 0, displayName: provider.name }, provider) });
		const resolved = (await collection.getAuth(request.provider, { ...key === void 0 ? {} : { apiKey: key }, signal }))?.auth;
		const credential = await auth.credentials.read(request.provider).catch(() => void 0);
		const oauth = key === void 0 && credential?.type === "oauth";
		if (oauth && resolved?.apiKey !== credential.access) throw new LlmError("Subscription account changed while resolving catalog authorization", "DISCOVERY_FAILED");
		return resolved && { ...resolved, catalogIdentity: oauth ? credential.refresh : resolved.apiKey,
			...oauth && resolved.baseUrl ? { nativeOAuthEndpoint: new URL(resolved.baseUrl).origin } : {} };
	};
	ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
		const configured = profiles().get(request.provider);
		request = { ...request, ...request.baseURL === void 0 && configured?.baseURL !== void 0 ? { baseURL: configured.baseURL } : {} };
		const models = await discoverModels({ ...request, ...signal === void 0 ? {} : { signal } }, () => storedDiscoveryProfile(request.provider), request => resolveCatalogAuth(request, signal));
		ensureRegistrationFacts();
		ensureDirectory();
		return models;
	});`;
const replacements = Object.freeze([
	Object.freeze({ before: requestHeadersBefore, after: requestHeadersAfter }),
	Object.freeze({ before: streamHeadersBefore, after: streamHeadersAfter }),
	Object.freeze({ before: importBefore, after: importAfter }),
	Object.freeze({ before: catalogBefore, after: catalogAfter }),
	Object.freeze({ before: '\tconst defaults = catalogModels(provider);', after: '\tconst defaults = catalogModels(provider, request.baseURL);' }),
	Object.freeze({ before: '\tconst routeApi = sharedCatalogApi(defaults);', after: '\tconst routeApi = (provider === "opencode-go" && notaraGoCatalog.matches(request.baseURL)) || notaraSubscriptionCatalogs.matches(provider, request.baseURL) ? void 0 : sharedCatalogApi(defaults);' }),
	Object.freeze({ before: '\t\tconst baseUrl = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;', after: '\t\tconst configuredBase = request.baseURL ?? base?.baseUrl ?? providerBaseUrl;\n\t\tconst baseUrl = provider === "opencode-go" && notaraGoCatalog.matches(request.baseURL) ? notaraGoCatalog.baseFor(api) ?? configuredBase : notaraSubscriptionCatalogs.matches(provider, request.baseURL) ? notaraSubscriptionCatalogs.baseFor(provider, api) ?? configuredBase : configuredBase;' }),
	Object.freeze({ before: discoveryBefore, after: discoveryAfter }),
	Object.freeze({ before: '\t\tconst installed = catalogModels(request.provider);', after: '\t\tconst installed = catalogModels(request.provider, request.baseURL);' }),
	Object.freeze({ before: '\t\tif (installed.size > 0) return [...installed.values()].map((model) => ({', after: '\t\tif (installed.size > 0 || notaraSubscriptionCatalogs.hasSnapshot(request.provider, request.baseURL)) return [...installed.values()].map((model) => ({' }),
	Object.freeze({ before: applyBefore, after: applyAfter }),
	Object.freeze({ before: memoBefore, after: memoAfter }),
	Object.freeze({ before: reuseBefore, after: reuseAfter }),
	Object.freeze({ before: memoUpdateBefore, after: memoUpdateAfter }),
	Object.freeze({ before: discoveryRegistrationBefore, after: discoveryRegistrationAfter }),
	Object.freeze({ before: 'function registerPiAiFlows(ctx, auth) {', after: 'function registerPiAiFlows(ctx, auth, onAuthenticated) {' }),
	Object.freeze({ before: '\t\t\t\t\tprompt: (prompt) => session.prompt(restate(prompt))\n\t\t\t\t});', after: '\t\t\t\t\tprompt: (prompt) => session.prompt(restate(prompt))\n\t\t\t\t});\n\t\t\t\tawait onAuthenticated?.(providerId, session.signal);' }),
	Object.freeze({ before: '\t\tregisterPiAiFlows(authorized, auth);', after: `		registerPiAiFlows(authorized, auth, async (provider, signal) => {
			const base = profiles().get(provider)?.baseURL;
			try {
				if (provider === "opencode-go" && notaraGoCatalog.matches(base)) await notaraGoCatalog.refresh({ force: true, signal });
				else if (notaraSubscriptionCatalogs.matches(provider, base)) await notaraSubscriptionCatalogs.refresh(provider, { signal, installed: getBuiltinModels(provider), auth: ["openai-codex", "github-copilot"].includes(provider) ? await resolveCatalogAuth({ provider }, signal) : void 0 });
				ensureRegistrationFacts();
				ensureDirectory();
			} catch { authorized.logger.warn("Signed in; model catalog could not be refreshed. Refresh it in model settings."); }
		});` }),
	Object.freeze({ before: '\t\t\treturn toPiCredential(await writableStore(ctx).modifyRecord(recordKeyFor(providerId), async (current) => {', after: '\t\t\tconst saved = toPiCredential(await writableStore(ctx).modifyRecord(recordKeyFor(providerId), async (current) => {' }),
	Object.freeze({ before: '\t\t\t\treturn next === void 0 ? void 0 : toRecord(next);\n\t\t\t}));', after: '\t\t\t\treturn next === void 0 ? void 0 : toRecord(next);\n\t\t\t}));\n\t\t\tawait notaraSubscriptionCatalogs.credentialChanged(providerId, saved);\n\t\t\treturn saved;' }),
	Object.freeze({ before: '\t\t\tawait writableStore(ctx).deleteRecord(recordKeyFor(providerId));', after: '\t\t\tawait writableStore(ctx).deleteRecord(recordKeyFor(providerId));\n\t\t\tnotaraSubscriptionCatalogs.invalidate(providerId);' }),
]);

/** Exact locked DSH artifact, scoped Go headers and anonymous live catalog. */
export const OPENCODE_GO_PATCH = Object.freeze({
	artifact: '@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
	originalSha: 'b49de2029fc843b1212e5df1324e875f0cf38aef8789d84ff5fa8bba378aa56e',
	headerOnlySha: 'c73db63cd145b95a3a7aa30b18a57823ff4a0808e834aaf0ed2a47388e202b08',
	patchedSha: '7c3ccf2edd915d2fad1aac0a45c7c12ebc3b658bbb9f18421ea4cddd988672fc',
	helperSha: '496fa904d2f422aae2b4d540b1ad3fec52cfe95414e569adbd9eeddfbd6c6827',
	subscriptionHelperSha: 'f58ad5239435f40797dde3806c3e3da82624a5bc39914ba0f9785f9f8ef3dc04',
	before: requestHeadersBefore,
	after: requestHeadersAfter,
	replacements
});

const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Scope Notara headers and missing-model protocols to official OpenCode Go. */
export function patchOpenCodeGo(source: string): string {
	const digest = sha(source);
	if (digest === OPENCODE_GO_PATCH.patchedSha) return source;
	if (digest !== OPENCODE_GO_PATCH.originalSha && digest !== OPENCODE_GO_PATCH.headerOnlySha) throw new Error('Unknown DSH pi-ai artifact; review OpenCode Go compatibility');

	let patched = source;
	for (const { before, after } of digest === OPENCODE_GO_PATCH.headerOnlySha ? replacements.slice(2) : replacements) {
		if (patched.split(before).length !== 2) throw new Error('DSH pi-ai OpenCode Go patch anchor changed');
		patched = patched.replace(before, after);
	}
	if (sha(patched) !== OPENCODE_GO_PATCH.patchedSha) throw new Error('DSH pi-ai OpenCode Go patch digest mismatch');
	return patched;
}

/** Apply the verified patch to the installed locked artifact. */
export function applyOpenCodeGoPatch(): void {
	const file = fileURLToPath(new URL(`../node_modules/${OPENCODE_GO_PATCH.artifact}`, import.meta.url));
	const source = readFileSync(file, 'utf8');
	const patched = patchOpenCodeGo(source);
	const helper = readFileSync(new URL('./opencode-go-catalog.mjs', import.meta.url), 'utf8');
	if (sha(helper) !== OPENCODE_GO_PATCH.helperSha) throw new Error('OpenCode Go live catalog helper digest mismatch');
	const helperFile = fileURLToPath(new URL('./opencode-go-catalog.mjs', new URL(`../node_modules/${OPENCODE_GO_PATCH.artifact}`, import.meta.url)));
	if (existsSync(helperFile) && sha(readFileSync(helperFile, 'utf8')) !== OPENCODE_GO_PATCH.helperSha) throw new Error('Unknown installed OpenCode Go live catalog helper');
	const subscriptionHelper = readFileSync(new URL('./subscription-model-catalog.mjs', import.meta.url), 'utf8');
	if (sha(subscriptionHelper) !== OPENCODE_GO_PATCH.subscriptionHelperSha) throw new Error('Subscription catalog helper digest mismatch');
	const subscriptionFile = fileURLToPath(new URL('./notara-subscription-model-catalog.mjs', new URL(`../node_modules/${OPENCODE_GO_PATCH.artifact}`, import.meta.url)));
	if (existsSync(subscriptionFile) && sha(readFileSync(subscriptionFile, 'utf8')) !== OPENCODE_GO_PATCH.subscriptionHelperSha) throw new Error('Unknown installed subscription catalog helper');
	if (!existsSync(helperFile)) writeFileSync(helperFile, helper);
	if (!existsSync(subscriptionFile)) writeFileSync(subscriptionFile, subscriptionHelper);
	if (patched !== source) writeFileSync(file, patched);
	console.log('Verified DSH OpenCode Go headers and model protocols');
}
