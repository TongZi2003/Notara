/**
 * P4.1/P4.4 one way into an original.
 *
 * Every entry point that opens a lesson source goes through the same two steps:
 * the Host resolves the immutable version into an address this *Session* may
 * read, and the native right column opens that address. The lesson that was on
 * stage when the student clicked is the lesson the address belongs to, so a
 * switch mid-flight is reported instead of opening one lesson's file in another.
 *
 * The adapter opens what the Host really resolved. It never guesses a version,
 * never falls back to the current one, and never borrows another session. The
 * position travels as the native viewer's own navigation parameter, and only
 * for the locator that parameter really means: landing on a made-up page or
 * block would be a wrong position reported as a right one.
 */
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { MaterialContext } from '@studyforge/contracts/materials';
import type { MaterialResource } from '@studyforge/contracts/material-api';
import type { MaterialVersion } from '@studyforge/contracts/material-records';

/** What one open attempt really did. */
export type OpenOutcome = 'opened' | 'unavailable' | 'refused' | 'moved' | 'unsupported';

/** The position parameters the native file tab takes today. */
export interface NativeResourceParams {
  /** 1-based source line the native text preview scrolls to and marks. */
  readonly line?: number;
  readonly studyforge?: { readonly source: MaterialContext; readonly version: MaterialVersion };
}

export interface NativePreviewHost {
  resolveForSession(input: { readonly sessionId: string; readonly source: MaterialContext }): Promise<RemoteResult<MaterialResource>>;
  /** Hand one resolved address to the native column of the lesson on stage. */
  openAddress(address: string, params?: NativeResourceParams): Promise<void>;
}

/**
 * The position the native viewer can really show for one locator.
 *
 * The plain-text body is the only native preview that consumes a target
 * position (`line`); the Markdown, PDF and Word bodies render the version from
 * its start. Returning nothing is the honest answer there — the tab still opens
 * the exact immutable version the reference names.
 */
export function nativeParamsFor(locator: MaterialContext['locator']): NativeResourceParams | undefined {
  return locator?.kind === 'text' ? { line: locator.start.line } : undefined;
}

/**
 * Resolve and open one lesson source.
 *
 * @param stillCurrent - reads the lesson on stage now; the click only lands in
 * the lesson it was made in.
 */
export async function openLessonSource(
  host: NativePreviewHost,
  sessionId: string,
  source: MaterialContext,
  stillCurrent: () => string | undefined,
): Promise<OpenOutcome> {
  let resolved: RemoteResult<MaterialResource>;
  try {
    resolved = await host.resolveForSession({ sessionId, source });
  } catch {
    return 'unavailable';
  }
  if (!resolved.ok) return 'refused';
  const now = stillCurrent();
  // No current lesson, or a different one: the address must not be opened in a
  // column that belongs to somebody else.
  if (now === undefined || now !== sessionId) return 'moved';
  try {
    const context: MaterialContext = { materialId: source.materialId, versionId: source.versionId, ...(source.locator ? { locator: source.locator } : {}) };
    await host.openAddress(resolved.value.address, { ...nativeParamsFor(source.locator), studyforge: { source: context, version: resolved.value.version } });
    return 'opened';
  } catch {
    return 'unsupported';
  }
}
