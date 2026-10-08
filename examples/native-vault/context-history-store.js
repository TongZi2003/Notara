// Private history SQLite ownership belongs to this worker module only.
import { isMainThread } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { STREAM_BUDGET, SEARCH_BUDGET, scopeInput, sessionInput, createHistoryPrefixHasher, validateRpc, rpcBytes,
  serializeSearchMetadata, validateSearchProjection } from './context-history-client.js';
import { HISTORY_RETRIEVAL_TOOL_NAMES, NATIVE_HISTORY_SEARCH_POLICY } from './context-history-search-policy.js';
import { createHistoryLiteralMatcher } from './context-history-evidence.js';
import { clearDocFeatures, docCacheInfo, docFeatures, searchBlocks, setDocCacheCap } from './billion-kernel/index.js';
if(isMainThread) throw new Error('context history store requires a worker');
const { DatabaseSync } = await import('node:sqlite');
const sha=text=>createHash('sha256').update(text).digest('hex');
const yieldTurn=()=>new Promise(resolve=>setImmediate(resolve));
const fail=code=>{throw Object.assign(new Error(code),{code})};
const hash=sha,scopeKey=sha;
const termKey=(kind,text)=>`${kind}:${sha(text.toLowerCase())}`;
const BUDGET=SEARCH_BUDGET;setDocCacheCap(128*1024);
const tablesV1 = {
  source: ['scope', 'nextSeq'], events: ['scope', 'seq', 'type', 'role', 'encoding', 'hash', 'chars', 'bytes', 'state', 'chunkCount'],
  omissions: ['scope', 'seq', 'reason'],
  chunks: ['id', 'scope', 'seq', 'part', 'start', 'end', 'body'], postings: ['scope', 'term', 'chunkId', 'seq'],
  termStats: ['scope', 'term', 'df'], scopeMeta: ['scope', 'generation', 'state'],
  streams: ['scope', 'seq', 'generation', 'offset', 'receivedBytes', 'parts', 'indexedParts', 'state'],
  sessionBindings: ['sessionId', 'bindingHash', 'scope', 'state'], scopeOwners: ['scope', 'sessionId'],
};
const tables = { ...tablesV1, events: [...tablesV1.events, 'search'], chunks: [...tablesV1.chunks, 'search'],
  toolCalls: ['scope', 'turn', 'step', 'callId', 'name', 'seq'] };
// Only this exact previously shipped development shape is eligible for the
// additive v1 -> v2 migration. Matching column names alone is insufficient.
const v1Definitions = {
  source: 'CREATE TABLE source(scope TEXT PRIMARY KEY,nextSeq INTEGER NOT NULL)',
  events: `CREATE TABLE events(scope TEXT NOT NULL,seq INTEGER NOT NULL,type TEXT NOT NULL,role TEXT NOT NULL,
    encoding TEXT NOT NULL,hash TEXT NOT NULL,chars INTEGER NOT NULL,bytes INTEGER NOT NULL,state TEXT NOT NULL,chunkCount INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope,seq))`,
  omissions: 'CREATE TABLE omissions(scope TEXT NOT NULL,seq INTEGER NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(scope,seq))',
  chunks: `CREATE TABLE chunks(id INTEGER PRIMARY KEY,scope TEXT NOT NULL,seq INTEGER NOT NULL,part INTEGER NOT NULL,
    start INTEGER NOT NULL,end INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(scope,seq,part))`,
  postings: 'CREATE TABLE postings(scope TEXT NOT NULL,term TEXT NOT NULL,chunkId INTEGER NOT NULL,seq INTEGER NOT NULL,PRIMARY KEY(scope,term,chunkId)) WITHOUT ROWID',
  termStats: 'CREATE TABLE termStats(scope TEXT NOT NULL,term TEXT NOT NULL,df INTEGER NOT NULL,PRIMARY KEY(scope,term)) WITHOUT ROWID',
  scopeMeta: 'CREATE TABLE scopeMeta(scope TEXT PRIMARY KEY,generation INTEGER NOT NULL,state TEXT NOT NULL)',
  sessionBindings: 'CREATE TABLE sessionBindings(sessionId TEXT PRIMARY KEY,bindingHash TEXT,scope TEXT,state TEXT NOT NULL)',
  scopeOwners: 'CREATE TABLE scopeOwners(scope TEXT PRIMARY KEY,sessionId TEXT NOT NULL)',
  streams: `CREATE TABLE streams(scope TEXT NOT NULL,seq INTEGER NOT NULL,generation INTEGER NOT NULL,offset INTEGER NOT NULL,
    receivedBytes INTEGER NOT NULL,parts INTEGER NOT NULL,indexedParts INTEGER NOT NULL,state TEXT NOT NULL,PRIMARY KEY(scope,seq))`,
};
const v1Indexes = { chunks_page: 'CREATE INDEX chunks_page ON chunks(scope,seq,part)', chunks_scope_id: 'CREATE INDEX chunks_scope_id ON chunks(scope,id)',
  postings_chunk: 'CREATE INDEX postings_chunk ON postings(scope,chunkId)', owners_session: 'CREATE INDEX owners_session ON scopeOwners(sessionId,scope)',
  scopes_state: 'CREATE INDEX scopes_state ON scopeMeta(state,scope)' };
const callsDefinition = `CREATE TABLE toolCalls(scope TEXT NOT NULL,turn INTEGER NOT NULL,step INTEGER NOT NULL,callId TEXT NOT NULL,name TEXT NOT NULL,seq INTEGER NOT NULL,
  PRIMARY KEY(scope,turn,step,callId)) WITHOUT ROWID`;
const v2Definitions = { ...v1Definitions, events: v1Definitions.events.replace(',PRIMARY KEY', ',search TEXT,PRIMARY KEY'),
  chunks: v1Definitions.chunks.replace(',UNIQUE', ',search TEXT,UNIQUE'), toolCalls: callsDefinition };
