/* Deterministic transport/cache protocol tests. No recognition accuracy claim. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/siren-scan.js'),'utf8');
const urls=new Map(),stats={workers:0,detect:0,fit:0};let serial=0;
class BlobDouble{constructor(parts){this.source=parts.join('');}}
class InlineWorker{
 constructor(url){stats.workers++;this.timers=[];this.dead=false;let sequence=0;
  const self={stats,postMessage:message=>{const copy=structuredClone(message);this.timers.push(setTimeout(()=>{if(!this.dead)this.onmessage?.({data:copy});},++sequence*2));}};
  vm.runInNewContext(urls.get(url).source,{self,Float32Array});this.handle=self.onmessage;
 }
 postMessage(payload){const copy=structuredClone(payload);this.timers.push(setTimeout(()=>{if(!this.dead)this.handle({data:copy});},0));}
 terminate(){this.dead=true;this.timers.forEach(clearTimeout);}
}
const scope={module:{exports:{}},Blob:BlobDouble,URL:{createObjectURL:b=>{const id=String(++serial);urls.set(id,b);return id;},revokeObjectURL:id=>urls.delete(id)},setTimeout,clearTimeout};
vm.runInNewContext(source,scope);const Scan=scope.module.exports;
const engineSource=`({create:templates=>({binarize:image=>({width:image.width,height:image.height,ink:new Float32Array(image.width*image.height)}),detectGroups:bitmap=>{self.stats.detect++;return [0,1,2].map(i=>({cx:i*10+3,cy:3,size:5,rotation:0,bbox:{x:i*10,y:0,width:10,height:8}}));},fitGroup:(bitmap,hint)=>{self.stats.fit++;return {base:{cx:hint?.cx??3,cy:3,size:5,rotation:0},items:[{letter:'A',x:4,y:4,size:2,rotation:0,score:.91,candidates:[{letter:'A',x:4,y:4,size:2,rotation:0,score:.91}]}],diagnostics:{ok:true}};},deepRegion:()=>({candidates:[]})})})`;
const input=()=>({operation:'detect',limit:20,image:{width:32,height:8,data:new Uint8ClampedArray(32*8*4).fill(255)},templates:{base:{width:3,height:4,pivotX:.5,data:new Uint8Array(48).fill(1)},letters:{},path:{points:[[0,1],[2,3]]}}});
const json=v=>JSON.parse(JSON.stringify(v));
(async()=>{
 const scan=Scan.create({engineSource,WorkerClass:InlineWorker}),p=input(),before=structuredClone(p),events=[];
 const first=await scan.run(p,{onGroup:e=>events.push(json(e))});assert.equal(events.length,3);assert.equal(events[0].group.base.cx,3);assert.equal(events[2].group.base.cx,23);assert.equal(events[2].group.items[0].candidates[0].x,24);assert(events.every(e=>!e.cached));assert.deepEqual(p,before);
 const workers=stats.workers,fit=stats.fit;first[0].items[0].letter='Z';events[0].group.items[0].letter='Z';
 const replay=[];const second=await scan.run(p,{onGroup:e=>replay.push(json(e))});assert.equal(stats.workers,workers);assert.equal(stats.fit,fit);assert(replay.every(e=>e.cached));assert.equal(second[0].items[0].letter,'A');assert.equal(second.length,3);
 const again=await scan.run(p);assert.deepEqual(json(again),json(second));second[0].base.cx=99;assert.equal((await scan.run(p))[0].base.cx,3,'Returned results are private copies');
 const invalidations=[q=>{q.image.data[0]=254;},q=>{q.templates.base.data[1]=2;},q=>{q.templates.base.pivotX=.4;},q=>{q.templates.path.points[0][0]=1;},q=>{q.limit=19;},q=>{q.operation='fit';},q=>{q.extraOption=true;}];
 for(const change of invalidations){const q=input();change(q);const count=stats.workers;await scan.run(q);assert.equal(stats.workers,count+1,'Every changed byte/option/template must miss');}
 const mut=input();await scan.run(mut);const count=stats.workers;mut.image.data[4]=7;await scan.run(mut);assert.equal(stats.workers,count+1,'In-place edits invalidate, not just reference changes');
 // Non-enumerable ImageData fields still participate in the exact cache key.
 const non=input();non.image=Object.defineProperties({},Object.fromEntries(Object.entries(non.image).map(([key,value])=>[key,{value,writable:true}])));await scan.run(non);const n=stats.workers;non.image.width=31;await scan.run(non);assert.equal(stats.workers,n+1);
 const resume=Scan.create({engineSource,WorkerClass:InlineWorker}),q=input();let seen=0;
 await assert.rejects(resume.run(q,{onGroup:()=>{seen++;resume.cancel();}}),/已取消/);assert.equal(seen,1);const d=stats.detect,f=stats.fit,resumed=[];
 const rest=await resume.run(q,{onGroup:e=>resumed.push(json(e))});assert.equal(stats.detect,d,'Completed detection is reused after cancellation');assert.equal(stats.fit,f+2,'Only the two unfinished groups are fitted again');assert.deepEqual(resumed.map(e=>e.cached),[true,false,false]);assert.equal(rest.length,3);
 let replayed=0;await assert.rejects(resume.run(q,{onGroup:()=>{replayed++;resume.cancel();}}),/已取消/);await new Promise(r=>setTimeout(r,15));assert.equal(replayed,1,'Cached replay is asynchronous and cancellable');
 const bounded=Scan.create({engineSource,WorkerClass:InlineWorker,cacheBytes:18000,cacheEntries:2});for(let i=0;i<5;i++){const a=input();a.image.data[0]=i;await bounded.run(a);const info=bounded.cacheInfo();assert(info.entries<=2);assert(info.bytes<=info.maxBytes);}bounded.clearCache();assert.equal(bounded.cacheInfo().bytes,0);
 const off=Scan.create({engineSource,WorkerClass:InlineWorker,cacheBytes:1}),start=stats.workers;await off.run(input());await off.run(input());assert.equal(stats.workers,start+2);assert.equal(off.cacheInfo().entries,0);
 const limited=Scan.create({engineSource,WorkerClass:InlineWorker});await assert.rejects(limited.run({...input(),limit:2}),/过多/);
 const deep=await limited.run({...input(),operation:'deep'});assert.deepEqual(json(deep),{candidates:[]});assert.deepEqual(json(await limited.run({...input(),operation:'deep'})),{candidates:[]});
 console.log('PASS progressive worker/cache: ordered full-coordinate events, unchanged final results and inputs, copy isolation, exact pixel/template/options invalidation, ImageData, cancellation/resume, bounded memory/LRU, opt-out and deep/error paths.');
})().catch(e=>{console.error(e);process.exitCode=1;});
