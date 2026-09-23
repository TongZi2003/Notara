import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function mount() {
  const origin = 'http://classroom.test', events = new Map(), effects = [], posted = [], invoked = [];
  let module, Component;
  const React = {
    useRef: value => ({ current: value }), useMemo: factory => factory(), useCallback: fn => fn,
    useEffect: effect => effects.push(effect), createElement: (type, props) => ({ type, props }),
  };
  const scope = {
    window: { __ModuleLoader__: { load: value => { module = value; } }, addEventListener: (name, handler) => events.set(name, handler), removeEventListener: name => events.delete(name) },
    location: { origin }, crypto: { randomUUID: () => 'channel-1' },
    setInterval: () => 1, clearInterval() {},
  };
  vm.runInNewContext(readFileSync(new URL('./client.js', import.meta.url), 'utf8'), scope);
  const registrations = [];
  module.factory(name => { assert.equal(name, 'react'); return React; }).apply({
    effect(start) { start(); },
    slots: { inject(name, start) { assert.equal(name, 'notara.classroom.view'); return start(); }, register(options, component) { registrations.push(options); Component = component; } },
  });
  const props = {
    sessionId: 'lesson-a', snapshot: {
      version: 1, visible: true, error: '', opening: '', stopping: '',
      teacher: { name: '大肥鱼', description: '主教师', active: false, error: '' },
      workers: [
        { id: 'problem', name: '题目研究员', description: '独立研究一道完整题。', ready: true, tools: 'read', preferredModel: 'gpt-5.6-sol', route: null, reason: '', notice: '后台分析会自动匹配 gpt-5.6-sol。', active: true },
        { id: 'lesson', name: '课时备课员', description: '按框架完善一节课。', ready: false, tools: 'none', preferredModel: 'gpt-5.6-sol', route: null, reason: '', notice: '后台分析暂时不可用。', active: false },
      ],
      tasks: [{ id: 'task-a', preset: 'problem', name: '题目研究员', status: 'running', label: '分析中', time: '刚刚开始', inspectable: true, cancelable: true }],
      secret: 'PRIVATE_PARENT_FIELD',
    },
    onInspect: id => invoked.push(['inspect', id]), onCancel: id => invoked.push(['cancel', id]),
    onRefresh: () => invoked.push(['refresh']), onConfigure: () => invoked.push(['configure']),
  };
  const element = Component(props), source = { postMessage: (message, target) => { posted.push({ message, target }); } };
  element.props.ref.current = { contentWindow: source };
  const cleanups = effects.map(effect => effect());
  const send = (data, overrides = {}) => events.get('message')?.({ origin, source, data: { channel: 'channel-1', type: 'notara:classroom-action', ...data }, ...overrides });
  return { registrations, element, source, props, posted, invoked, send, dispose: () => cleanups.forEach(fn => fn?.()), events };
}

test('pixel is one classroom view and immediately sends the owner snapshot, not demo steps', () => {
  const app = mount();
  assert.equal(app.registrations.length, 1);
  assert.equal(app.registrations[0].name, 'notara.classroom.view');
  assert.equal(app.registrations[0].id, 'pixel');
  assert.match(app.element.props.src, /mode=live&channel=channel-1/);
  assert.equal(app.posted[0].target, 'http://classroom.test');
  assert.equal(app.posted[0].message.type, 'notara:classroom-state');
  // 父侧白名单把 workers 与 task.preset 一起送过桥：五岗位与任务归属都来自同一个快照，
  // 而快照里没在白名单上的字段不会进入 iframe。
  const forwarded = app.posted[0].message.snapshot;
  assert.equal(forwarded.visible, true);
  assert.equal(forwarded.teacher.name, '大肥鱼');
  assert.deepEqual(forwarded.workers.map(row => row.id), ['problem', 'lesson']);
  assert.equal(forwarded.workers[0].tools, 'read');
  assert.equal(forwarded.workers[1].tools, 'none');
  assert.equal(forwarded.tasks[0].preset, 'problem');
  assert.equal('secret' in forwarded, false);
  app.dispose(); assert.equal(app.events.size, 0);
});

test('only this frame and current task can invoke the existing classroom actions', () => {
  const app = mount();
  app.send({ action: 'cancel', taskId: 'task-a' }, { origin: 'http://other.test' });
  app.send({ action: 'cancel', taskId: 'task-a' }, { source: {} });
  app.send({ action: 'cancel', taskId: 'task-a', channel: 'previous-session' });
  app.send({ action: 'cancel', taskId: 'another-lesson-task' });
  assert.deepEqual(app.invoked, []);
  app.send({ action: 'inspect', taskId: 'task-a' }); app.send({ action: 'cancel', taskId: 'task-a' });
  assert.deepEqual(app.invoked, [['inspect', 'task-a'], ['cancel', 'task-a']]);
  app.props.snapshot.tasks[0].status = 'completed'; app.send({ action: 'cancel', taskId: 'task-a' });
  assert.equal(app.invoked.length, 2);
  app.props.snapshot.visible = false; app.send({ action: 'inspect', taskId: 'task-a' });
  assert.equal(app.invoked.length, 2);
  app.props.snapshot.visible = true; app.props.snapshot.error = 'offline'; app.send({ action: 'inspect', taskId: 'task-a' });
  assert.equal(app.invoked.length, 2);
  app.props.snapshot.error = ''; app.props.snapshot.tasks = []; app.send({ action: 'inspect', taskId: 'task-a' });
  assert.equal(app.invoked.length, 2);
  app.send({ action: 'configure' }); app.send({ action: 'refresh' });
  assert.deepEqual(app.invoked.slice(-2), [['configure'], ['refresh']]);
  app.dispose();
});