const v2Indexes = { ...v1Indexes, calls_event: 'CREATE INDEX calls_event ON toolCalls(scope,seq)' };
const normalizedSql = sql => sql?.replace(/\s+/g, '').toLowerCase();
const projectedBody = row => row.search == null ? row.body : row.search === '' ? ' '.repeat(row.end - row.start) : row.search;
const storedProjection = (body, search) => search === undefined || search === body ? null : /^ *$/.test(search) ? '' : search;
function identifiers(text) {
  return [...text.matchAll(/[a-z][a-z0-9_:-]*/gi)].map(m => m[0])
    .filter(word => word.length >= 64 || (word.length >= 8 && /[_:0-9-]/.test(word)));
}
function numericTerms(text) {
  // A fixed vocabulary (10 digits + 100 pairs) also recalls substrings of long
  // numbers. These are candidate anchors, never proof of a complete literal.
  const terms = new Set();
  for (let index = 0; index < text.length; index++) {
    const digit = text.charCodeAt(index);
    if (digit < 48 || digit > 57) continue;
    terms.add(text[index]);
    const next = text.charCodeAt(index + 1);
    if (next >= 48 && next <= 57) terms.add(text.slice(index, index + 2));
  }
  return [...terms].map(value => termKey('n', value));
}
export function indexTerms(text) {
  return [...new Set([
    ...[...docFeatures(text).tf.keys()].map(word => termKey('w', word)),
    ...[...text.matchAll(/\p{Script=Han}/gu)].map(m => termKey('h', m[0])),
    ...identifiers(text).map(word => termKey('e', word)),
    ...numericTerms(text),
  ])];
}
function safeEnd(text, end) {
  if (end < text.length && end > 0 && text.charCodeAt(end - 1) >= 0xd800
      && text.charCodeAt(end - 1) <= 0xdbff) return end - 1;
  return end;
}
function safeStart(text, start) {
  if (start > 0 && text.charCodeAt(start) >= 0xdc00 && text.charCodeAt(start) <= 0xdfff) return start - 1;
  return start;
}
function literalMatch(text, query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'iu').exec(text); // Returns offsets in the original, without expanding Unicode lowercase.
}
function evidencePreview(text, match) {
  const size = Math.max(120, match[0].length);
  let start = safeStart(text, Math.max(0, match.index - Math.floor((size - match[0].length) / 2)));
  const end = safeEnd(text, Math.min(text.length, start + size));
  return text.slice(start, end);
}

