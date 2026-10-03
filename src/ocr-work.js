/* Explicit local OCR work files and bounded correction history. No storage,
   network, mapping writes, or recognition/semantic inference. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.BabelianOCRWork=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const FORMAT='ato-babelian-recognition-work',VERSION=1,MAX_BYTES=7*1024*1024;
  const copy=v=>JSON.parse(JSON.stringify(v));
  const plain=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  const int=(n,min,max)=>Number.isInteger(n)&&n>=min&&n<=max;
  const score=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1.000001;
  function box(b,width,height){
    if(!plain(b)||!int(b.x,0,width-1)||!int(b.y,0,height-1)||!int(b.width,1,width-b.x)||!int(b.height,1,height-b.y))throw Error('识别框超出图片或坐标不正确。');
    return {x:b.x,y:b.y,width:b.width,height:b.height};
  }
  function context(result,position){
    const row=result?.lines[position?.line],current=row?.tokens[position?.token];if(!current)return null;
    const tokens=row.tokens.slice(Math.max(0,position.token-1),position.token+2),boxes=tokens.map(t=>t.box);
    const pad=Math.max(3,Math.round(current.box.height*.12)),x=Math.max(0,Math.min(...boxes.map(b=>b.x))-pad),y=Math.max(0,Math.min(...boxes.map(b=>b.y))-pad);
    const right=Math.min(result.width,Math.max(...boxes.map(b=>b.x+b.width))+pad),bottom=Math.min(result.height,Math.max(...boxes.map(b=>b.y+b.height))+pad);
    return {box:{x,y,width:right-x,height:bottom-y},selected:{...current.box},neighbors:tokens.length-1};
  }
  function history({limit=40,maxBytes=12*1024*1024}={}){
    let undo=[],redo=[];
    const bytes=e=>2*(e.before.length+e.after.length);
    function trim(){while(undo.length>limit||undo.reduce((n,e)=>n+bytes(e),0)>maxBytes)undo.shift();}
    return {
      clear(){undo=[];redo=[];},
      state:()=>({undo:undo.length,redo:redo.length,undoLabel:undo.at(-1)?.label||'',redoLabel:redo.at(-1)?.label||''}),
      record(before,after,label){
        if(JSON.stringify(before.result)===JSON.stringify(after.result))return false;
        undo.push({before:JSON.stringify(before),after:JSON.stringify(after),label});redo=[];trim();return true;
      },
      undo(){const e=undo.pop();if(!e)return null;redo.push(e);return {state:JSON.parse(e.before),label:e.label};},
      redo(){const e=redo.pop();if(!e)return null;undo.push(e);return {state:JSON.parse(e.after),label:e.label};}
    };
  }
  function validate(value,ids){
    if(!plain(value)||value.format!==FORMAT||value.version!==VERSION)throw Error('不是受支持的巴别语识别工作文件。');
    const known=new Set(ids),s=value.source;
    if(!plain(s)||!int(s.width,1,12000)||!int(s.height,1,12000)||s.width*s.height>6000000||typeof s.name!=='string'||s.name.length>200||typeof s.png!=='string'||s.png.length>MAX_BYTES||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(s.png))throw Error('截图格式或尺寸不支持。');
    let header;try{header=atob(s.png.slice(22,66));}catch(_){throw Error('截图编码不正确。');}
    const byte=i=>header.charCodeAt(i),u32=i=>((byte(i)*0x1000000)+(byte(i+1)<<16)+(byte(i+2)<<8)+byte(i+3))>>>0;
    if(header.length<24||[137,80,78,71,13,10,26,10].some((n,i)=>byte(i)!==n)||u32(8)!==13||header.slice(12,16)!=='IHDR'||u32(16)!==s.width||u32(20)!==s.height)throw Error('截图 PNG 尺寸与工作文件不一致。');
    const crop=box(value.crop,s.width,s.height);
    let result=null,count=0,exclusions=0;
    if(value.result!==null){
      const r=value.result;
      if(!plain(r)||r.width!==crop.width||r.height!==crop.height||!['dark','light'].includes(r.polarity)||!int(r.threshold,0,254)||!Array.isArray(r.lines)||r.lines.length>800)throw Error('识别结果与框选区域不一致。');
      result={width:r.width,height:r.height,polarity:r.polarity,threshold:r.threshold,lines:r.lines.map(row=>{
        if(!plain(row)||!Array.isArray(row.tokens))throw Error('识别行格式不正确。');
        const rowBox=box(row.box,r.width,r.height);
        return {box:rowBox,tokens:row.tokens.map(t=>{
          if(++count>1500||!plain(t)||!(t.id===null||known.has(t.id))||typeof t.certain!=='boolean'||typeof t.manual!=='boolean'||(t.manual&&!t.id)||!score(t.score)||!Array.isArray(t.candidates)||t.candidates.length>10)throw Error('字形、确认状态或候选格式不正确。');
          const candidates=t.candidates.map(c=>{
            if(!plain(c)||!known.has(c.id)||!score(c.score)||c.nativeScore!==undefined&&!score(c.nativeScore))throw Error('工作文件包含未知或无效候选。');
            return {id:c.id,score:c.score,...(c.nativeScore!==undefined?{nativeScore:c.nativeScore}:{})};
          });
          if(t.excludedBoxes!==undefined&&!Array.isArray(t.excludedBoxes))throw Error('排除区域格式不正确。');
          const excludedBoxes=(t.excludedBoxes||[]).map(b=>{if(++exclusions>10000)throw Error('排除区域过多。');return box(b,r.width,r.height);});
          return {box:box(t.box,r.width,r.height),id:t.id,certain:t.certain,manual:t.manual,score:t.score,candidates,...(excludedBoxes.length?{excludedBoxes}:{})};
        })};
      })};
    }
    const settings=value.settings;
    if(!plain(settings)||!['auto','dark','light'].includes(settings.polarity)||!int(settings.threshold,0,254)||['single','detail','auto','join','formatEnabled','punctuate'].some(k=>typeof settings[k]!=='boolean')||typeof settings.extraWords!=='string'||settings.extraWords.length>3000)throw Error('识别或整理设置不正确。');
    const view=value.view;
    if(!plain(view)||['reviewOpen','pendingOnly','segmentationOpen'].some(k=>typeof view[k]!=='boolean'))throw Error('复核界面状态不正确。');
    let selected=null;
    if(view.selected!==null){const p=view.selected;if(!plain(p)||!int(p.line,0,(result?.lines.length||0)-1)||!int(p.token,0,result.lines[p.line].tokens.length-1)||!view.reviewOpen)throw Error('选中字形的位置无效。');selected={line:p.line,token:p.token};}
    let draft=null;
    if(value.draft!==null){
      const d=value.draft,p=d?.payload,o=d?.options;
      if(!result||!plain(d)||!plain(p)||typeof p.text!=='string'||p.text.length>80000||!Array.isArray(p.spans)||p.spans.length>1500||typeof d.value!=='string'||d.value.length>100000||typeof d.dirty!=='boolean'||!plain(o)||typeof o.punctuate!=='boolean'||!Array.isArray(o.extraWords)||o.extraWords.length>250||o.extraWords.some(w=>typeof w!=='string'||!/^[A-Za-z]{2,40}$/.test(w)))throw Error('整理草稿格式不正确。');
      let end=0;const spans=p.spans.map(span=>{
        if(!plain(span)||!known.has(span.glyph)||!int(span.start,end,p.text.length-1)||!int(span.end,span.start+1,p.text.length)||span.text!==p.text.slice(span.start,span.end)||span.end-span.start>40)throw Error('整理草稿的字形位置无效。');
        end=span.end;return {glyph:span.glyph,start:span.start,end:span.end,text:span.text};
      });
      draft={payload:{text:p.text,spans},options:{punctuate:o.punctuate,extraWords:[...o.extraWords]},value:d.value,dirty:d.dirty};
    }
    return {format:FORMAT,version:VERSION,source:{width:s.width,height:s.height,name:s.name,png:s.png},crop,result,
      settings:Object.fromEntries(['polarity','threshold','single','detail','auto','join','formatEnabled','punctuate','extraWords'].map(k=>[k,settings[k]])),
      view:{selected,reviewOpen:view.reviewOpen,pendingOnly:view.pendingOnly,segmentationOpen:view.segmentationOpen},draft};
  }
  function encode(value,ids){
    const text=JSON.stringify(validate({...value,format:FORMAT,version:VERSION},ids));
    if(new TextEncoder().encode(text).length>MAX_BYTES)throw Error('识别工作超过7MB；请用更小的截图重新开始。不会缩小当前图片或丢弃校正。');return text;
  }
  function parse(text,ids){
    if(typeof text!=='string'||text.length>MAX_BYTES||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('识别工作文件超过7MB。');
    let value;try{value=JSON.parse(text);}catch(_){throw Error('识别工作文件不是有效 JSON。');}return validate(value,ids);
  }
  return {FORMAT,VERSION,MAX_BYTES,context,history,validate,encode,parse};
});
