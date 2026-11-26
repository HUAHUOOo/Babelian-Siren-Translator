/* Offline worker transport. No dictionary, networking, or clipboard reads here. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenScan=api;})(globalThis,function(){
  'use strict';
  function runWorker(){
    let cachedEngine=null;
    const send=(msg,transfers)=>{if(transfers?.length){try{self.postMessage(msg,transfers);return;}catch(_){}}self.postMessage(msg);};
    const fitTask=(engine,task,report)=>{
      const {slot,x,y,width,height,ink,hint,count}=task;
      const result=engine.fitGroup({width,height,ink},hint,{onProgress:p=>report({...p,index:slot+1,count})});
      if(result.base){result.base.cx+=x;result.base.cy+=y;for(const item of result.items){item.x+=x;item.y+=y;for(const c of item.candidates){c.x+=x;c.y+=y;}}}
      return result;
    };
    const sliceTask=(bitmap,hints,i)=>{
      const hint=hints[i],box=hint?.bbox;
      const x=box?Math.max(0,Math.floor(box.x)):0,y=box?Math.max(0,Math.floor(box.y)):0;
      const width=box?Math.min(bitmap.width-x,Math.ceil(box.width)):bitmap.width,height=box?Math.min(bitmap.height-y,Math.ceil(box.height)):bitmap.height;
      const ink=new Float32Array(width*height);
      for(let row=0;row<height;row++)ink.set(bitmap.ink.subarray((y+row)*bitmap.width+x,(y+row)*bitmap.width+x+width),row*width);
      return {slot:i,x,y,width,height,ink,hint:hint?{...hint,cx:hint.cx-x,cy:hint.cy-y}:null,count:hints.length};
    };
    self.onmessage=event=>{
      try{
        const data=event.data,report=p=>self.postMessage({progress:p});
        if(data.phase==='init'){cachedEngine=SirenRecognition.create(data.templates);return;}
        if(data.phase==='fit'){
          if(!cachedEngine)throw Error('并行识别进程尚未初始化。');
          const group=fitTask(cachedEngine,data.task,report);
          self.postMessage({taskResult:{slot:data.task.slot,group}});return;
        }
        const {templates,image,operation,limit=20,base,region,reuse,parallel=false}=data;
        cachedEngine=SirenRecognition.create(templates);
        const bitmap=cachedEngine.binarize(image);
        if(operation==='deep'){self.postMessage({result:cachedEngine.deepRegion(bitmap,base,region,{onProgress:report})});return;}
        const hints=reuse?.hints||(operation==='fit'?[null]:cachedEngine.detectGroups(bitmap,{onProgress:report}));
        if(hints.length>limit)throw Error('检测到的大螺旋过多，请拆成多张图片，分批识别。');
        self.postMessage({detected:hints});
        const pending=[];
        for(let i=0;i<hints.length;i++)if(!(reuse?.groups&&Object.prototype.hasOwnProperty.call(reuse.groups,i)))pending.push(i);
        if(parallel&&operation==='detect'&&pending.length>=2){
          const firstTask=sliceTask(bitmap,hints,pending[0]);
          const restTasks=pending.slice(1).map(i=>sliceTask(bitmap,hints,i));
          send({dispatch:{count:hints.length,tasks:restTasks}},restTasks.map(t=>t.ink.buffer));
          report({stage:'group',progress:0,index:firstTask.slot+1,count:hints.length});
          const firstResult=fitTask(cachedEngine,firstTask,report);
          self.postMessage({partial:{group:firstResult,index:firstTask.slot+1,count:hints.length,cached:false},primaryDone:true});
          return;
        }
        const groups=[];
        for(let i=0;i<hints.length;i++){
          report({stage:'group',progress:i/hints.length,index:i+1,count:hints.length});
          if(reuse?.groups&&Object.prototype.hasOwnProperty.call(reuse.groups,i)){
            const result=reuse.groups[i];if(result.base)groups.push(result);
            self.postMessage({partial:{group:result,index:i+1,count:hints.length,cached:true}});continue;
          }
          const result=fitTask(cachedEngine,sliceTask(bitmap,hints,i),report);
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
  function equalBytes(a,b){if(a===b)return true;if(a.length!==b.length)return false;for(let i=0;i<a.length;i++)if(a[i]!==b[i])return false;return true;}
  function byteBucket(bytes){
    let h=bytes.length>>>0;const step=Math.max(1,bytes.length>>6);
    for(let i=0;i<bytes.length;i+=step)h=(Math.imul(h^bytes[i],16777619))>>>0;
    return bytes.length+':'+h;
  }
  function createBytePool(){
    const buckets=new Map();let bytes=0;
    return {
      intern(view){
        const raw=new Uint8Array(view.buffer,view.byteOffset,view.byteLength),bucket=byteBucket(raw);
        const list=buckets.get(bucket);
        if(list)for(const item of list)if(equalBytes(item.bytes,raw))return item;
        return {bucket,bytes:raw.slice(),refs:0};
      },
      retain(parts){
        for(let i=0;i<parts.length;i++){
          let item=parts[i];
          if(!item.refs){
            let list=buckets.get(item.bucket),existing=list?.find(x=>equalBytes(x.bytes,item.bytes));
            if(existing){parts[i]=item=existing;}
            else{if(!list){list=[];buckets.set(item.bucket,list);}list.push(item);bytes+=item.bytes.byteLength+64;}
          }
          item.refs++;
        }
      },
      release(parts){
        for(const item of parts){
          if(--item.refs>0)continue;bytes-=item.bytes.byteLength+64;
          const list=buckets.get(item.bucket);if(!list)continue;
          const at=list.indexOf(item);if(at>=0)list.splice(at,1);if(!list.length)buckets.delete(item.bucket);
        }
      },
      clear(){buckets.clear();bytes=0;},
      bytes:()=>bytes
    };
  }
  function cacheKey(payload,budget,pool){
    let bytes=0,metaBytes=0;const parts=[];
    function visit(v){
      if(v===null)return ['null'];
      if(typeof v!=='object'){
        if(!['string','number','boolean','undefined'].includes(typeof v))throw Error('Uncacheable');
        const value=typeof v==='number'&&Object.is(v,-0)?'-0':String(v);const size=value.length*2+16;bytes+=size;metaBytes+=size;if(bytes>budget)throw Error('Cache budget');return [typeof v,value];
      }
      if(ArrayBuffer.isView(v)){
        bytes+=v.byteLength+64;if(bytes>budget)throw Error('Cache budget');const i=parts.length;parts.push(pool.intern(v));return ['bytes',v.constructor.name,i];
      }
      if(Array.isArray(v))return ['array',Array.from(v,visit)];
      return ['object',Object.keys(v).map(k=>[k,visit(v[k])])];
    }
    try{
      const image=payload.image,normalized={...payload,image:{width:image.width,height:image.height,data:image.data}},description=JSON.stringify(visit(normalized));
      bytes+=description.length*2;metaBytes+=description.length*2;if(bytes>budget)return null;return {description,parts,bytes,metaBytes};
    }catch(_){return null;}
  }
  function sameKey(a,b){return a.description===b.description&&a.parts.length===b.parts.length&&a.parts.every((p,n)=>equalBytes(p.bytes,b.parts[n].bytes));}
  function clone(v){if(v===null||typeof v!=='object')return v;if(ArrayBuffer.isView(v))return v.slice();if(Array.isArray(v))return v.map(clone);return Object.fromEntries(Object.entries(v).map(([k,value])=>[k,clone(value)]));}
  function create({engineSource,onProgress=()=>{},WorkerClass=globalThis.Worker,cacheBytes=32*1024*1024,cacheEntries=3,maxWorkers}={}){
    let active=null,hits=0,reusedGroups=0;const cache=[],pool=createBytePool();
    cacheBytes=Math.max(0,Number.isFinite(cacheBytes)?cacheBytes:0);cacheEntries=Math.max(0,Math.floor(Number.isFinite(cacheEntries)?cacheEntries:0));
    const hw=typeof globalThis.navigator!=='undefined'&&Number.isFinite(globalThis.navigator.hardwareConcurrency)?globalThis.navigator.hardwareConcurrency:1;
    const workerLimit=Math.max(1,Math.min(4,Math.floor(Number.isFinite(maxWorkers)?maxWorkers:hw)));
    const total=()=>pool.bytes()+cache.reduce((n,e)=>n+e.metaBytes,0);
    function trim(){while(cache.length&&(cache.length>cacheEntries||total()>cacheBytes))pool.release(cache.shift().key.parts);}
    function update(entry){if(!entry||!cache.includes(entry))return;entry.metaBytes=entry.key.metaBytes+JSON.stringify([entry.hints,entry.groups,entry.result]).length*2;trim();}
    function cancel(){if(!active)return;const old=active;active=null;old.worker.terminate();old.reject(Error('已取消识别；原有解读未改变。'));}
    function run(payload,{onGroup=()=>{}}={}){
      cancel();
      return new Promise((resolve,reject)=>{
        const key=cacheEntries&&cacheBytes?cacheKey(payload,cacheBytes,pool):null;
        let entry=key?cache.find(e=>sameKey(key,e.key)):null;
        if(entry){cache.splice(cache.indexOf(entry),1);cache.push(entry);hits++;}
        else if(key){entry={key,groups:{},metaBytes:key.metaBytes};pool.retain(key.parts);cache.push(entry);trim();}
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
        const source=workerSource(engineSource),spawn=()=>{
          let url;
          try{url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));return new WorkerClass(url);}
          finally{if(url)URL.revokeObjectURL(url);}
        };
        const post=(w,msg,transfers)=>{if(transfers?.length){try{w.postMessage(msg,transfers);return;}catch(_){}}w.postMessage(msg);};
        let worker;
        try{worker=spawn();}catch(_){reject(Error('无法启动本机识别，请检查浏览器是否允许本地 Worker。'));return;}
        const workers=[worker];
        const terminateAll=()=>{for(const w of workers)try{w.terminate();}catch(_){}};
        const job={worker:{terminate:terminateAll},reject};active=job;
        const finish=(error,result)=>{if(active!==job)return;active=null;terminateAll();if(error)reject(error);else resolve(result);};
        const useParallel=workerLimit>1&&payload.operation==='detect';
        let parallel=false,totalCount=0,nextEmit=0,queue=[],slotResults=null,doneSlots=null,cachedSlots=null;
        const dispatchNext=w=>{
          if(active!==job||!queue.length)return;
          const task=queue.shift();
          post(w,{phase:'fit',task},[task.ink.buffer]);
        };
        const flushOrdered=()=>{
          while(active===job&&nextEmit<totalCount&&doneSlots.has(nextEmit)){
            const slot=nextEmit++,isCached=cachedSlots.has(slot);
            if(isCached)reusedGroups++;
            onGroup({group:clone(slotResults[slot]),index:slot+1,count:totalCount,cached:isCached});
          }
          if(active===job&&doneSlots.size===totalCount){
            const groups=[];
            for(let i=0;i<totalCount;i++)if(slotResults[i]?.base)groups.push(slotResults[i]);
            if(entry){entry.result=clone(groups);entry.complete=true;update(entry);}
            finish(null,groups);
          }
        };
        const completeSlot=(slot,group,w)=>{
          if(active!==job)return;
          slotResults[slot]=group;doneSlots.add(slot);
          if(entry){entry.groups[slot]=clone(group);update(entry);}
          flushOrdered();
          if(active===job&&doneSlots.size<totalCount){
            onProgress({stage:'group',progress:doneSlots.size/totalCount,index:doneSlots.size,count:totalCount,parallel:workers.length});
            dispatchNext(w);
          }
        };
        const attachHelper=w=>{
          w.onmessage=e=>{
            if(active!==job)return;
            try{
              if(e.data.progress){if(doneSlots&&doneSlots.size<totalCount)onProgress({...e.data.progress,parallel:workers.length});}
              else if(e.data.error)finish(Error(e.data.error));
              else if(e.data.taskResult)completeSlot(e.data.taskResult.slot,e.data.taskResult.group,w);
            }catch(error){finish(error);}
          };
          w.onerror=()=>finish(Error('本机识别进程失败；请换用较小图片后重试。'));
        };
        worker.onmessage=e=>{
          if(active!==job)return;
          try{
            if(e.data.progress)onProgress(parallel?{...e.data.progress,parallel:workers.length}:e.data.progress);
            else if(e.data.detected){if(entry){entry.hints=clone(e.data.detected);update(entry);}}
            else if(e.data.dispatch){
              parallel=true;totalCount=e.data.dispatch.count;queue=e.data.dispatch.tasks.slice();
              slotResults=new Array(totalCount);doneSlots=new Set();cachedSlots=new Set();
              if(entry?.groups){
                for(const k of Object.keys(entry.groups)){
                  const slot=Number(k);
                  if(Number.isInteger(slot)&&slot>=0&&slot<totalCount){slotResults[slot]=clone(entry.groups[slot]);doneSlots.add(slot);cachedSlots.add(slot);}
                }
              }
              flushOrdered();
              if(active!==job)return;
              const extra=Math.min(workerLimit,queue.length+1)-1;
              for(let i=0;i<extra;i++){
                let helper;
                try{helper=spawn();}catch(_){break;}
                workers.push(helper);attachHelper(helper);
                helper.postMessage({phase:'init',templates:payload.templates});
                dispatchNext(helper);
              }
            }else if(e.data.primaryDone){
              completeSlot(e.data.partial.index-1,e.data.partial.group,worker);
            }else if(e.data.taskResult){
              completeSlot(e.data.taskResult.slot,e.data.taskResult.group,worker);
            }else if(e.data.partial){
              const p=e.data.partial;if(entry){entry.groups[p.index-1]=clone(p.group);update(entry);}if(p.cached)reusedGroups++;onGroup(p);
            }else if(e.data.error)finish(Error(e.data.error));
            else {if(entry){entry.result=clone(e.data.result);entry.complete=true;update(entry);}finish(null,e.data.result);}
          }catch(error){finish(error);}
        };
        worker.onerror=()=>finish(Error('本机识别进程失败；请换用较小图片后重试。'));
        try{
          const msg=entry?.hints?{...payload,reuse:{hints:entry.hints,groups:entry.groups}}:{...payload};
          if(useParallel)msg.parallel=true;
          worker.postMessage(msg);
        }catch(e){finish(e);}
      });
    }
    return {run,cancel,clearCache:()=>{cache.splice(0);pool.clear();},cacheInfo:()=>({entries:cache.length,bytes:total(),maxBytes:cacheBytes,hits,reusedGroups,maxWorkers:workerLimit})};
  }
  return {create,workerSource};
});
