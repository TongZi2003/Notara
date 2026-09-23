import { useEffect, useState } from 'react';

export interface LiveRoute {
  provider: string; model: string; reasoningEffort?: string; maxTokens?: number;
}
/** One real background post. Its state is the Host's, never a demo step. */
export interface LiveWorker {
  id: string; name: string; description: string;
  ready: boolean; tools: 'none' | 'read';
  preferredModel: string; route: LiveRoute | null; reason: string; notice: string;
  active: boolean;
}
export interface LiveTask {
  id: string; preset: string; name: string;
  status: 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
  label: string; time: string; inspectable: boolean; cancelable: boolean;
}
export interface LiveClassroomSnapshot {
  version: 1; loading: boolean; error: string; visible: boolean; title: string;
  teacher: { name: string; description: string; active: boolean; error: string } | null;
  workers: LiveWorker[];
  tasks: LiveTask[]; opening: string; stopping: string;
}
const query = new URLSearchParams(location.search);
export const liveMode = query.get('mode') === 'live';
const channel = query.get('channel');

/** All task actions return to the existing classroom owner. */
export function classroomAction(action: 'refresh' | 'configure' | 'inspect' | 'cancel', taskId?: string) {
  window.parent.postMessage({ type: 'notara:classroom-action', channel, action, taskId }, location.origin);
}
export function useLiveClassroom() {
  const [state, setState] = useState<LiveClassroomSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!liveMode || !channel || window.parent === window) return;
    let lastReceived = 0;
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.channel !== channel || event.data.type !== 'notara:classroom-state') return;
      const next = event.data.snapshot;
      if (next?.version !== 1 || !Array.isArray(next.tasks) || !Array.isArray(next.workers)) return;
      lastReceived = Date.now(); setState(next); setConnected(true);
    };
    window.addEventListener('message', receive);
    window.parent.postMessage({ type: 'notara:classroom-ready', channel }, location.origin);
    const heartbeat = setInterval(() => { if (Date.now() - lastReceived > 8000) setConnected(false); }, 2000);
    return () => { clearInterval(heartbeat); window.removeEventListener('message', receive); };
  }, []);
  return { state, connected };
}

/** One selected post: the teacher, or one worker. Never a demo step. */
export function LiveInspector({ state, connected, roleId }: { state: LiveClassroomSnapshot | null; connected: boolean; roleId: string }) {
  const unavailable = !connected || !!state?.error || !state?.visible;
  const isTeacher = roleId === 'teacher';
  const worker = isTeacher ? null : (state?.workers ?? []).find(row => row.id === roleId) ?? null;
  // Clicking a post shows only that post's tasks; the teacher owns no background task.
  const tasks = isTeacher ? [] : (state?.tasks ?? []).filter(task => task.preset === roleId);
  const running = tasks.some(task => task.status === 'running');
  const activity = !connected ? '等待教室连接' : state?.error ? '状态暂不可用' : state?.loading ? '正在读取…'
    : isTeacher ? (state?.teacher?.active ? '授课处理中' : '等待你的消息')
    : (worker?.active || running) ? '独立分析中' : worker?.ready ? '待命' : '尚未配置';
  const detail = state?.error || (isTeacher ? state?.teacher?.error || state?.teacher?.description : worker?.description);
  return <>
    <section className="pc-block">
      <h3 className="pc-block-title">当前状态</h3>
      <p className="pc-activity">{activity}</p>
      <p className="pc-detail">{detail}</p>
      {!isTeacher && <p className="pc-muted">{worker?.notice || '这位工作员还没有配置后台模型。'}</p>}
      {!isTeacher && worker && <p className="pc-muted">资料范围：{worker.tools === 'read' ? '可读取原文、搜索资料和查看图片' : '不读文件，只用老师交付的材料'}</p>}
    </section>
    <section className="pc-block">
      <h3 className="pc-block-title">近期后台任务 · {tasks.length}</h3>
      {isTeacher ? <p className="pc-muted">主教师负责编排与汇总；后台任务属于五个工作员岗位。</p>
        : !tasks.length ? <p className="pc-muted">这位工作员还没有后台任务。老师实际派出任务后，会自动出现在这里。</p> :
        <ul className="pc-outputs">{tasks.map(task => <li key={task.id}>
          <span className="pc-output-step">{task.label} · {task.time}</span>
          <div className="pc-chip-row">
            {task.inspectable && <button className="pc-chip" disabled={unavailable || !!state?.opening} onClick={() => classroomAction('inspect', task.id)}>{state?.opening === task.id ? '正在打开…' : '查看分析（含完整解法）'}</button>}
            {task.cancelable && <button className="pc-chip" disabled={unavailable || !!state?.stopping} onClick={() => classroomAction('cancel', task.id)}>{state?.stopping === task.id ? '正在停止…' : '停止任务'}</button>}
          </div>
        </li>)}</ul>}
      {!isTeacher && !!tasks.length && <p className="pc-muted">点击查看分析，打开这次任务的原生记录：老师交付的材料与返回结果。</p>}
    </section>
  </>;
}
