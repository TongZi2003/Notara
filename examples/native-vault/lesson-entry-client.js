/** Empty-lesson chrome only. The native composer remains outside this slot. */
export function createLessonEntry(React,{Icon}) {
  const h=React.createElement;
  return function LessonEntry({nativeWorkspaceSelector,needsWorkspace}) {
    return h('section',{className:'nv-lesson-entry','aria-label':'开始一节新课'},
      h('div',{className:'nv-lesson-entry-heading'},
        h('h1',null,'新的一课'),
        !needsWorkspace&&h('details',{className:'nv-lesson-entry-options'},
          h('summary',null,h(Icon,{name:'sliders'}),'课程选项'),
          h('div',{className:'nv-lesson-entry-options-content'},nativeWorkspaceSelector))),
      h('p',{className:'nv-lesson-entry-lead'},'写下问题和你的尝试，或带一份资料进来。'),
      needsWorkspace&&h('div',{className:'nv-lesson-entry-required'},h('p',null,'先选择学习目录，再开始这节课。'),nativeWorkspaceSelector));
  };
}