const reusedSearch={
window(scope, row, includeOriginal = false) {
    const neighbors = this.sql.neighbors.all(scope, row.seq, row.part - 1, row.part + 1);
    const previousRow = neighbors.find(n => n.part === row.part - 1), nextRow = neighbors.find(n => n.part === row.part + 1);
    const previous = previousRow ? projectedBody(previousRow) : '', next = nextRow ? projectedBody(nextRow) : '';
    const prefix = previous.slice(safeStart(previous, Math.max(0, previous.length - BUDGET.overlapChars)));
    const suffix = next.slice(0, safeEnd(next, Math.min(next.length, BUDGET.overlapChars)));
    const window = { text: prefix + projectedBody(row) + suffix, start: row.start - prefix.length, end: row.end + suffix.length };
    // Original text is needed only for selected search candidates. Indexing
    // never allocates a second full window merely to compute lexical features.
    if (includeOriginal) window.original = (previousRow?.body.slice(previous.length - prefix.length) ?? '')
      + row.body + (nextRow?.body.slice(0, suffix.length) ?? '');
    return window;
  },
page(scope, seq, afterPart = -1) {
    const event = this.metadata(scope, seq);
    if (event.state === 'omitted') fail('EVENT_OMITTED');
    if (event.state !== 'complete') fail('INCOMPLETE_EVENT');
    if (!Number.isSafeInteger(afterPart) || afterPart < -1 || afterPart >= Math.max(event.chunkCount, 1)) fail('INVALID_PAGE_CURSOR');
    const rows = this.sql.page.all(scope, seq, afterPart, BUDGET.pageChunks);
    const expected = Math.min(BUDGET.pageChunks, Math.max(0, event.chunkCount - afterPart - 1));
    if (rows.length !== expected || rows.some((r, i) => r.part !== afterPart + 1 + i)) fail('MISSING_CHUNK_REFERENCE');
    return { event, rows, done: afterPart + rows.length + 1 >= event.chunkCount };
  },
search(scope, query) {
    if (typeof query !== 'string' || !query.trim() || query.length > BUDGET.queryChars || !query.isWellFormed()) fail('INVALID_QUERY');
    const queryTerms = indexTerms(query), wordTerms = queryTerms.filter(term => !term.startsWith('n:'));
    // Numeric grams fill the previously empty numeric-only prefilter. Mixed
    // text keeps its existing lexical/identifier anchors, avoiding candidates
    // merely because unrelated identifiers share some decimal digits.
    const tokens = wordTerms.length ? wordTerms : queryTerms;
    const numericLiteralOnly = tokens.length > 0 && wordTerms.length === 0;
    if (tokens.length > BUDGET.queryTerms) fail('QUERY_TERM_BUDGET');
    const ranked = tokens.map(term => ({ term, df: this.sql.df.get(scope, term)?.df ?? 0 }))
      .filter(t => t.df > 0).sort((a, b) => a.df - b.df || a.term.localeCompare(b.term));
    const exact = ranked.filter(t => t.term.startsWith('e:')).slice(0, BUDGET.anchors / 2);
    const lexical = ranked.filter(t => !t.term.startsWith('e:')).slice(0, BUDGET.anchors - exact.length);
    let fetched = 0;
    const fetch = anchors => anchors.map(anchor => {
      const rows = this.sql.candidates.all(scope, anchor.term, ...HISTORY_RETRIEVAL_TOOL_NAMES, BUDGET.postingsPerAnchor);
      fetched += rows.length; return { ...anchor, rows };
    });
    const groups = [fetch(exact), fetch(lexical)], selected = new Map(), perEvent = new Map();
    let eventChunkCapHit = false;
    const take = (anchors, quota) => {
      let added = 0;
      for (let pos = 0; pos < BUDGET.postingsPerAnchor && added < quota; pos++) {
        for (const anchor of anchors) {
          const item = anchor.rows[pos];
          if (!item || selected.has(item.chunkId)) continue;
          if ((perEvent.get(item.seq) ?? 0) >= BUDGET.chunksPerEvent) { eventChunkCapHit = true; continue; }
          if (selected.size >= BUDGET.candidates || added >= quota) return;
          selected.set(item.chunkId, item); perEvent.set(item.seq, (perEvent.get(item.seq) ?? 0) + 1); added++;
        }
      }
    };
    take(groups[0], BUDGET.exactQuota); take(groups[1], BUDGET.lexicalQuota);
    take(groups.flat(), BUDGET.candidates - selected.size);
    const docs = [], windows = new Map(); let skippedPending = 0;
    for (const item of selected.values()) {
      const event = this.metadata(scope, item.seq);
      if (event.state !== 'complete') { skippedPending++; continue; }
      if (this.excludedResult(scope, event)) continue;
      const row = this.sql.chunk.get(item.chunkId, scope);
      if (!row) fail('MISSING_CHUNK_REFERENCE');
      const nativeEvidence = event.search?.policy === NATIVE_HISTORY_SEARCH_POLICY;
      const window = this.window(scope, row, nativeEvidence);
      const ref = `${scopeKey(scope)}:${row.seq}:${row.part}`;
      windows.set(ref, { seq: row.seq, part: row.part, chunkStart: row.start, chunkEnd: row.end, ...window, nativeEvidence });
      docs.push({ kind: 'message', ref, role: event.role, text: window.text, title: 'Original history', tokens: 0 });
    }
    const nativeLiteral = createHistoryLiteralMatcher(query);
    const literalIdentifiers = identifiers(query).map(text => ({ text: text.toLowerCase(),
      df: this.sql.df.get(scope, termKey('e', text))?.df ?? 0, nativeLiteral: createHistoryLiteralMatcher(text) }));
    const dedup = new Set();
    const results = searchBlocks(docs, query, { limit: BUDGET.candidates, previewLength: 120, minScore: 0 }).map(result => {
      const window = windows.get(result.ref);
      const matchedIdentifiers = literalIdentifiers.map(item => ({ ...item, match: item.df
        ? window.nativeEvidence ? item.nativeLiteral(window.text, window.original) : literalMatch(window.text, item.text) : null }))
        .filter(item => item.match).sort((a, b) => a.df - b.df);
      const fullMatch = window.nativeEvidence ? nativeLiteral(window.text, window.original) : literalMatch(window.text, query);
      const evidence = fullMatch ?? matchedIdentifiers[0]?.match;
      const hitStart = evidence ? window.start + evidence.index : null;
      // A candidate's overlap may find the source in an adjacent part. Anchor
      // reads at the part containing the actual first character of the hit.
      const part = hitStart === null ? window.part : hitStart < window.chunkStart ? window.part - 1
        : hitStart >= window.chunkEnd ? window.part + 1 : window.part;
      return { ...result, ref: `${scopeKey(scope)}:${window.seq}:${part}`, seq: window.seq, part, windowStart: window.start, windowEnd: window.end,
        preview: evidence ? evidencePreview(window.text, evidence) : result.preview,
        hitStart,
        hitEnd: evidence ? window.start + evidence.index + evidence[0].length : null,
        hitKind: fullMatch ? 'query-literal' : evidence ? 'identifier-literal' : null,
        exactIdentifierDf: matchedIdentifiers.length ? Math.min(...matchedIdentifiers.map(item => item.df)) : null };
    }).filter(result => numericLiteralOnly ? result.hitKind === 'query-literal'
      : result.score >= 0.01 || result.hitStart !== null || result.exactIdentifierDf !== null)
      .sort((a, b) => (a.exactIdentifierDf ?? Infinity) - (b.exactIdentifierDf ?? Infinity) || b.score - a.score)
      .filter(result => {
        if (result.hitStart === null) return true;
        const key = `${result.seq}:${result.hitStart}:${result.hitEnd}`;
        if (dedup.has(key)) return false; dedup.add(key); return true;
      }).slice(0, 10);
    return { results, diagnostics: { queryTerms: tokens.length, anchors: exact.length + lexical.length,
      omittedAnchors: Math.max(0, ranked.length - exact.length - lexical.length), postingsFetched: fetched,
      candidates: docs.length, skippedPending, eventChunkCapHit, budgetLimited: ranked.some(t => t.df > BUDGET.postingsPerAnchor)
        || ranked.length > exact.length + lexical.length || eventChunkCapHit || selected.size >= BUDGET.candidates,
      ranking: 'Billion hybrid with host priority for rarer literal identifiers',
      recall: 'bounded candidates; incomplete recall; no fuzzy or semantic prefilter' } };
  }
};

