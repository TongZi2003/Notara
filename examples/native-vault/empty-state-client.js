/** Every empty page in one place: warm, and a button only for what really works now. */
export const EMPTY_STATES = Object.freeze({
  homeNoDirectory: { icon: 'folder', title: '还没选学习目录', text: '先选一个放学习资料的文件夹，我们就可以开始啦', actions: [{ label: '选择目录' }] },
  homeNoLessons: { text: '还没有课堂，在右边说说今天想学什么吧' },
  routes: { icon: 'route', title: '还没有学习路线', text: '去对话里和老师一起规划吧！', actions: [{ label: '去对话里规划' }, { label: '自己新建', secondary: true }], draft: '帮我规划一条学习路线' },
  review: { icon: 'calendar', title: '今天没有要复习的卡片', text: '休息一下，或者学点新的吧' },
  scheduled: { icon: 'clock', title: '定时任务', text: '还在准备中，暂时还不能用' },
  vault: { icon: 'books', title: '资料库还是空的', text: '导入一份讲义，或者新建一页笔记吧', actions: [{ label: '导入媒体文件' }, { label: '从模板新建', secondary: true }] },
  skillsNoOverview: { title: '还没有学习集梗概', text: '写下想学什么、学到什么程度，老师就能按你的节奏来', actions: [{ label: '创建学习集梗概' }] },
});

export function createEmptyState(React, { Icon }) {
  const h = React.createElement;
  function EmptyState({ kind, onAction = [], compact = false, disabled = false }) {
    const copy = EMPTY_STATES[kind];
    return h('div', { className: 'nv-empty', 'data-compact': compact || undefined, role: 'status' },
      copy.icon && h('span', { className: 'nv-empty-icon', 'aria-hidden': true }, h(Icon, { name: copy.icon })),
      copy.title && h('b', null, copy.title),
      h('p', null, copy.text),
      copy.actions?.length > 0 && h('div', { className: 'nv-empty-actions' }, copy.actions.map((action, index) =>
        h('button', { key: action.label, type: 'button', disabled: disabled || !onAction[index], className: action.secondary ? 'nv-empty-link' : 'nv-empty-primary', onClick: () => onAction[index]?.() }, action.label))));
  }
  const ScheduledView = () => h('div', { className: 'nv-empty-page' }, h(EmptyState, { kind: 'scheduled' }));
  return { EmptyState, ScheduledView };
}
