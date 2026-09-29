import { createVaultClient } from './remote-client.js';
import { currentSessionId } from './session-current.js';

/** Empty-lesson chrome only. The native composer remains outside this slot. */
export function createLessonEntry(React,{Icon}) {
  const h=React.createElement;
  const none=()=>()=>{};
  const failed='教法暂时读不出来，可以开课后在教学设置里选。';
  /** The lesson's teaching method, chosen before the first message. It is the
   * same setting as 教学设置 → 教法, so it is read again each time the options
   * open. Writing it keeps the lesson blank: the native list marks a session
   * non-blank only at its first turn. */
  function TeachingChoice({ctx,sessionId,open}) {
    const vault=React.useMemo(()=>ctx&&sessionId?createVaultClient(ctx,sessionId):null,[ctx,sessionId]);
    const [settings,setSettings]=React.useState(null),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false);
    // The click shows at once; a failed save puts the saved choice back.
    const [pending,setPending]=React.useState(null);
    React.useEffect(()=>{
      let live=true;
      setSettings(null);setNotice('');
      if(!vault||!open)return undefined;
      vault.teachingSettings({sessionId}).then(result=>{if(!live)return;if(result?.ok)setSettings(result.value);else setNotice(failed);},()=>{if(live)setNotice(failed);});
      return ()=>{live=false;};
    },[vault,sessionId,open]);
    if(!vault)return null;
    const choose=async id=>{
      if(!settings||busy||id===settings.teachingRef)return;
      setBusy(true);setNotice('');setPending(id);
      try{
        const result=await vault.updateTeachingSettings({sessionId,expectedRevision:settings.revision,patch:{teachingRef:id}});
        if(result?.ok){setSettings(result.value);return;}
        const latest=await vault.teachingSettings({sessionId});
        if(latest?.ok)setSettings(latest.value);
        setNotice('没有保存成功，请再选一次。');
      }catch{setNotice('没有保存成功，请再选一次。');}
      finally{setBusy(false);setPending(null);}
    };
    return h('fieldset',{className:'nv-lesson-entry-method',disabled:busy},
      h('legend',null,'教法'),
      settings&&settings.choices.map(choice=>h('label',{key:choice.id},
        h('input',{type:'radio',name:'nv-lesson-entry-method',value:choice.id,checked:(pending??settings.teachingRef)===choice.id,onChange:()=>{void choose(choice.id);}}),
        h('span',null,choice.title,choice.description&&h('small',null,choice.description)))),
      !settings&&!notice&&h('p',null,'正在读取…'),
      notice&&h('p',{role:'status'},notice));
  }
  return function LessonEntry({nativeWorkspaceSelector,needsWorkspace,sessions,ctx}) {
    // A lesson opened from the plan is still blank before its first message;
    // it already carries the lesson's name, so the welcome says which lesson.
    const snapshot=React.useSyncExternalStore(sessions?fn=>sessions.subscribe(fn):none,()=>sessions?.getSnapshot());
    const current=currentSessionId(snapshot);
    const title=String(snapshot?.byId?.[current]?.title??'').trim();
    const [open,setOpen]=React.useState(false);
    return h('section',{className:'nv-lesson-entry','aria-label':'开始一节新课'},
      h('div',{className:'nv-lesson-entry-heading'},
        h('h1',null,title||'新的一课'),
        !needsWorkspace&&h('details',{className:'nv-lesson-entry-options',onToggle:event=>setOpen(event.currentTarget.open)},
          h('summary',null,h(Icon,{name:'sliders'}),'课程选项'),
          h('div',{className:'nv-lesson-entry-options-content'},nativeWorkspaceSelector,h(TeachingChoice,{ctx,sessionId:current??null,open})))),
      h('p',{className:'nv-lesson-entry-lead'},'写下问题和你的尝试，或带一份资料进来。'),
      needsWorkspace&&h('div',{className:'nv-lesson-entry-required'},h('p',null,'先选择学习目录，再开始这节课。'),nativeWorkspaceSelector));
  };
}