export class ContextHistoryStore {
  constructor(path) {
    const existed = existsSync(path);
    this.db = new DatabaseSync(path);
    try {
      // All checks precede journal/schema changes. Existing foreign databases are never adopted.
      const app = this.db.prepare('PRAGMA application_id').get().application_id;
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      const names = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(r => r.name);
      const fresh = !existed && app === 0 && version === 0 && names.length === 0;
      if (!fresh && (app !== 0x4e485331 || ![1,2].includes(version))) fail('WRONG_DATABASE_NAMESPACE');
      if (!fresh) {
        const expectedTables = version === 1 ? tablesV1 : tables;
        if (JSON.stringify(names) !== JSON.stringify(Object.keys(expectedTables).sort())) fail('WRONG_SCHEMA_SHAPE');
        for (const [table, columns] of Object.entries(expectedTables)) {
          if (JSON.stringify(this.db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name)) !== JSON.stringify(columns)) fail('WRONG_SCHEMA_SHAPE');
        }
        const expectedIndexes = { chunks_page: ['scope','seq','part'], chunks_scope_id: ['scope','id'], postings_chunk: ['scope','chunkId'], owners_session: ['sessionId','scope'], scopes_state: ['state','scope'],
          ...(version === 2 ? { calls_event: ['scope','seq'] } : {}) };
        const actualIndexes = this.db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL ORDER BY name").all().map(row => row.name);
        if (JSON.stringify(actualIndexes) !== JSON.stringify(Object.keys(expectedIndexes).sort())) fail('WRONG_SCHEMA_SHAPE');
        for (const [index, columns] of Object.entries(expectedIndexes)) {
          if (JSON.stringify(this.db.prepare(`PRAGMA index_info(${index})`).all().map(r => r.name)) !== JSON.stringify(columns)) fail('WRONG_SCHEMA_SHAPE');
        }
        for (const [name, definition] of Object.entries(version === 1 ? { ...v1Definitions, ...v1Indexes } : { ...v2Definitions, ...v2Indexes })) {
          if (normalizedSql(this.db.prepare('SELECT sql FROM sqlite_schema WHERE name=?').get(name)?.sql) !== normalizedSql(definition)) fail('WRONG_SCHEMA_SHAPE');
        }
      }
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192; PRAGMA busy_timeout=1000; PRAGMA secure_delete=ON;');
      if (fresh) this.db.exec(`BEGIN IMMEDIATE; PRAGMA application_id=1313362737; PRAGMA user_version=1;
        ${[...Object.values(v1Definitions), ...Object.values(v1Indexes)].join(';')}; COMMIT;`);
      if (fresh || version === 1) this.transaction(() => {
        this.db.exec(`ALTER TABLE events ADD COLUMN search TEXT;
          ALTER TABLE chunks ADD COLUMN search TEXT;
          ${callsDefinition};
          CREATE INDEX calls_event ON toolCalls(scope,seq); PRAGMA user_version=2;`);
      });
      this.sql = Object.fromEntries(Object.entries({
        scope: 'SELECT * FROM scopeMeta WHERE scope=?', cursor: 'SELECT nextSeq FROM source WHERE scope=?',
        binding: 'SELECT * FROM sessionBindings WHERE sessionId=?', owner: 'SELECT sessionId FROM scopeOwners WHERE scope=?',
        ownedDeletingScope: "SELECT m.scope,m.generation FROM scopeOwners o JOIN scopeMeta m ON m.scope=o.scope WHERE o.sessionId=? AND m.state='deleting' ORDER BY o.scope LIMIT 1",
        deletingScope: "SELECT scope,generation FROM scopeMeta WHERE state='deleting' ORDER BY scope LIMIT 1",
        retireScope: "UPDATE scopeMeta SET generation=generation+1,state='deleting' WHERE scope=? AND state='active'",
        event: 'SELECT * FROM events WHERE scope=? AND seq=?', stream: 'SELECT * FROM streams WHERE scope=? AND seq=?',
        insert: 'INSERT INTO chunks(scope,seq,part,start,end,body,search) VALUES(?,?,?,?,?,?,?)',
        call: 'SELECT name,seq FROM toolCalls WHERE scope=? AND turn=? AND step=? AND callId=?',
        insertCall: 'INSERT INTO toolCalls VALUES(?,?,?,?,?,?)',
        posting: 'INSERT INTO postings VALUES(?,?,?,?)', stat: 'INSERT INTO termStats VALUES(?,?,1) ON CONFLICT(scope,term) DO UPDATE SET df=df+1',
        df: 'SELECT df FROM termStats WHERE scope=? AND term=?',
        candidates: `SELECT p.chunkId,p.seq FROM postings p JOIN events e ON e.scope=p.scope AND e.seq=p.seq WHERE p.scope=? AND p.term=?
          AND NOT EXISTS(SELECT 1 FROM toolCalls c WHERE c.scope=p.scope AND c.turn=json_extract(e.search,'$.result.turn')
            AND c.step=json_extract(e.search,'$.result.step') AND c.callId=json_extract(e.search,'$.result.callId') AND c.seq<e.seq AND c.name IN (?,?))
          ORDER BY p.chunkId LIMIT ?`,
        chunk: 'SELECT * FROM chunks WHERE id=? AND scope=?',
        neighbors: 'SELECT part,start,end,body,search FROM chunks WHERE scope=? AND seq=? AND part BETWEEN ? AND ? ORDER BY part',
        page: 'SELECT part,start,end,body FROM chunks WHERE scope=? AND seq=? AND part>? ORDER BY part LIMIT ?',
        verifyPage: 'SELECT part,start,end,body,search FROM chunks WHERE scope=? AND seq=? AND part>? ORDER BY part LIMIT ?',
        updateStream: 'UPDATE streams SET offset=?,receivedBytes=?,parts=?,indexedParts=? WHERE scope=? AND seq=?',
        indexPage: 'SELECT * FROM chunks WHERE scope=? AND seq=? AND part=?',
        chunkTerms: 'SELECT term FROM postings WHERE scope=? AND chunkId=?',
        deletePostings: 'DELETE FROM postings INDEXED BY postings_chunk WHERE scope=? AND chunkId=?',
        decreaseDf: 'UPDATE termStats SET df=df-1 WHERE scope=? AND term=?',
        zeroDf: 'DELETE FROM termStats WHERE scope=? AND term=? AND df=0', deleteChunk: 'DELETE FROM chunks WHERE id=? AND scope=?',
        resumeStream: "UPDATE streams SET state='pending' WHERE scope=? AND seq=? AND generation=?",
        insertEvent: "INSERT INTO events(scope,seq,type,role,encoding,hash,chars,bytes,search,state) VALUES(?,?,?,?,?,?,?,?,?,'pending')",
        insertOmitted: "INSERT INTO events(scope,seq,type,role,encoding,hash,chars,bytes,state) VALUES(?,?,?,'user','plain-text','',0,0,'omitted')",
        insertOmission: 'INSERT INTO omissions VALUES(?,?,?)',
        omission: 'SELECT reason FROM omissions WHERE scope=? AND seq=?',
        prefixPage: 'SELECT e.seq,e.type,e.role,e.encoding,e.hash,e.chars,e.bytes,e.state,e.search,o.reason AS omissionReason FROM events e LEFT JOIN omissions o ON o.scope=e.scope AND o.seq=e.seq WHERE e.scope=? AND e.seq>=? AND e.seq<? ORDER BY e.seq LIMIT 256',
        insertStream: "INSERT INTO streams VALUES(?,?,?,0,0,0,0,'pending')",
        finishEvent: "UPDATE events SET state='complete',chunkCount=? WHERE scope=? AND seq=?",
        finishStream: "UPDATE streams SET state='complete',indexedParts=parts WHERE scope=? AND seq=?",
        updateCursor: 'UPDATE source SET nextSeq=? WHERE scope=?',
        cancelStream: "UPDATE streams SET state='cancelled' WHERE scope=? AND seq=? AND state='pending'",
        deleteEventsPage: 'SELECT seq FROM events WHERE scope=? ORDER BY seq LIMIT 250',
      }).map(([name, sql]) => [name, this.db.prepare(sql)]));
    } catch (error) { this.db.close(); throw error; }
  }
  transaction(work) { this.db.exec('BEGIN IMMEDIATE'); try { const value = work(); this.db.exec('COMMIT'); return value; }
    catch (error) { try { this.db.exec('ROLLBACK'); } catch {} throw error; } }
  generation(scope, generation) {
    scopeInput(scope); const state = this.sql.scope.get(scope);
    if (!state || state.state !== 'active') fail('SCOPE_UNAVAILABLE');
    if (state.generation !== generation) fail('STALE_SCOPE_GENERATION'); return state;
  }
  openScope(scope) {
    scopeInput(scope);
    return this.transaction(() => {
      const state = this.sql.scope.get(scope);
      if (!state) { this.db.prepare("INSERT INTO scopeMeta VALUES(?,1,'active')").run(scope); this.db.prepare('INSERT INTO source VALUES(?,0)').run(scope); }
      else if (state.state === 'deleting') fail('SCOPE_DELETION_PENDING');
      else if (state.state === 'deleted') {
        if (this.sql.owner.get(scope)) fail('SCOPE_UNAVAILABLE');
        this.db.prepare("UPDATE scopeMeta SET state='active' WHERE scope=?").run(scope); this.db.prepare('INSERT INTO source VALUES(?,0)').run(scope);
      }
      return this.sql.scope.get(scope);
    });
  }
  async bindSession(sessionId, bindingHash, context) {
    sessionInput(sessionId); context.check();
    if (typeof bindingHash !== 'string' || !/^[0-9a-f]{64}$/.test(bindingHash)) fail('INVALID_SESSION_BINDING');
    const result = this.transaction(() => {
      context.check(); const binding = this.sql.binding.get(sessionId);
      if (binding?.state === 'deleted') fail('SESSION_DELETED');
      const previous = binding?.scope ? this.sql.scope.get(binding.scope) : null;
      if (binding?.bindingHash === bindingHash && previous?.state === 'active') return previous;
      if (previous?.state === 'active') this.sql.retireScope.run(previous.scope);
      const scope = `native-session:${randomUUID()}`;
      this.db.prepare("INSERT INTO scopeMeta VALUES(?,1,'active')").run(scope);
      this.db.prepare('INSERT INTO source VALUES(?,0)').run(scope);
      this.db.prepare('INSERT INTO scopeOwners VALUES(?,?)').run(scope, sessionId);
      this.db.prepare("INSERT INTO sessionBindings VALUES(?,?,?,'active') ON CONFLICT(sessionId) DO UPDATE SET bindingHash=excluded.bindingHash,scope=excluded.scope,state='active'").run(sessionId, bindingHash, scope);
      return this.sql.scope.get(scope);
    });
    // A retry also resumes a retirement committed by an earlier cancelled call.
    await this.purgeSession(sessionId, context);
    context.check(); return result;
  }
  async deleteSessionIds(sessionIds, context) {
    if (!Array.isArray(sessionIds) || !sessionIds.length || sessionIds.length > 256) fail('INVALID_SESSION_BATCH');
    sessionIds.forEach(sessionInput); const ids = [...new Set(sessionIds)]; context.check();
    this.transaction(() => {
      context.check();
      for (const sessionId of ids) {
        // Unknown IDs are also tombstoned: a delayed bind cannot undo native deletion.
        this.db.prepare("INSERT INTO sessionBindings VALUES(?,NULL,NULL,'deleted') ON CONFLICT(sessionId) DO UPDATE SET bindingHash=NULL,scope=NULL,state='deleted'").run(sessionId);
        this.db.prepare("UPDATE scopeMeta SET generation=generation+1,state='deleting' WHERE state='active' AND scope IN (SELECT scope FROM scopeOwners WHERE sessionId=?)").run(sessionId);
      }
    });
    for (const sessionId of ids) await this.purgeSession(sessionId, context);
    context.check(); return { state: 'deleted', deletedSessionCount: ids.length };
  }
  async purgeSession(sessionId, context) {
    for (;;) {
      context.check(); const scope = this.sql.ownedDeletingScope.get(sessionId); if (!scope) return;
      await this.purgeScope(scope.scope, scope.generation, context);
    }
  }
  async resumeDeletions(context) {
    for (;;) {
      const scope = this.sql.deletingScope.get(); if (!scope) return;
      await this.purgeScope(scope.scope, scope.generation, context);
    }
  }
  receipt(scope, seq) {
    const stream = this.sql.stream.get(scope, seq), event = this.sql.event.get(scope, seq);
    return { generation: stream.generation, seq, offset: stream.offset, receivedBytes: stream.receivedBytes,
      parts: stream.parts, indexedParts: stream.indexedParts, state: stream.state,
      expectedHash: event.hash, nextSeq: this.sql.cursor.get(scope).nextSeq };
  }
  beginEvent(scope, generation, meta, context) {
    validateRpc('beginEvent', [scope, generation, meta]);
    context.check(); this.generation(scope, generation);
    if (!meta || !Number.isSafeInteger(meta.seq) || meta.seq < 0 || !Number.isSafeInteger(meta.chars) || meta.chars < 0
        || !Number.isSafeInteger(meta.bytes) || meta.bytes < 0 || typeof meta.hash !== 'string' || !/^[0-9a-f]{64}$/.test(meta.hash)
        || !['user', 'assistant', 'tool','developer','system'].includes(meta.role ?? 'user') || typeof (meta.type ?? 'message') !== 'string'
        || (meta.type ?? 'message').length > 64) fail('INVALID_EVENT_METADATA');
    return this.transaction(() => {
      context.check(); this.generation(scope, generation);
      if (this.sql.cursor.get(scope).nextSeq !== meta.seq) fail('MISSING_OR_REORDERED_SEQUENCE');
      const previous = this.sql.event.get(scope, meta.seq);
      if (previous) {
        if (previous.state !== 'pending' || previous.hash !== meta.hash || previous.chars !== meta.chars
            || previous.bytes !== meta.bytes || previous.role !== (meta.role ?? 'user') || previous.type !== (meta.type ?? 'message')
            || previous.encoding !== (meta.encoding ?? 'plain-text') || previous.search !== serializeSearchMetadata(meta.search)) fail('RESUME_SOURCE_MISMATCH');
        this.sql.resumeStream.run(scope, meta.seq, generation);
      } else {
        this.sql.insertEvent
          .run(scope, meta.seq, meta.type ?? 'message', meta.role ?? 'user', meta.encoding ?? 'plain-text', meta.hash, meta.chars, meta.bytes, serializeSearchMetadata(meta.search));
        this.sql.insertStream.run(scope, meta.seq, generation);
      }
      return this.receipt(scope, meta.seq);
    });
  }
  metadata(scope, seq) {
    const event = this.sql.event.get(scope, seq); if (!event) fail('MISSING_EVENT_REFERENCE');
    return { ...event, search: event.search === null ? null : JSON.parse(event.search) };
  }
  excludedResult(scope, event) {
    const result = event.search?.result; if (!result) return false;
    const call = this.sql.call.get(scope, result.turn, result.step, result.callId);
    return !!call && call.seq < event.seq && HISTORY_RETRIEVAL_TOOL_NAMES.includes(call.name);
  }
  registerCall(scope, event) {
    const call = event.search?.call; if (!call) return;
    const previous = this.sql.call.get(scope, call.turn, call.step, call.callId);
    if (previous) {
      if (previous.seq !== event.seq || previous.name !== call.name) fail('CONFLICTING_SEARCH_CALL_IDENTITY');
      return;
    }
    this.sql.insertCall.run(scope, call.turn, call.step, call.callId, call.name, event.seq);
  }
  window(scope, row, includeOriginal = false) { return reusedSearch.window.call(this, scope, row, includeOriginal); }
  indexPart(scope, seq, part) {
    const row = this.sql.indexPage.get(scope, seq, part); if (!row) fail('MISSING_CHUNK_REFERENCE');
    if (this.excludedResult(scope, this.metadata(scope, seq)) || !projectedBody(row).trim()) return;
    for (const term of indexTerms(this.window(scope, row).text)) { this.sql.posting.run(scope, term, row.id, seq); this.sql.stat.run(scope, term); }
  }
  async appendChunks(scope, generation, seq, offset, bodies, context) {
    validateRpc('appendChunks', [scope, generation, seq, offset, bodies]);
    context.check(); this.generation(scope, generation);
    const receipt = this.transaction(() => {
      context.check(); this.generation(scope, generation);
      const stream = this.sql.stream.get(scope, seq), event = this.metadata(scope, seq);
      if (!stream || stream.state !== 'pending' || event.state !== 'pending') fail('EVENT_NOT_PENDING');
      if (stream.generation !== generation || offset !== stream.offset) fail('OFFSET_MISMATCH');
      let position = stream.offset, receivedBytes = stream.receivedBytes, parts = stream.parts, indexed = stream.indexedParts;
      for (const chunk of bodies) {
        const body = typeof chunk === 'string' ? chunk : chunk.body, search = typeof chunk === 'string' ? undefined : chunk.search;
        if ((search !== undefined) !== (event.search !== null)) fail('SEARCH_PROJECTION_REQUIRED');
        const projection = search !== undefined ? validateSearchProjection(body, search) : undefined;
        const end = position + body.length; receivedBytes += Buffer.byteLength(body);
        if (end > event.chars || receivedBytes > event.bytes) fail('EVENT_LENGTH_OVERFLOW');
        this.sql.insert.run(scope, seq, parts, position, end, body, storedProjection(body, projection));
        // Index only when the next original neighbor exists. Final pending part is indexed at finish.
        if (parts > 0) { if (indexed !== parts - 1) fail('INDEX_CURSOR_MISMATCH'); this.indexPart(scope, seq, parts - 1); indexed++; }
        position = end; parts++;
      }
      this.sql.updateStream.run(position, receivedBytes, parts, indexed, scope, seq); context.check();
      return this.receipt(scope, seq);
    });
    await yieldTurn(); context.check(); return receipt;
  }
  async finishEvent(scope, generation, seq, expectedParts, context) {
    context.check(); this.generation(scope, generation);
    const stream = this.sql.stream.get(scope, seq), event = this.metadata(scope, seq);
    if (!stream || stream.state !== 'pending' || event.state !== 'pending') fail('EVENT_NOT_PENDING');
    if (stream.offset !== event.chars || stream.receivedBytes !== event.bytes || stream.parts !== expectedParts) fail('EVENT_INCOMPLETE');
    const digest = createHash('sha256'), searchDigest = event.search ? createHash('sha256') : null;
    let part = 0, offset = 0, bytes = 0;
    for (;;) {
      context.check(); this.generation(scope, generation);
      const rows = this.sql.verifyPage.all(scope, seq, part - 1, STREAM_BUDGET.pageChunks); if (!rows.length) break;
      for (const row of rows) {
        if (row.part !== part || row.start !== offset || row.end !== offset + row.body.length) fail('BROKEN_CHUNK_CHAIN');
        digest.update(row.body); bytes += Buffer.byteLength(row.body); offset = row.end; part++;
        if (searchDigest) {
          const search = projectedBody(row); validateSearchProjection(row.body, search); searchDigest.update(search);
        } else if (row.search !== null) fail('SEARCH_PROJECTION_REQUIRED');
      }
      await yieldTurn();
    }
    if (part !== expectedParts || offset !== event.chars || bytes !== event.bytes || digest.digest('hex') !== event.hash) fail('PERSISTED_HASH_MISMATCH');
    if (searchDigest && searchDigest.digest('hex') !== event.search.hash) fail('PERSISTED_SEARCH_HASH_MISMATCH');
    return this.transaction(() => {
      context.check(); this.generation(scope, generation);
      if (stream.parts && stream.indexedParts !== stream.parts - 1) fail('INDEX_CURSOR_MISMATCH');
      this.registerCall(scope, event);
      if (stream.parts) this.indexPart(scope, seq, stream.parts - 1);
      context.check();
      if (this.sql.cursor.get(scope).nextSeq !== seq) fail('WATERMARK_CHANGED');
      this.sql.finishEvent.run(part, scope, seq);
      this.sql.finishStream.run(scope, seq);
      this.sql.updateCursor.run(seq + 1, scope);
      return this.receipt(scope, seq);
    });
  }
  cancelEvent(scope, generation, seq) {
    this.generation(scope, generation);
    this.metadata(scope, seq);
    if (!this.sql.stream.get(scope, seq)) fail('EVENT_OMITTED');
    this.sql.cancelStream.run(scope, seq);
    return this.receipt(scope, seq);
  }
  search(scope, generation, query) { this.generation(scope, generation); const result = reusedSearch.search.call(this, scope, query);
    result.results = result.results.map(r => ({ ...r, ref: `${generation}:${r.ref}`, generation })); return result; }
  page(scope, generation, seq, after = -1) { this.generation(scope, generation); return reusedSearch.page.call(this, scope, seq, after); }
  inspect(scope) { scopeInput(scope); const state = this.sql.scope.get(scope); return { ...state, nextSeq: this.sql.cursor.get(scope)?.nextSeq ?? null,
    cache: docCacheInfo(), memory: process.memoryUsage() }; }
  inspectEvent(scope, generation, seq) {
    this.generation(scope, generation); const event = this.metadata(scope, seq);
    return { event: { ...event, omissionReason: this.sql.omission.get(scope, seq)?.reason ?? null },
      receipt: this.sql.stream.get(scope, seq) ? this.receipt(scope, seq) : null };
  }
  skipEvents(scope, generation, fromSeq, events, context) {
    context.check(); this.generation(scope, generation);
    return this.transaction(() => {
      if (this.sql.cursor.get(scope).nextSeq !== fromSeq) fail('MISSING_OR_REORDERED_SEQUENCE');
      // A pending event may only be resumed or deleted; omissions never overwrite captured content.
      if (this.sql.event.get(scope, fromSeq)) fail('PENDING_EVENT_CONFLICT');
      for (const event of events) { this.sql.insertOmitted.run(scope, event.seq, event.type); this.sql.insertOmission.run(scope, event.seq, event.reason); }
      context.check(); this.sql.updateCursor.run(fromSeq + events.length, scope);
      return { generation, nextSeq: fromSeq + events.length };
    });
  }
  async appendEventBatch(scope, generation, fromSeq, items, context) {
    // Validate bodies before measuring JSON: malformed objects/BigInts never
    // reach serialization or SQL. The RPC envelope includes JSON escaping.
    validateRpc('appendEventBatch', [scope, generation, fromSeq, items]);
    if (rpcBytes('appendEventBatch', [scope, generation, fromSeq, items]) > STREAM_BUDGET.rpcBytes) fail('RPC_BYTE_BUDGET');
    context.check(); this.generation(scope, generation);
    const receipt = this.transaction(() => {
      context.check(); this.generation(scope, generation);
      if (this.sql.cursor.get(scope).nextSeq !== fromSeq) fail('MISSING_OR_REORDERED_SEQUENCE');
      // A tail captured by streaming must use its original resume protocol.
      if (this.sql.event.get(scope, fromSeq)) fail('PENDING_EVENT_CONFLICT');
      for (const item of items) {
        context.check();
        if (item.kind === 'skip') {
          this.sql.insertOmitted.run(scope, item.seq, item.type);
          this.sql.insertOmission.run(scope, item.seq, item.reason);
          continue;
        }
        const meta = item.metadata;
        if (sha(item.body) !== meta.hash) fail('PERSISTED_HASH_MISMATCH');
        const projection = meta.search ? validateSearchProjection(item.body, item.search) : undefined;
        if (meta.search && sha(projection) !== meta.search.hash) fail('PERSISTED_SEARCH_HASH_MISMATCH');
        this.sql.insertEvent.run(scope, meta.seq, meta.type ?? 'message', meta.role ?? 'user', meta.encoding, meta.hash, meta.chars, meta.bytes, serializeSearchMetadata(meta.search));
        this.sql.insertStream.run(scope, meta.seq, generation);
        this.sql.insert.run(scope, meta.seq, 0, 0, meta.chars, item.body, storedProjection(item.body, projection));
        const stored = this.sql.indexPage.get(scope, meta.seq, 0);
        if (!stored || stored.part !== 0 || stored.start !== 0 || stored.end !== meta.chars || stored.body.length !== meta.chars
          || Buffer.byteLength(stored.body) !== meta.bytes || sha(stored.body) !== meta.hash) fail('PERSISTED_HASH_MISMATCH');
        if (meta.search && sha(projectedBody(stored)) !== meta.search.hash) fail('PERSISTED_SEARCH_HASH_MISMATCH');
        this.registerCall(scope, this.metadata(scope, meta.seq));
        this.indexPart(scope, meta.seq, 0);
        this.sql.updateStream.run(meta.chars, meta.bytes, 1, 1, scope, meta.seq);
        this.sql.finishEvent.run(1, scope, meta.seq);
        this.sql.finishStream.run(scope, meta.seq);
      }
      context.check();
      this.sql.updateCursor.run(fromSeq + items.length, scope);
      return { generation, nextSeq: fromSeq + items.length, appendedCount: items.length };
    });
    // A lost receipt can follow COMMIT; Host recovery validates the full prefix.
    await yieldTurn(); context.check(); return receipt;
  }
  async inspectPrefix(scope, generation, nextSeq, context) {
    context.check(); this.generation(scope, generation);
    const watermark = this.sql.cursor.get(scope).nextSeq, end = nextSeq ?? watermark;
    if (end > watermark) fail('PREFIX_NOT_COMPLETE');
    const digest = createHistoryPrefixHasher();
    while (digest.nextSeq < end) {
      context.check(); this.generation(scope, generation);
      const rows = this.sql.prefixPage.all(scope, digest.nextSeq, end);
      if (!rows.length) fail('BROKEN_PREFIX_CHAIN');
      for (const row of rows) {
        if (row.state === 'omitted' && !row.omissionReason) fail('MISSING_OMISSION_REFERENCE');
        digest.append(row);
      }
      await yieldTurn();
    }
    context.check(); return { generation, ...digest.digest() };
  }
  async deleteScope(scope, generation, context) {
    context.check();
    const current = this.transaction(() => {
      const state = this.sql.scope.get(scope);
      // Retrying after cancellation/timeout may carry the generation before the tombstone commit.
      if (!state || (state.generation !== generation && !(state.state !== 'active' && state.generation === generation + 1))) fail('STALE_SCOPE_GENERATION');
      if (state.state === 'active') this.sql.retireScope.run(scope);
      else if (!['deleting','deleted'].includes(state.state)) fail('SCOPE_UNAVAILABLE');
      return this.sql.scope.get(scope).generation;
    });
    return this.purgeScope(scope, current, context);
  }
  async purgeScope(scope, current, context) {
    context.check(); const state = this.sql.scope.get(scope);
    if (!state || state.generation !== current || !['deleting','deleted'].includes(state.state)) fail('STALE_SCOPE_GENERATION');
    if (state.state === 'deleted') return { ...this.inspect(scope), generation: current, state: 'deleted' };
    clearDocFeatures();
    // The FULL-synchronous tombstone is already durable and excludes every
    // reader/writer. Only this replayable cleanup uses NORMAL: a power loss
    // may undo recent physical batches, which startup resumes from the durable
    // tombstone. Keep each transaction/cancellation bound and secure erasure;
    // restore FULL before completion or any later archive write.
    this.db.exec('PRAGMA synchronous=NORMAL;');
    try {
      // Cleanup does not transport bodies. Bound transactions by stored bytes and
      // feature work, rather than paying a FULL-synchronous commit per eight IDs.
      // Column byte lengths come from record metadata, without loading either
      // potentially overflow-backed text just to choose a deletion batch.
      const chunkPage = this.db.prepare(`SELECT id,octet_length(body)+coalesce(octet_length(search),0) AS bytes
        FROM chunks WHERE scope=? ORDER BY id LIMIT ?`);
      // toolCalls is WITHOUT ROWID: SQLite otherwise chooses its scope-only primary
      // key and repeatedly scans remaining calls, even for a single event sequence.
      const eventDeletes = ['streams', 'omissions', 'toolCalls', 'events'].map(table => this.db.prepare(
        `DELETE FROM ${table}${table === 'toolCalls' ? ' INDEXED BY calls_event' : ''} WHERE scope=? AND seq BETWEEN ? AND ?`));
      let pageRows = 128;
      for (;;) {
        context.check(); const rows = chunkPage.all(scope, pageRows); if (!rows.length) break;
        this.transaction(() => { let bytes = 0, terms = 0, count = 0; for (const row of rows) {
          context.check();
          if (count && bytes + row.bytes > STREAM_BUDGET.rpcBytes) break;
          const features = this.sql.chunkTerms.all(scope, row.id);
          // A single bounded chunk must make progress even when feature-dense.
          if (count && terms + features.length > 4096) break;
          for (const { term } of features) { context.check(); this.sql.decreaseDf.run(scope, term); this.sql.zeroDf.run(scope, term); }
          this.sql.deletePostings.run(scope, row.id); this.sql.deleteChunk.run(row.id, scope);
          bytes += row.bytes; terms += features.length; count++;
        } context.check();
          // Avoid repeatedly reading a full 128-row page when large projections
          // permit only a few of its rows in this transaction. These estimates
          // change read-ahead only; the byte/feature checks remain authoritative.
          pageRows = Math.max(1, Math.min(128, Math.floor(STREAM_BUDGET.rpcBytes * count / Math.max(1, bytes)),
            terms ? Math.floor(4096 * count / terms) : 128));
        }); await yieldTurn();
      }
      for (;;) {
        context.check(); const rows = this.sql.deleteEventsPage.all(scope); if (!rows.length) break;
        this.transaction(() => { for (const statement of eventDeletes) {
          context.check(); statement.run(scope, rows[0].seq, rows.at(-1).seq);
        } context.check(); }); await yieldTurn();
      }
    } finally {
      this.db.exec('PRAGMA synchronous=FULL;');
    }
    this.transaction(() => { context.check(); this.db.prepare('DELETE FROM source WHERE scope=?').run(scope);
      this.db.prepare("UPDATE scopeMeta SET state='deleted' WHERE scope=? AND generation=?").run(scope, current); });
    clearDocFeatures(); this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { generation: current, state: 'deleted', ...this.inspect(scope) };
  }
  close() { clearDocFeatures(); this.db.close(); }
}
