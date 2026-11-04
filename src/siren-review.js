/* Read-only source tracing and viewport helpers. No fitting or semantic recovery. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenReview=api;})(globalThis,function(){
  'use strict';
  const units=text=>[...text.matchAll(/\[\?\]|\[未映射\]|[A-Za-z0-9]/g)].map(m=>({value:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));
  const equal=(a,b)=>a.length===b.length&&a.every((u,i)=>u.value===b[i].value);
  function source(doc,analyze,C){
    const result=C.read(doc,analyze),spans=[];let text='';
    doc.groups.forEach((group,index)=>{
      if(index&&doc.mode==='review')text+=' ';
      const start=text.length,value=result.groups[index],all=C.ordered(group,analyze(group)),placed=doc.mode==='review'?all.filter(e=>e.at!==null):all;
      const printed=units(value);
      if(printed.length===placed.length)printed.forEach((u,i)=>spans.push({start:start+u.start,end:start+u.end,groupId:group.id,itemId:placed[i].item.id}));
      else if(value==='[?]'&&!placed.length)all.forEach(e=>spans.push({start,end:start+value.length,groupId:group.id,itemId:e.item.id}));
      text+=value;
    });
    const leading=doc.mode==='review'?text.length-text.trimStart().length:0;
    if(doc.mode==='review')text=text.trim();
    return {text,spans:spans.map(s=>({...s,start:s.start-leading,end:s.end-leading})).filter(s=>s.start>=0&&s.end<=text.length)};
  }
  function project(source,segmented,display,numbers){
    const raw=units(source.text),input=units(segmented);if(!equal(raw,input))return null;
    const trace=[],converted=numbers(segmented,trace),output=units(converted),shown=units(display);if(!equal(output,shown))return null;
    const spans=[];
    output.forEach((u,i)=>{
      const part=trace.find(p=>p.start<=u.start&&p.end>=u.end);if(!part)return;
      const from=part.atomic?part.sourceStart:part.sourceStart+u.start-part.start,to=part.atomic?part.sourceEnd:from+u.end-u.start;
      input.forEach((v,j)=>{if(v.start>=to||v.end<=from)return;for(const s of source.spans)if(s.start<raw[j].end&&s.end>raw[j].start)spans.push({...s,start:shown[i].start,end:shown[i].end});});
    });
    return {text:display,spans};
  }
  function locate(projection,start,end=start,word=true){
    if(!projection)return [];
    start=Math.max(0,Math.min(projection.text.length,start??0));end=Math.max(start,Math.min(projection.text.length,end??start));
    if(start===end){
      if(word){const m=[...projection.text.matchAll(/\[\?\]|\[未映射\]|[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g)].find(m=>start>=m.index&&start<m.index+m[0].length);if(!m)return [];start=m.index;end=start+m[0].length;}
      else end=start+1;
    }
    const found=new Map();for(const s of projection.spans)if(s.start<end&&s.end>start)found.set(s.groupId+'/'+s.itemId,{groupId:s.groupId,itemId:s.itemId});return [...found.values()];
  }
  function ranges(projection,selection){
    if(!projection)return [];
    const selected=new Set(selection.map(s=>s.groupId+'/'+s.itemId));return projection.spans.filter(s=>selected.has(s.groupId+'/'+s.itemId)).map(s=>({start:s.start,end:s.end}));
  }
  function point(event,rect){return {x:Math.max(0,Math.min(600,(event.clientX-rect.left)*600/rect.width)),y:Math.max(0,Math.min(600,(event.clientY-rect.top)*600/rect.height))};}
  function lensFrame(p,size=100){return {x:Math.max(0,Math.min(600-size,p.x-size/2)),y:Math.max(0,Math.min(600-size,p.y-size/2)),size};}
  return {source,project,locate,ranges,point,lensFrame};
});
