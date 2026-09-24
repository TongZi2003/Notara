import css from './today-entry.css';

/** A single native-lesson entry with one rotating, factual learning reminder. */
export function createTodayEntry(React,{Icon}={}) {
  const h=React.createElement,{useState,useEffect}=React;
  return function TodayEntry({items=[],loading=false,error='',composerError='',visible=true,composerReady=false,active=true,onOpen,onRetry,onPrepare,children}={}) {
    const [selected,setSelected]=useState(null),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[paused,setPaused]=useState(false);
    const [hidden,setHidden]=useState(document.hidden),[reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
    const [now,setNow]=useState(()=>new Date());
    useEffect(()=>{if(!active)return;setNow(new Date());const timer=setInterval(()=>setNow(new Date()),60000);return()=>clearInterval(timer);},[active]);
    const greeting=now.getHours()<6?'夜深了':now.getHours()<12?'上午好':now.getHours()<18?'下午好':'晚上好';
    const index=Math.max(0,items.findIndex(item=>item.key===selected)),item=items[index];
    const keys=items.map(item=>item.key),signature=JSON.stringify(keys);
    useEffect(()=>{
      const media=matchMedia('(prefers-reduced-motion: reduce)'),motion=()=>setReduced(media.matches),visibility=()=>setHidden(document.hidden);
      media.addEventListener('change',motion);document.addEventListener('visibilitychange',visibility);
      return()=>{media.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);};
    },[]);
    useEffect(()=>{
      if(!active||hidden||reduced||paused||hovered||focused||loading||keys.length<2)return;
      const timer=setInterval(()=>setSelected(previous=>{
        const current=Math.max(0,keys.indexOf(previous));return keys[(current+1)%keys.length];
      }),6500);
      return()=>clearInterval(timer);
    },[active,hidden,reduced,paused,hovered,focused,loading,signature]);
    const step=delta=>setSelected(keys[(index+delta+keys.length)%keys.length]);
    return h('div',{className:visible?'nv-home':'nv-home-pass','aria-label':visible?'今日学习':undefined},
      h('style',null,css),
      visible&&h('header',{className:'nv-home-welcome'},
        h('time',null,new Intl.DateTimeFormat('zh-CN',{month:'long',day:'numeric',weekday:'long'}).format(now)),
        h('h1',null,greeting+'，今天想学点什么？')),
      visible&&!composerReady&&h('div',{className:'nv-home-preparing',role:composerError?'alert':'status'},composerError||'正在准备输入框…',composerError&&h('button',{onClick:onPrepare},'重试')),
      h('div',{key:'native',className:visible?'nv-home-native':'nv-home-pass',style:visible&&!composerReady?{display:'none'}:undefined},children),
      visible&&h('section',{className:'nv-home-agenda','aria-label':'学习待办',onMouseEnter:()=>setHovered(true),onMouseLeave:()=>setHovered(false),
        onFocusCapture:()=>setFocused(true),onBlurCapture:e=>{if(!e.currentTarget.contains(e.relatedTarget))setFocused(false);}},
        h('header',null,h('h2',null,'接下来'),
          items.length>1&&h('div',{className:'nv-home-controls'},
            h('span',{'aria-label':'待办位置'},(index+1)+' / '+items.length),
            !reduced&&h('button',{type:'button','aria-label':paused?'继续自动轮换':'暂停自动轮换',onClick:()=>setPaused(value=>!value)},paused?'▷':'Ⅱ'),
            h('button',{type:'button','aria-label':'上一条待办',onClick:()=>step(-1)},'‹'),
            h('button',{type:'button','aria-label':'下一条待办',onClick:()=>step(1)},'›'))),
        error&&h('div',{className:'nv-home-error',role:'alert'},error,h('button',{onClick:onRetry},'重试')),
        h('div',{className:'nv-home-ticker','aria-live':'off'},
          loading?h('p',{className:'nv-home-empty',role:'status'},'正在读取学习安排…'):
            !item&&!error?h('p',{className:'nv-home-empty'},'暂时没有待复习卡片或待安排的课程。'):
            item&&h('button',{key:item.key,className:'nv-home-task',onClick:()=>onOpen(item)},
              h('span',{className:'nv-home-task-icon','aria-hidden':true},Icon?h(Icon,{name:item.kind==='schedule'?'calendar':'refresh'}):'○'),
              h('span',{className:'nv-home-task-text'},h('strong',null,item.title),h('small',null,item.subtitle)),
              h('span',{className:'nv-home-task-action'},item.action,h('span',{'aria-hidden':true},' ↗'))))));
  };
}
