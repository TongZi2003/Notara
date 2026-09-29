/** The native welcome notice shipped with the locked DSH release. */
export const WELCOME_NOTICE_VERSION = '2026-09-28.1';

/**
 * Vault releases before 0.21.0 seeded `home/settings.yaml`. DSH 0.2.0 imports
 * that file once into the active profile, which sits above the Vault's own
 * patch layer, so two old seeds would override what the Vault sets now:
 * `ui-chat.transcriptView: normal` (0.2.0 reads it as `detailed`, which folds
 * finished turns; the Vault keeps them unfolded with `verbose`) and an older
 * `ui-onboarding.welcomeNoticeVersion`. `vault:upgrade` rewrites those two
 * values before the first 0.2.0 boot; every other line stays byte for byte.
 */
export function upgradeLegacySettings(text: string): string {
  let section = '';
  return text.split('\n').map(line => {
    const body = line.endsWith('\r') ? line.slice(0, -1) : line, eol = line.endsWith('\r') ? '\r' : '';
    const top = /^([A-Za-z0-9_-]+):\s*$/.exec(body);
    if (top) { section = top[1]!; return line; }
    if (/^\S/.test(body)) section = '';
    const field = /^(\s+)([A-Za-z]+):\s*(['"]?)([^'"\s]*)\3\s*$/.exec(body);
    if (!field) return line;
    const [, indent, key, , value] = field;
    if (section === 'ui-chat' && key === 'transcriptView' && value === 'normal') return `${indent}transcriptView: verbose${eol}`;
    if (section === 'ui-onboarding' && key === 'welcomeNoticeVersion' && value! < WELCOME_NOTICE_VERSION) return `${indent}welcomeNoticeVersion: ${WELCOME_NOTICE_VERSION}${eol}`;
    return line;
  }).join('\n');
}
