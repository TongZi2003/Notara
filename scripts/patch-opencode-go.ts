import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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

const replacements = Object.freeze([
	Object.freeze({ before: requestHeadersBefore, after: requestHeadersAfter }),
	Object.freeze({ before: streamHeadersBefore, after: streamHeadersAfter })
]);

/** Exact locked DSH artifact and the only permitted request-header changes. */
export const OPENCODE_GO_PATCH = Object.freeze({
	artifact: '@deepseek-ai/dsh-llm-pi-ai/lib/index.js',
	originalSha: 'b49de2029fc843b1212e5df1324e875f0cf38aef8789d84ff5fa8bba378aa56e',
	patchedSha: 'c73db63cd145b95a3a7aa30b18a57823ff4a0808e834aaf0ed2a47388e202b08',
	before: requestHeadersBefore,
	after: requestHeadersAfter,
	replacements
});

const sha = (source: string): string => createHash('sha256').update(source).digest('hex');

/** Scope Notara attribution and the native conversation ID to OpenCode Go only. */
export function patchOpenCodeGo(source: string): string {
	const digest = sha(source);
	if (digest === OPENCODE_GO_PATCH.patchedSha) return source;
	if (digest !== OPENCODE_GO_PATCH.originalSha) throw new Error('Unknown DSH pi-ai artifact; review OpenCode Go header compatibility');

	let patched = source;
	for (const { before, after } of replacements) {
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
	if (patched !== source) writeFileSync(file, patched);
	console.log('Verified DSH OpenCode Go request-header patch');
}
