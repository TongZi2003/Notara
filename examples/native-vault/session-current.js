/**
 * The session shown in the main conversation.
 *
 * DSH 0.2.0 removed `SessionListState.current`: a session can now be retained
 * by several views at once, and the main view marks its own with
 * `retainedBy.mainView`. Pure, so every client module can share it.
 */
export function currentSessionId(snapshot) {
  const rows = snapshot?.byId ? Object.values(snapshot.byId) : [];
  return rows.find(row => (row?.retainedBy?.mainView ?? 0) > 0)?.id;
}

/**
 * Once both lists are ready DSH 0.2.0 always restores a main selection (the
 * saved session, a reused blank one, or the most recent workspace's). Until it
 * holds one, the current lesson and its directory are not known yet.
 */
export function mainViewSettled(snapshot) {
  return snapshot?.phase === 'ready' && currentSessionId(snapshot) !== undefined;
}
