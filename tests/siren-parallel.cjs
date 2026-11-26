/* Multi-Worker parallel SirenScan orchestration, ordering, cancellation,
 * fallback, and real multi-thread Worker equivalence test. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Worker:NodeWorker}=require('node:worker_threads');
const scanSource=fs.readFileSync(require.resolve('../src/siren-scan.js'),'utf8');
const F=require('./siren-fixture.cjs'),E=require('../src/siren-recognition.js'),C=require('../src/siren-core.js'),decodePNG=require('./png.cjs');
const decodeAlpha=a=>{const r=decodePNG(Buffer.from(a.src.split(',')[1],'base64'));return {width:r.width,height:r.height,pivotX:a.pivotX,pivotY:a.pivotY,alpha:Uint8Array.from({length:r.width*r.height},(_,i)=>r.data[i*4+3])};};
const sirenTemplates={base:decodeAlpha(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decodeAlpha(a)])),path:F.path};
const sirenEngine=E.create(sirenTemplates);
function renderSiren(group){
  const rec=sirenEngine.reconstruct({width:600,height:600,ink:new Float32Array(360000)},{cx:group.cx,cy:group.cy,size:group.baseSize,rotation:group.baseRotation},group.items.map(i=>({...i,rotation:C.rotationFor(group,i)})));
  return {width:600,height:600,data:Uint8ClampedArray.from({length:600*600*4},(_,i)=>i%4===3?255:Math.round(255*(1-rec.ink[i>>2])))};
}

const urls=new Map();let serial=0;
class BlobDouble{constructor(parts){this.source=parts.join('');}}
const scope={module:{exports:{}},Blob:BlobDouble,URL:{createObjectURL:b=>{const id=String(++serial);urls.set(id,b);return id;},revokeObjectURL:id=>urls.delete(id)},setTimeout,clearTimeout};
vm.runInNewContext(scanSource,scope);
const Scan=scope.module.exports;

// Deterministic out-of-order delays per slot (slot 3 finishes first, slot 0 fourth).
const delays=[28,12,34,4,40,18];
const engineSource=`({create:templates=>({
  binarize:image=>({width:image.width,height:image.height,ink:new Float32Array(image.width*image.height)}),
  detectGroups:bitmap=>{self.stats.detect++;return [0,1,2,3,4,5].map(i=>({cx:i*10+3,cy:3,size:5,rotation:0,bbox:{x:i*10,y:0,width:10,height:8}}));},
  fitGroup:(bitmap,hint)=>{
    self.stats.fit++;
    const slot=hint?Math.round((hint.cx+hint.bbox.x-3)/10):0;
    return {base:{cx:hint?.cx??3,cy:3,size:5,rotation:0},items:[{letter:String.fromCharCode(65+slot),x:4,y:4,size:2,rotation:0,score:.92,candidates:[{letter:String.fromCharCode(65+slot),x:4,y:4,size:2,rotation:0,score:.92}]}]};
  },
  deepRegion:()=>({candidates:[]})
})})`;

function makeWorkerClass(stats,{failAfter=Infinity}={}){
  return class ParallelWorkerDouble{
    constructor(url){
      if(stats.spawned>=failAfter)throw Error('worker limit');
      stats.spawned++;stats.alive++;this.dead=false;this.timers=[];this.queue=Promise.resolve();
      const self={stats,postMessage:msg=>{
        const copy=structuredClone(msg);
        const delay=copy.taskResult?delays[copy.taskResult.slot]:copy.primaryDone?delays[copy.partial.index-1]:2;
        this.timers.push(setTimeout(()=>{if(!this.dead)this.onmessage?.({data:copy});},delay));
      }};
      vm.runInNewContext(urls.get(url).source,{self,Float32Array});
      this.handle=self.onmessage;
    }
    postMessage(payload){
      const copy=structuredClone(payload);
      this.queue=this.queue.then(()=>new Promise(r=>{
        this.timers.push(setTimeout(()=>{if(!this.dead)this.handle({data:copy});r();},1));
      }));
    }
    terminate(){if(!this.dead){this.dead=true;stats.alive--;this.timers.forEach(clearTimeout);}}
  };
}

const input=()=>({operation:'detect',limit:20,image:{width:64,height:8,data:new Uint8ClampedArray(64*8*4).fill(255)},templates:{base:{width:3,height:4,pivotX:.5,data:new Uint8Array(48).fill(1)},letters:{},path:{points:[[0,1],[2,3]]}}});
const json=v=>JSON.parse(JSON.stringify(v));

// Real OS worker_threads adapter for multi-core equivalence + timing check.
class RealThreadWorker{
  constructor(url){
    const code=urls.get(url).source;
    const bootstrap=`const {parentPort}=require('node:worker_threads');
const self={postMessage:(m,t)=>{try{parentPort.postMessage(m,t);}catch(_){parentPort.postMessage(m);}}};
parentPort.on('message',data=>{if(self.onmessage)self.onmessage({data});});
${code}`;
    this.w=new NodeWorker(bootstrap,{eval:true});
    this.w.on('message',data=>this.onmessage?.({data}));
    this.w.on('error',err=>this.onerror?.(err));
  }
  postMessage(msg,transfers){
    if(transfers?.length){try{this.w.postMessage(msg,transfers);return;}catch(_){}}
    this.w.postMessage(msg);
  }
  terminate(){this.w.terminate();}
}

(async()=>{
  // 1. Out-of-order completion still emits strict sequential onGroup events and matches 1-worker output.
  const s1={spawned:0,alive:0,detect:0,fit:0},s4={spawned:0,alive:0,detect:0,fit:0};
  const seqScan=Scan.create({engineSource,WorkerClass:makeWorkerClass(s1),maxWorkers:1});
  const parScan=Scan.create({engineSource,WorkerClass:makeWorkerClass(s4),maxWorkers:4});
  const seqEvents=[],parEvents=[];
  const seqOut=await seqScan.run(input(),{onGroup:e=>seqEvents.push(e)});
  const parOut=await parScan.run(input(),{onGroup:e=>parEvents.push(e)});
  assert.equal(s1.spawned,1);assert.equal(s1.alive,0);
  assert.equal(s4.spawned,4,'Should spawn 4 workers for 6 groups');assert.equal(s4.alive,0,'All pool workers must terminate cleanly');
  assert.deepEqual(json(parOut),json(seqOut),'Parallel output must equal single-worker output');
  assert.deepEqual(parEvents.map(e=>e.index),[1,2,3,4,5,6],'onGroup preview events must emit in strict slot order');
  assert.deepEqual(json(parEvents),json(seqEvents),'Ordered preview payloads match single-worker mode');

  // 2. Single-group fit/deep still spawns only 1 worker even with maxWorkers=4.
  const sFit={spawned:0,alive:0,detect:0,fit:0};
  const fitScan=Scan.create({engineSource,WorkerClass:makeWorkerClass(sFit),maxWorkers:4});
  await fitScan.run({...input(),operation:'fit'});assert.equal(sFit.spawned,1);
  await fitScan.run({...input(),operation:'deep'});assert.equal(sFit.spawned,2);

  // 3. Cancellation mid-parallel-scan terminates all workers and preserves completed slots in cache for resume.
  const sCancel={spawned:0,alive:0,detect:0,fit:0};
  const cancelScan=Scan.create({engineSource,WorkerClass:makeWorkerClass(sCancel),maxWorkers:4});
  const q=input();
  await assert.rejects(cancelScan.run(q,{onGroup:e=>{if(e.index===1)cancelScan.cancel();}}),/已取消/);
  assert.equal(sCancel.alive,0,'All workers terminate immediately on cancel');
  const fitBefore=sCancel.fit,detectBefore=sCancel.detect,resumedEvents=[];
  const resumed=await cancelScan.run(q,{onGroup:e=>resumedEvents.push(e)});
  assert.equal(sCancel.detect,detectBefore,'Detection reused after parallel cancel');
  assert(sCancel.fit<fitBefore+6,'Completed parallel groups are reused on resume');
  assert.equal(resumedEvents[0].cached,true);
  assert.deepEqual(json(resumed),json(seqOut));assert.equal(sCancel.alive,0);

  // 4. Graceful fallback if extra helper workers fail to spawn.
  const sFallback={spawned:0,alive:0,detect:0,fit:0};
  const fbScan=Scan.create({engineSource,WorkerClass:makeWorkerClass(sFallback,{failAfter:1}),maxWorkers:4});
  const fbOut=await fbScan.run(input());
  assert.equal(sFallback.spawned,1);assert.equal(sFallback.alive,0);
  assert.deepEqual(json(fbOut),json(seqOut),'Worker 0 finishes queued tasks if extra spawns fail');

  // 5. Real multi-thread SirenRecognition equivalence on a synthetic 2-group image.
  const g1=C.fromText('AB').groups[0],g2=C.fromText('CD').groups[0];
  assert(F.geometry.arrange(g1));assert(F.geometry.arrange(g2));
  const w=1200,h=600,data=new Uint8ClampedArray(w*h*4).fill(255);
  const drawGroup=(group,ox)=>{
    const tile=renderSiren(group);
    for(let y=0;y<600;y++)for(let x=0;x<600;x++){
      const s=(y*600+x)*4,d=(y*w+ox+x)*4;
      data[d]=tile.data[s];data[d+1]=tile.data[s+1];data[d+2]=tile.data[s+2];data[d+3]=255;
    }
  };
  drawGroup(g1,0);drawGroup(g2,600);
  const realPayload={operation:'detect',limit:20,image:{width:w,height:h,data},templates:sirenTemplates};
  const t1=Date.now();
  const real1=await Scan.create({engineSource:E.workerSource(),WorkerClass:RealThreadWorker,maxWorkers:1,cacheBytes:0}).run(realPayload);
  const ms1=Date.now()-t1;
  const t2=Date.now();
  const real2=await Scan.create({engineSource:E.workerSource(),WorkerClass:RealThreadWorker,maxWorkers:2,cacheBytes:0}).run(realPayload);
  const ms2=Date.now()-t2;
  assert.equal(real1.length,2);
  assert.deepEqual(json(real2),json(real1),'Real multi-thread SirenRecognition output must match single-thread output bit-for-bit');
  console.log(`PASS parallel SirenScan: 4-worker work-stealing, strict ordered previews, cancel/resume, spawn-failure fallback, and real multi-thread equivalence (1-worker ${ms1}ms vs 2-worker ${ms2}ms).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
