/* Page-memory bookkeeping only. Recognition and persisted work are untouched. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenMemory=api;})(globalThis,function(){
  'use strict';
  function createHistory({maxEntries=30,maxBytes=32*1024*1024}={}){
    const entries=[];let bytes=0;
    return {
      get length(){return entries.length;},
      push(doc){
        const json=JSON.stringify(doc),ids=doc.groups.map(g=>g.id),entry={json,ids,bytes:json.length*2+ids.reduce((n,id)=>n+id.length*2,0)};
        entries.push(entry);bytes+=entry.bytes;
        // Always retain the newest undo, including an unusually large work.
        while(entries.length>1&&(entries.length>maxEntries||bytes>maxBytes))bytes-=entries.shift().bytes;
      },
      peek:()=>entries.length?JSON.parse(entries.at(-1).json):null,
      pop(){const entry=entries.pop();if(entry)bytes-=entry.bytes;},
      groupIds:()=>entries.flatMap(e=>e.ids),
      stats:()=>({entries:entries.length,bytes,maxBytes,maxEntries,oversized:bytes>maxBytes})
    };
  }
  function createImageCache(decode,onSettled=()=>{}){
    const decoded=new Map(),pending=new Map(),pins=new Map();
    return {
      get:src=>decoded.get(src),has:src=>decoded.has(src),
      load(src){
        if(decoded.has(src))return Promise.resolve(decoded.get(src));
        if(pending.has(src))return pending.get(src);
        const job=Promise.resolve().then(()=>decode(src)).then(image=>{decoded.set(src,image);return image;}).finally(()=>{pending.delete(src);onSettled();});
        pending.set(src,job);return job;
      },
      pin(sources){
        const unique=[...new Set(sources)];for(const src of unique)pins.set(src,(pins.get(src)||0)+1);let released=false;
        return ()=>{if(released)return;released=true;for(const src of unique){const n=pins.get(src)-1;if(n)pins.set(src,n);else pins.delete(src);}};
      },
      prune(sources){const keep=new Set([...sources,...pins.keys()]);for(const src of decoded.keys())if(!keep.has(src))decoded.delete(src);return keep;},
      stats:()=>({decoded:decoded.size,pending:pending.size,pinned:pins.size})
    };
  }
  return {createHistory,createImageCache};
});
