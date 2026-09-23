import { createHash, randomUUID } from 'node:crypto';
import { createAgentVaultIO } from './agent-io.js';
import { serializeFrontmatter } from './frontmatter.js';
import { parseRoute, renderRoute } from './lesson-data.js';
import { reviewState, reviewHistory, reviewQueue, recordReviewContent, undoReviewContent, validateDay } from './review-data.js';
import { calendarProjection, calendarZone, civilDay, dailyDate } from './calendar-data.js';

const fail = code => { throw new Error(code); };

/** Scope and dates come from the real Host/editor. Each mutation is a single
 * version-checked Markdown write, shared by the UI and the approved Bash CLI. */
export function createReviewRuntime(service) {
  const ioFor = (args, exec, write = false) => exec
    ? createAgentVaultIO(service.ctx, exec, { writeApproved: write })
    : service.editorFor(args);
  const zoneFor = (args, exec) => calendarZone(exec ? undefined : args.timeZone);
  async function readTarget(io, args) {
    if (typeof args.path !== 'string' || typeof args.expectedRevision !== 'string') fail('vault_reference_invalid');
    return io.read(args.path, args.expectedRevision);
  }
  const receipt = doc => ({ path: doc.path, title: doc.title, revision: doc.revision, ref: doc.ref, saved: true });
  return {
    async calendar(args, exec) {
      const io = await ioFor(args, exec), scan = await io.scan(), timeZone = zoneFor(args, exec);
      return { ...calendarProjection(scan.documents, { from: args.from, to: args.to, timeZone, today: civilDay(new Date(), timeZone) }), truncated: scan.truncated, unreadable: scan.errors.length };
    },
    async queue(args, exec) {
      const io = await ioFor(args, exec), scan = await io.scan(), timeZone = zoneFor(args, exec);
      return { ...reviewQueue(scan.documents, { today: civilDay(new Date(), timeZone), query: args.query, tag: args.tag, status: args.status, offset: args.offset, limit: args.limit }), truncated: scan.truncated, unreadable: scan.errors.length };
    },
    async detail(args) {
      const io = await ioFor(args), doc = await io.read(args.path), history = reviewHistory(doc);
      return { path: doc.path, title: doc.title, revision: doc.revision, state: reviewState(doc), history: history.slice(-20), historyCount: history.length };
    },
    async record(args, exec) {
      const io = await ioFor(args, exec, true), doc = await readTarget(io, args);
      const at = new Date().toISOString(), day = civilDay(at, zoneFor(args, exec));
      const id = exec?.callId ? createHash('sha256').update(`${exec.agent.session.id}:${exec.callId}`).digest('hex').slice(0, 24) : randomUUID();
      if (Object.hasOwn(args, 'passed')) fail('review_request_invalid');
      const before = reviewState(doc);
      const content = recordReviewContent(doc, { id, at, day, assessments: args.assessments, note: args.note, actor: exec ? 'teacher' : 'self', sessionId: exec?.agent.session.id ?? null });
      const saved = await io.save(doc.path, content, doc.revision);
      const state = reviewState(saved);
      return { ...receipt(saved), state, scheduleChanged: JSON.stringify(state) !== JSON.stringify(before) };
    },
    async undo(args) {
      const io = await ioFor(args, null, true), doc = await readTarget(io, args);
      const saved = await io.save(doc.path, undoReviewContent(doc, { at: new Date().toISOString() }), doc.revision);
      return { ...receipt(saved), state: reviewState(saved) };
    },
    async dailyNote(args) {
      const date = validateDay(args.date), io = await ioFor(args, null, true), scan = await io.scan();
      // Existing root-level Obsidian daily notes are reused, never imported or overwritten.
      const existing = scan.documents.filter(doc => dailyDate(doc) === date);
      if (existing.length > 1) fail('calendar_daily_ambiguous');
      if (existing.length) return { ...receipt(existing[0]), saved: false };
      if (scan.truncated || scan.errors.length) fail('calendar_scan_incomplete');
      const path = `日记/${date}.md`;
      const content = serializeFrontmatter({ type: 'daily', date, tags: [] }) + `# ${date}\n\n## 今天的学习\n\n## 还想继续探索\n`;
      return receipt(await io.save(path, content, null));
    },
    async schedule(args, exec) {
      if (args.date !== null) validateDay(args.date);
      const io = await ioFor(args, exec, true), doc = await readTarget(io, args), route = parseRoute(doc);
      const node = route.nodes.find(item => item.id === args.nodeId);
      if (!node) fail('lesson_route_node_missing');
      if (args.date === null) delete node.scheduledOn;
      else node.scheduledOn = args.date;
      return receipt(await io.save(doc.path, renderRoute({ title: route.title, nodes: route.nodes }, doc.content), doc.revision));
    },
  };
}
