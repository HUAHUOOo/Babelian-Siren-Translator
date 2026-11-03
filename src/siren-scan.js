/* Offline worker transport. No dictionary, networking, or clipboard reads here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenScan=api;})(globalThis,function(){
  'use strict';
  function runWorker(){
    self.onmessage=event=>{
      try{
        const {templates,image,operation,limit=20,base,region,reuse}=event.data,engine=SirenRecognition.create(templates);
        const bitmap=engine.binarize(image);
        const report=p=>self.postMessage({progress:p});
        if(operation==='deep'){self.postMessage({result:engine.deepRegion(bitmap,base,region,{onProgress:report})});return;}
        const hints=reuse?.hints||(operation==='fit'?[null]:engine.detectGroups(bitmap,{onProgress:report}));
        if(hints.length>limit)throw Error('检测到的大螺旋过多，请拆成多张图片，分批识别。');
        self.postMessage({detected:hints});
        const groups=[];
        for(let i=0;i<hints.length;i++){
          report({stage:'group',progress:i/hints.length,index:i+1,count:hints.length});
          if(reuse?.groups&&Object.prototype.hasOwnProperty.call(reuse.groups,i)){
            const result=reuse.groups[i];if(result.base)groups.push(result);
            self.postMessage({partial:{group:result,index:i+1,count:hints.length,cached:true}});continue;
          }
          const hint=hints[i],box=hint?.bbox;
          const x=box?Math.max(0,Math.floor(box.x)):0,y=box?Math.max(0,Math.floor(box.y)):0;
          const width=box?Math.min(bitmap.width-x,Math.ceil(box.width)):bitmap.width,height=box?Math.min(bitmap.height-y,Math.ceil(box.height)):bitmap.height;
          const ink=new Float32Array(width*height);
          for(let row=0;row<height;row++)ink.set(bitmap.ink.subarray((y+row)*bitmap.width+x,(y+row)*bitmap.width+x+width),row*width);
          const result=engine.fitGroup({width,height,ink},hint?{...hint,cx:hint.cx-x,cy:hint.cy-y}:null,{onProgress:p=>report({...p,index:i+1,count:hints.length})});
          if(result.base){result.base.cx+=x;result.base.cy+=y;for(const item of result.items){item.x+=x;item.y+=y;for(const c of item.candidates){c.x+=x;c.y+=y;}}}
          if(result.base)groups.push(result);
          self.postMessage({partial:{group:result,index:i+1,count:hints.length,cached:false}});
        }
        self.postMessage({result:groups});
      }catch(e){self.postMessage({error:e.message||'图像匹配失败。'});}
    };
  }
  function workerSource(engineSource){return 'const SirenRecognition='+engineSource+';\n('+runWorker.toString()+')();';}
  // Page-memory only. Compare exact bytes, not a lossy hash or object identity.
  // ImageData exposes non-enumerable fields; normalize them explicitly below.
  function cacheKey(payload,budget){
    let bytes=0;const parts=[];
    function visit(v){
      if(v===null)return ['null'];
      if(typeof v!=='object'){
        if(!['string','number','boolean','undefined'].includes(typeof v))throw Error('Uncacheable');
        const value=typeof v==='number'&&Object.is(v,-0)?'-0':String(v);bytes+=value.length*2+16;if(bytes>budget)throw Error('Cache budget');return [typeof v,value];
      }
      if(ArrayBuffer.isView(v)){
        bytes+=v.byteLength+64;if(bytes>budget)throw Error('Cache budget');const i=parts.length;parts.push(new Uint8Array(v.buffer,v.byteOffset,v.byteLength).slice());return ['bytes',v.constructor.name,i];
      }
      if(Array.isArray(v))return ['array',Array.from(v,visit)];
      return ['object',Object.keys(v).map(k=>[k,visit(v[k])])];
    }
    try{
      const image=payload.image,normalized={...payload,image:{width:image.width,height:image.height,data:image.data}},description=JSON.stringify(visit(normalized));
      bytes+=description.length*2;if(bytes>budget)return null;return {description,parts,bytes};
    }catch(_){return null;}
  }
  function sameKey(a,b){return a.description===b.description&&a.parts.length===b.parts.length&&a.parts.every((p,n)=>{const q=b.parts[n];if(p.length!==q.length)return false;for(let i=0;i<p.length;i++)if(p[i]!==q[i])return false;return true;});}
  function clone(v){if(v===null||typeof v!=='object')return v;if(ArrayBuffer.isView(v))return v.slice();if(Array.isArray(v))return v.map(clone);return Object.fromEntries(Object.entries(v).map(([k,value])=>[k,clone(value)]));}
  function create({engineSource,onProgress=()=>{},WorkerClass=globalThis.Worker,cacheBytes=32*1024*1024,cacheEntries=3}={}){
    let active=null,hits=0,reusedGroups=0;const cache=[];
    cacheBytes=Math.max(0,Number.isFinite(cacheBytes)?cacheBytes:0);cacheEntries=Math.max(0,Math.floor(Number.isFinite(cacheEntries)?cacheEntries:0));
    const total=()=>cache.reduce((n,e)=>n+e.bytes,0);
    function trim(){while(cache.length&&(cache.length>cacheEntries||total()>cacheBytes))cache.shift();}
    function update(entry){if(!entry||!cache.includes(entry))return;entry.bytes=entry.key.bytes+JSON.stringify([entry.hints,entry.groups,entry.result]).length*2;trim();}
    function cancel(){if(!active)return;const old=active;active=null;old.worker.terminate();old.reject(Error('已取消识别；原有解读未改变。'));}
    function run(payload,{onGroup=()=>{}}={}){
      cancel();
      return new Promise((resolve,reject)=>{
        const key=cacheEntries&&cacheBytes?cacheKey(payload,cacheBytes):null;
        let entry=key?cache.find(e=>sameKey(key,e.key)):null;
        if(entry){cache.splice(cache.indexOf(entry),1);cache.push(entry);hits++;}
        else if(key){entry={key,groups:{},bytes:key.bytes};cache.push(entry);trim();}
        if(entry?.complete){
          let timer;const job={worker:{terminate(){clearTimeout(timer);}},reject};active=job;
          const slots=Object.keys(entry.groups),step=index=>{
            if(active!==job)return;
            try{
              if(index<slots.length){const slot=Number(slots[index]);reusedGroups++;onProgress({stage:'cached',progress:(index+1)/slots.length,index:slot+1,count:entry.hints?.length||slots.length});
                if(active!==job)return;onGroup({group:clone(entry.groups[slot]),index:slot+1,count:entry.hints?.length||slots.length,cached:true});
                if(active===job)timer=setTimeout(()=>step(index+1),0);
              }else {active=null;resolve(clone(entry.result));}
            }catch(e){if(active===job){active=null;reject(e);}}
          };timer=setTimeout(()=>step(0),0);return;
        }
        if(!WorkerClass){reject(Error('当前浏览器不支持本机后台识别，请使用支持 Web Worker 的浏览器。'));return;}
        let url,worker;
        try{url=URL.createObjectURL(new Blob([workerSource(engineSource)],{type:'text/javascript'}));worker=new WorkerClass(url);}catch(_){reject(Error('无法启动本机识别，请检查浏览器是否允许本地 Worker。'));return;}finally{if(url)URL.revokeObjectURL(url);}
        const job={worker,reject};active=job;
        const finish=(error,result)=>{if(active!==job)return;active=null;worker.terminate();if(error)reject(error);else resolve(result);};
        worker.onmessage=e=>{
          if(active!==job)return;
          try{
            if(e.data.progress)onProgress(e.data.progress);
            else if(e.data.detected){if(entry){entry.hints=clone(e.data.detected);update(entry);}}
            else if(e.data.partial){const p=e.data.partial;if(entry){entry.groups[p.index-1]=clone(p.group);update(entry);}if(p.cached)reusedGroups++;onGroup(p);}
            else if(e.data.error)finish(Error(e.data.error));
            else {if(entry){entry.result=clone(e.data.result);entry.complete=true;update(entry);}finish(null,e.data.result);}
          }catch(error){finish(error);}
        };
        worker.onerror=()=>finish(Error('本机识别进程失败；请换用较小图片后重试。'));
        try{worker.postMessage(entry?.hints?{...payload,reuse:{hints:entry.hints,groups:entry.groups}}:payload);}catch(e){finish(e);}
      });
    }
    return {run,cancel,clearCache:()=>cache.splice(0),cacheInfo:()=>({entries:cache.length,bytes:total(),maxBytes:cacheBytes,hits,reusedGroups})};
  }
  return {create,workerSource};
});
