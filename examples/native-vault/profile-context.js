import { profileOverview, profileRevisions } from './learning-data.js';
import { pluginEventType } from './plugin-events.js';
import { appendTeachingEvent } from './teaching-state.js';

const PROFILE_EVENT = 'notara/profile-context';
const codePoints = value => Array.from(value);

function changedNotice(paths) {
  const selected = [];
  let size = 0;
  for (const path of paths) {
    if (selected.length >= 20 || size + codePoints(path).length > 1200) break;
    selected.push(path); size += codePoints(path).length;
  }
  return { paths: selected, omitted: paths.length - selected.length };
}

/** The first snapshot belongs to this classroom and survives Host restarts.
 * These ignorable events are bookkeeping, never system-prompt sections. Forks
 * start their own snapshot; changes are appended through DSH's tail contexts. */
export async function learnerProfileContext({ session, workspaceId, scan, flush, signal }) {
  try { if(typeof scan==='function')scan=await scan(); }
  catch { signal?.throwIfAborted(); scan={documents:[],errors:[{code:'profile_scan_failed'}],truncated:true}; }
  const previous = session.snapshotEvents().findLast(event =>
    event.seq >= (session.inheritedEventCount ?? 0)
    && pluginEventType(event.type) === PROFILE_EVENT
    && event.data.workspaceId === workspaceId)?.data;
  const noticeDelivered = state => state?.notice && session.snapshotEvents().some(event =>
    event.seq >= (session.inheritedEventCount ?? 0) && event.type === 'user/message'
    && event.data.source?.kind === 'runtime-context' && event.data.content?.some(block =>
      block.type === 'text' && block.text.includes(JSON.stringify(`profile-change:${workspaceId}:${state.sequence}`))));
  // An incomplete scan cannot prove a profile disappeared or does not exist.
  const incomplete = scan.truncated || scan.errors?.length;
  let state = previous;
  if (!incomplete) {
    const revisions = profileRevisions(scan.documents);
    if (!previous) {
      state = { workspaceId, snapshot: profileOverview(scan.documents), revisions, sequence: 0, notice: null };
    } else {
      const changed = [...new Set([...Object.keys(previous.revisions), ...Object.keys(revisions)])]
        .filter(path => previous.revisions[path] !== revisions[path]).sort();
      if (changed.length) {
        const pending = previous.notice && !noticeDelivered(previous) ? previous.pendingPaths ?? previous.notice.paths : [];
        const pendingPaths = [...new Set([...pending,...changed])].sort();
        state = { ...previous, revisions, sequence: (previous.sequence ?? 0) + 1, pendingPaths, notice: changedNotice(pendingPaths) };
      }
    }
    if (state !== previous) {
      appendTeachingEvent(session, PROFILE_EVENT, state);
      await flush(session);
    }
  }
  const contexts = [];
  if (state) {
    contexts.push({ name: 'notara:profile-snapshot', text: '学生画像摘要（本课首次读取时的快照；观察与教学偏好各取末尾，省略部分及最新全文用 vault_read 读取）：\n' + JSON.stringify(state.snapshot) });
    const marker = `profile-change:${workspaceId}:${state.sequence}`;
    // A prepared context is not a delivered notice. Only an actual native
    // history commit consumes it, so a cancelled preparation can retry safely.
    const delivered = noticeDelivered(state);
    if (state.notice && !delivered) contexts.push({ name: 'notara:profile-changed', text: '学生画像在本课开始后有改动；开课快照保持原样，本课已有写入回执可作依据，其他改动需要时用 vault_read 核对。\n' + JSON.stringify({ notice: marker, ...state.notice, revisions: Object.fromEntries(state.notice.paths.map(path => [path, state.revisions[path] ?? null])) }) });
  }
  if (incomplete) contexts.push({ name: 'notara:profile-read-status', text: '画像扫描未完成，不能据此判定没有画像或画像已删除；已有开课快照仅作历史参考，需要时用 vault_read 核对具体文件。' });
  return contexts;
}
