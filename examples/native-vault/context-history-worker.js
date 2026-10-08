import { isMainThread,parentPort,workerData } from 'node:worker_threads';
import { ContextHistoryStore } from './context-history-store.js';
import { STREAM_BUDGET,validateRpc,rpcBytes } from './context-history-client.js';
const fail=code=>{throw Object.assign(new Error(code),{code})};
if (!isMainThread && workerData?.entry === 'notara-context-history') {
  let archive, queue = Promise.resolve(); const cancelled = new Set(), known = new Set();
  try {
    archive = new ContextHistoryStore(workerData.path);
    // Tombstones survive loss of the native headers and an interrupted previous Host.
    await archive.resumeDeletions({ check() {} });
    parentPort.postMessage({ ready: true });
  }
  catch (error) { archive?.close(); parentPort.postMessage({ fatal: error.code ?? 'OPEN_FAILED' }); parentPort.close(); }
  parentPort.on('message', request => {
    if (request.cancel) { if (known.has(request.cancel)) cancelled.add(request.cancel); return; }
    known.add(request.id);
    queue = queue.then(async () => {
      const context = { check() { if (cancelled.has(request.id)) fail('OP_CANCELLED'); if (Date.now() >= request.deadline) fail('OP_TIMEOUT'); } };
      try {
        context.check();
        if (!['openScope','bindSession','deleteSessionIds','beginEvent','appendChunks','finishEvent','cancelEvent','skipEvents','appendEventBatch','search','page','inspect','inspectEvent','inspectPrefix','deleteScope','close'].includes(request.method)) fail('INVALID_OPERATION');
        validateRpc(request.method, request.args);
        if (rpcBytes(request.method, request.args) > STREAM_BUDGET.rpcBytes) fail('RPC_BYTE_BUDGET');
        const value = request.method === 'close' ? (archive.close(), true) : await archive[request.method](...request.args, context);
        context.check(); parentPort.postMessage({ id: request.id, value }); if (request.method === 'close') parentPort.close();
      } catch (error) { parentPort.postMessage({ id: request.id, error: error.code ?? 'OP_FAILED' }); }
      finally { cancelled.delete(request.id); known.delete(request.id); }
    });
  });
}
