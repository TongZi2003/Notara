export const PDF_MARK_COLORS = { yellow: '#eab308', green: '#22a06b', blue: '#3b82f6', pink: '#d94694' };
const colorNames = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色' };
const problem = error => {
  const message=String(error?.message??error?.code??'');
  if(/pdf_revision_conflict/.test(message))return 'PDF 已变化，请重新打开原文件。旧标注不会自动套到新页面。';
  if(/annotations_conflict/.test(message))return '标注已在别处修改，请刷新标注后再试；当前批注文字仍保留。';
  if(/layer_not_empty/.test(message))return '这个图层仍有标注，请先处理标注。';
  return '标注未保存，请检查文件后重试。';
};

export function createPdfAnnotations(React,{STYLE,IconButton}) {
  const h=React.createElement;
  return function usePdfAnnotations({vault,asset,page,selection,onSelect,onNavigate,initialRegion}) {
    const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
    const [panel,setPanel]=React.useState(false),[hidden,setHidden]=React.useState(new Set()),[layerId,setLayerId]=React.useState('default');
    const [note,setNote]=React.useState(''),[newLayer,setNewLayer]=React.useState(''),[newColor,setNewColor]=React.useState('yellow');
    const referenceStale=!!initialRegion?.revision&&initialRegion.revision!==asset.revision;
    const opened=React.useRef(false),mounted=React.useRef(true),operation=React.useRef(false),loadSequence=React.useRef(0);
    React.useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
    const refresh=React.useCallback(async()=>{
      const sequence=++loadSequence.current;
      try {const result=await vault.pdfAnnotations({path:asset.path});if(!result.ok)throw result.error;if(mounted.current&&sequence===loadSequence.current){setData(result.value);setError('');}}
      catch(error){if(mounted.current)setError(problem(error));}
    },[vault,asset.path,asset.revision]);
    React.useEffect(()=>{void refresh();},[refresh]);
    const pick=mark=>{
      setLayerId(mark.layerId);setNote(mark.note);setPanel(true);
      setHidden(previous=>{const next=new Set(previous);next.delete(mark.layerId);return next;});
      onNavigate(mark.page);onSelect({page:mark.page,rect:mark.rect,annotationId:mark.id,note:mark.note});
    };
    React.useEffect(()=>{
      if(!data||opened.current||!initialRegion?.annotationId)return;
      opened.current=true;
      const mark=data.annotations.find(mark=>mark.id===initialRegion.annotationId);
      if(mark&&!data.stale&&!referenceStale)pick(mark);
      else setError(data.stale?'PDF 已变化，原标注位置仅供核对。':'原标注已移除，仍显示卡片保存的区域位置。');
    },[data,initialRegion?.annotationId]);
    React.useEffect(()=>{if(!selection?.annotationId)setNote('');},[selection?.annotationId]);
    const mutate=async change=>{
      if(operation.current||!data||data.stale||referenceStale)return null;
      operation.current=true;setBusy(true);setError('');
      ++loadSequence.current;
      try{
        const result=await vault.updatePdfAnnotations({path:asset.path,expectedRevision:data.revision,expectedPdfRevision:data.pdfRevision,...change});
        if(!result.ok)throw result.error;
        if(mounted.current)setData(result.value);
        return result.value;
      }catch(error){if(mounted.current)setError(problem(error));return null;}
      finally{operation.current=false;if(mounted.current)setBusy(false);}
    };
    const saveSelection=async()=>{
      if(!selection||selection.rect[2]<=0||selection.rect[3]<=0)return;
      const known=data?.annotations.find(mark=>mark.id===selection.annotationId);
      const next=await mutate({action:known?'update-annotation':'add-annotation',...(known?{annotationId:known.id}:{}),layerId,page:selection.page,rect:selection.rect,note});
      if(next){const mark=known?next.annotations.find(mark=>mark.id===known.id):next.annotations.at(-1);if(mark){pick(mark);return mark;}}
      return null;
    };
    const active=data?.layers.find(layer=>layer.id===layerId)??data?.layers[0];
    React.useEffect(()=>{if(active&&active.id!==layerId)setLayerId(active.id);},[active?.id,layerId]);
    const disabled=busy||!data||data.stale||referenceStale;
    const current=data?.annotations.find(mark=>mark.id===selection?.annotationId);
    const overlay=data&&!data.stale?data.annotations.filter(mark=>mark.page===page&&!hidden.has(mark.layerId)).map(mark=>{
      const color=PDF_MARK_COLORS[data.layers.find(layer=>layer.id===mark.layerId)?.color]??PDF_MARK_COLORS.yellow;
      return h('button',{key:mark.id,type:'button','data-annotation':mark.id,'aria-label':mark.note||`第 ${mark.page} 页高亮`,title:mark.note||'查看标注',onPointerDown:event=>event.stopPropagation(),onClick:event=>{event.stopPropagation();pick(mark);},style:{position:'absolute',left:mark.rect[0]*100+'%',top:mark.rect[1]*100+'%',width:mark.rect[2]*100+'%',height:mark.rect[3]*100+'%',zIndex:3,padding:0,cursor:'pointer',border:`${current?.id===mark.id?2:1}px solid ${color}`,background:`color-mix(in srgb,${color} 22%,transparent)`,borderRadius:2}});
    }):null;
    const panelView=panel&&h('aside',{className:'nv-pdf-annotations','aria-label':'PDF 图层与标注'},
      h('div',{style:{display:'flex',alignItems:'center',justifyContent:'space-between'}},h('span',null,'图层与标注'),h(IconButton,{icon:'close',label:'收起标注面板',onClick:()=>setPanel(false)})),
      error&&h('p',{role:'alert',style:STYLE.notice},error),
      data?.stale&&h('p',{role:'alert',style:STYLE.notice},'PDF 已更新，旧标注暂不叠加。请核对原文件版本。'),
      !data?h('p',null,'正在读取标注…'):data.layers.map(layer=>h('div',{key:layer.id,style:{display:'flex',alignItems:'center',gap:6,marginTop:8}},
        h('input',{type:'checkbox','aria-label':'显示图层 '+layer.name,checked:!hidden.has(layer.id),onChange:event=>setHidden(previous=>{const next=new Set(previous);event.target.checked?next.delete(layer.id):next.add(layer.id);return next;})}),
        h('button',{style:{...STYLE.link,flex:1,textAlign:'left',color:PDF_MARK_COLORS[layer.color],textDecoration:layerId===layer.id?'underline':'none'},'aria-pressed':layerId===layer.id,onClick:()=>setLayerId(layer.id)},layer.name),
        h(IconButton,{icon:'trash',label:'删除空图层 '+layer.name,disabled:disabled||data.layers.length===1||data.annotations.some(mark=>mark.layerId===layer.id),onClick:()=>mutate({action:'remove-layer',layerId:layer.id})}))),
      h('form',{style:{display:'flex',gap:4,marginTop:12},onSubmit:async event=>{event.preventDefault();const next=await mutate({action:'add-layer',name:newLayer.trim(),color:newColor});if(next){setLayerId(next.layers.at(-1).id);setNewLayer('');}}},
        h('input',{'aria-label':'新图层名称',placeholder:'新图层',maxLength:80,style:{...STYLE.templateInput,minWidth:0,margin:0},value:newLayer,onChange:event=>setNewLayer(event.target.value)}),
        h('select',{'aria-label':'图层颜色',value:newColor,onChange:event=>setNewColor(event.target.value)},Object.entries(colorNames).map(([value,label])=>h('option',{key:value,value},label))),
        h('button',{style:STYLE.quiet,disabled:disabled||!newLayer.trim(),type:'submit'},'+')),
      selection&&h('section',{style:{marginTop:18}},
        h('small',null,`第 ${selection.page} 页 · ${active?.name??'图层'}`),
        h('textarea',{'aria-label':'批注',placeholder:'写下问题、思路或说明…',maxLength:4000,rows:4,style:{...STYLE.templateInput,resize:'vertical',marginTop:8},value:note,onChange:event=>setNote(event.target.value)}),
        h('div',{style:{display:'flex',gap:6}},h('button',{style:STYLE.quiet,disabled,onClick:saveSelection},current?'保存批注':'保存高亮'),
          current&&h('button',{style:STYLE.quiet,disabled,onClick:async()=>{if(await mutate({action:'remove-annotation',annotationId:current.id})){onSelect(undefined);setNote('');}}},'删除标注'))),
      h('div',{style:{marginTop:20}},h('small',null,'本页标注'),
        data?.annotations.filter(mark=>mark.page===page).map(mark=>h('button',{key:mark.id,style:{...STYLE.row,marginTop:4},onClick:()=>pick(mark)},mark.note||'未填写批注的高亮'))),
      h('button',{style:{...STYLE.link,marginTop:16},disabled:busy,onClick:refresh},'刷新标注'));
    return {overlay,panel:panelView,toolbar:h(IconButton,{icon:'layers',label:'图层与标注','aria-pressed':panel,onClick:()=>setPanel(value=>!value)}),saveSelection,disabled,note,
      openPanel:()=>setPanel(true),error,selected:current,open:pick};
  };
}
