/**
 * Conversation file links point at the Vault assets bench, not at the native
 * sidebar document preview.
 *
 * The native chat opener sends every produced file to `sidebarRight.openResource`
 * (`@deepseek-ai/dsh-client-ui-chat` `fileAddressFor` -> the chat view's
 * `openFile`). That is right for a scratch file and wrong for a Vault asset: the
 * student clicked a card in the conversation, so the card belongs in the pane
 * that can read and edit it.
 *
 * An inline-code mention of a produced path (`code > button[title]`,
 * `@deepseek-ai/dsh-client-ui-deliverables` producedFileMentions) carries the
 * path in `title` exactly as the writing tool recorded it — which is what lets a
 * `vault/...` title mean "Vault asset" without guessing.
 * A presented-file card (`[data-presented-file]`, absolute title) means "open in
 * the default application"; DSH 0.2.0's changed-files card ("View changes to …")
 * opens a diff review; external links, composer reference chips and every
 * non-Vault path keep their native routing.
 */

/** Produced files written inside the Vault carry this prefix on their path. */
export const VAULT_FILE_PREFIX = 'vault/';

/** Browser element lookup that tolerates a non-element event target. */
function closest(node, selector) {
  return typeof node?.closest === 'function' ? node.closest(selector) : null;
}

/**
 * Vault-relative asset reference behind a conversation file link, or null when
 * the click belongs to the native opener.
 * Absolute paths, `..` segments, an empty path and everything outside `vault/`
 * are left alone, so the default-application action and workspace files cannot
 * be hijacked by a title alone.
 */
export function vaultConversationAssetPath(title) {
  if (typeof title !== 'string' || !title.startsWith(VAULT_FILE_PREFIX)) return null;
  const reference = title.slice(VAULT_FILE_PREFIX.length);
  // The assets bench parses `#page=`/`#rect=` itself, so only the path part is
  // validated here and the fragment travels with the reference untouched.
  const path = reference.split('#')[0];
  if (!path || path.startsWith('/') || path.startsWith('\\')) return null;
  if (path.includes('\\') || /^[A-Za-z]:/.test(path)) return null;
  if (path.split('/').some(part => part === '' || part === '.' || part === '..')) return null;
  return reference;
}

/**
 * Vault asset behind one conversation click, or null when the click is not a
 * produced Vault file mention.
 */
export function conversationVaultTarget(target) {
  const button = closest(target, 'button[title]');
  if (!button) return null;
  const asset = vaultConversationAssetPath(button.getAttribute?.('title') ?? button.title ?? null);
  if (!asset) return null;
  if (closest(button, '[data-presented-file]')) return null;
  if (!closest(button, 'code')) return null;
  return asset;
}

/**
 * Read conversation file links inside one pane before the native opener.
 * @param container - the conversation pane content element.
 * @param open - receives the Vault-relative asset reference; it must route
 * through the workspace's own `openView`, so the assets bench keeps its
 * unsaved-changes guard and the conversation pane keeps its draft.
 * @returns a detach function for React's ref cleanup.
 */
export function attachConversationFileNavigation(container, { open } = {}) {
  if (!container?.addEventListener) return () => {};
  const onClick = event => {
    const asset = conversationVaultTarget(event.target);
    if (!asset) return;
    event.preventDefault();
    event.stopPropagation();
    open?.(asset);
  };
  container.addEventListener('click', onClick, true);
  return () => container.removeEventListener('click', onClick, true);
}
