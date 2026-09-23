const SLOT = 'tool.call.toolview';
const REGISTRANT = 'notara-vault-native: bash learning steps';

/** A display hint only: never use the description to authorize execution. */
export function bashStep(block) {
  if (!block || typeof block !== 'object') return null;
  const settled = block.kind === 'tool-result';
  let args;
  try { args = JSON.parse(settled ? block.call?.argsRaw : block.argsRaw); }
  catch { return null; }
  if (!args || typeof args.description !== 'string' || typeof args.command !== 'string') return null;
  const match = /^\[notara:([a-z][a-z0-9-]*)\]\s+(.+)$/s.exec(args.description.trim());
  if (!match) return null;
  const title = match[2].replace(/^#{1,6}\s+/, '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const content = Array.isArray(block.content) ? block.content : [];
  const output = content.filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
  const meta = block.meta && typeof block.meta === 'object' ? block.meta : {};
  // rc.2 reports non-zero shell exits as ordinary tool results. Its final
  // status marker (or explicit metadata) must override isError=false.
  const exit = typeof meta.exitCode === 'number' ? meta.exitCode : Number(/\n\[exit code: (\d+)\]\s*$/.exec(output)?.[1] ?? 0);
  const signal = typeof meta.signal === 'string' && meta.signal ? meta.signal : /\n\[killed by signal: ([^\]\n]+)\]\s*$/.exec(output)?.[1];
  const interrupted = block.error?.code === 'interrupted' || meta.aborted === true;
  const failed = block.isError || block.error || exit !== 0 || signal || meta.timedOut === true;
  // A returned result is not proof that the student's work was recorded, nor
  // that a background job completed. Keep this label deliberately factual.
  const state = !settled ? 'running' : interrupted ? 'stopped' : failed ? 'error' : 'returned';
  return {
    title, intent: match[1], command: args.command, output, state,
    status: { running: '处理中', stopped: '已中断', error: '执行失败', returned: '已返回' }[state],
  };
}

const CSS = `
.nv-bash-step{padding:4px 0;color:var(--dsw-alias-label-primary);min-width:0}
.nv-bash-toggle{display:flex;align-items:center;gap:6px;max-width:100%;line-height:1.6}
.nv-bash-title{overflow-wrap:anywhere}
.nv-bash-chevron{width:12px;height:12px;flex:none;transition:transform .15s}
.nv-bash-toggle[aria-expanded=true] .nv-bash-chevron{transform:rotate(90deg)}
.nv-bash-status{font-size:12px;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.nv-bash-step[data-state=error] .nv-bash-status{color:var(--dsw-alias-label-error,#c74b4b)}
.nv-bash-toggle,.nv-bash-inspect{border:0;background:none;padding:5px 0;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;font-weight:400;cursor:pointer;text-align:left}
.nv-bash-toggle:hover,.nv-bash-inspect:hover{color:var(--dsw-alias-label-primary)}
.nv-bash-toggle:focus-visible,.nv-bash-inspect:focus-visible{outline:2px solid var(--dsw-alias-label-link,#6370ff);outline-offset:3px;border-radius:3px}
.nv-bash-detail{margin:6px 0 0;padding:8px 12px;border-left:2px solid var(--dsw-alias-border-l1);min-width:0}
.nv-bash-detail small{color:var(--dsw-alias-label-secondary);font-size:11px}
.nv-bash-detail pre{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow:auto;margin:5px 0 12px}
`;

export function createBashStep(React, NativeBashRow) {
  const h = React.createElement;
  return function BashLearningStep(props) {
    const row = bashStep(props.block);
    const [open, setOpen] = React.useState(false);
    const detailId = React.useId();
    // Invalid, partial, untagged and historical calls retain the actual native
    // renderer and its injected props, locale, trace and terminal behaviour.
    if (!row) return h(NativeBashRow, props);
    return h('section', { className: 'nv-bash-step', 'data-state': row.state },
      h('button', { type: 'button', className: 'nv-bash-toggle', 'aria-expanded': open, 'aria-controls': detailId, onClick: () => setOpen(value => !value) },
        h('svg', { className: 'nv-bash-chevron', viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, 'aria-hidden': true }, h('path', { d: 'M4 2l4 4-4 4' })),
        h('span', { className: 'nv-bash-title' }, row.title),
        row.state !== 'returned' && h('span', { className: 'nv-bash-status', role: 'status' }, row.status)),
      open && h('div', { id: detailId, className: 'nv-bash-detail' },
        h('small', null, '命令'), h('pre', null, row.command),
        h('small', null, '输出'), h('pre', null, row.output || (row.state === 'running' ? '尚未返回输出' : '无文本输出')),
        props.inspect && h('button', { type: 'button', className: 'nv-bash-inspect', onClick: props.inspect }, '查看原始记录')));
  };
}

/** Decorate the public rc.2 Bash registration without replacing its lifecycle.
 * The native row has no child slots. If that contract changes, leave it alone
 * rather than dropping a new native control or duplicating its child owners.
 */
export function installBashDisplay(slots, React) {
  return slots.inject(SLOT, () => {
    let original, unregister;
    const reconcile = () => {
      const native = slots.entries(SLOT).find(entry => entry.options.key === 'bash' && (entry.options.priority ?? 0) === 0);
      if (native === original) return;
      unregister?.();
      unregister = undefined;
      original = native;
      if (!native || Object.keys(native.children ?? {}).length) return;
      const { component, options, ...metadata } = native;
      unregister = slots.register({ ...options, ...metadata, name: SLOT, priority: -1, registrant: REGISTRANT }, createBashStep(React, component));
    };
    const unsubscribe = slots.subscribe(SLOT, reconcile);
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    const dispose = () => { unsubscribe(); unregister?.(); style.remove(); };
    try { reconcile(); } catch (error) { dispose(); throw error; }
    return dispose;
  });
}
