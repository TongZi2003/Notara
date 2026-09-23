window.__ModuleLoader__.load({
  id: '@notara/pixel-classroom',
  factory: require => {
    const React = require('react');
    // The parent owns the projection; this list is the bridge's own allowlist, so
    // only these keys cross into the frame. `workers` and each task's `preset`
    // are part of it: the five posts and their task attribution ride the snapshot.
    const SNAPSHOT_KEYS = ['version', 'loading', 'error', 'visible', 'title', 'teacher', 'workers', 'tasks', 'opening', 'stopping'];
    const projectSnapshot = snapshot => {
      const source = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const projected = {};
      for (const key of SNAPSHOT_KEYS) if (key in source) projected[key] = source[key];
      return projected;
    };
    function PixelClassroom(props) {
      const frame = React.useRef(null), latest = React.useRef(props);
      latest.current = props;
      const channel = React.useMemo(() => crypto.randomUUID(), [props.sessionId]);
      const send = React.useCallback(() => frame.current?.contentWindow?.postMessage({
        type: 'notara:classroom-state', channel, snapshot: projectSnapshot(latest.current.snapshot),
      }, location.origin), [channel]);
      React.useEffect(() => {
        const receive = event => {
          if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.channel !== channel) return;
          const current = latest.current, message = event.data;
          if (message.type === 'notara:classroom-ready') { send(); return; }
          if (message.type !== 'notara:classroom-action' || !current.snapshot?.visible || current.snapshot.error) return;
          if (message.action === 'refresh') { void current.onRefresh(); return; }
          if (message.action === 'configure') { current.onConfigure(); return; }
          const row = current.snapshot.tasks.find(task => task.id === message.taskId);
          if (!row) return;
          if (message.action === 'inspect' && row.inspectable && !current.snapshot.opening) current.onInspect(row.id);
          if (message.action === 'cancel' && row.cancelable && row.status === 'running' && !current.snapshot.stopping) current.onCancel(row.id);
        };
        window.addEventListener('message', receive);
        const heartbeat = setInterval(send, 2000);
        return () => { clearInterval(heartbeat); window.removeEventListener('message', receive); };
      }, [channel, send]);
      React.useEffect(() => { send(); }, [props.snapshot, send]);
      return React.createElement('iframe', {
        ref: frame, key: channel, title: '教室像素视图', onLoad: send,
        src: `/notara/pixel-classroom/?mode=live&channel=${encodeURIComponent(channel)}`,
        style: { display: 'block', width: '100%', height: '100%', minHeight: 0, border: 0, flex: 1 },
        sandbox: 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox',
      });
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => ctx.slots.inject('notara.classroom.view', () => ctx.slots.register({
          name: 'notara.classroom.view', id: 'pixel', label: '像素', order: 20,
        }, PixelClassroom)), 'notara-pixel-classroom: classroom view');
      },
    };
  },
});
