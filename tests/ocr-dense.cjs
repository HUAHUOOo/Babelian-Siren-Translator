/* Image-only stress input; heavy overlap is not expected to be fully legible. */
const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{masks,draw}=require('./ocr.cjs'),{connected}=require('./ocr-touching.cjs');
const score=line=>line.tokens.reduce((s,t)=>s+t.score*t.box.width/line.box.height-.025,0)/line.tokens.reduce((s,t)=>s+t.box.width/line.box.height,0);
const iou=(a,b)=>{const n=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return n/(a.width*a.height+b.width*b.height-n||1);};
(async()=>{
 const ids=['Q','t','B','n','the','r','and','G','x','a','T','h'],source=connected(ids,48,-6),bytes=Buffer.from(source.data),events=[];
 for(const inverse of [false,true]){
  const image={...source,data:Uint8Array.from(source.data,(v,i)=>inverse&&i%4!==3?255-v:v)},frozen=Buffer.from(image.data),result=await OCR.recognize(image,masks,{},p=>events.push(p));
  const dense=result.lines.filter(l=>l.segmentation?.method==='dense-valleys');assert(dense.length>0,'Exercise stronger valley candidates');
  const mask=OCR.binarize(image,{threshold:result.threshold,polarity:result.polarity}),templates=OCR.prepareTemplates(masks);
  for(const line of dense){
   const native=OCR.recognizeLine(mask,line.box,templates),weak=OCR.recognizeLine(mask,line.box,templates,true);
   assert(score(line)>Math.max(score({box:line.box,tokens:native}),score({box:line.box,tokens:weak}))+.008,'Whole-row image quality must improve');
   for(const t of line.tokens){
    assert(Object.values(t.box).every(Number.isInteger));assert(t.box.x>=0&&t.box.y>=0&&t.box.x+t.box.width<=image.width&&t.box.y+t.box.height<=image.height);
    if(t.certain)assert(native.some(p=>p.certain&&p.id===t.id&&iou(p.box,t.box)>=.85),'A new cut cannot create automatic confirmation');
   }
  }
  assert.deepEqual(Buffer.from(image.data),frozen);
  const renamed=masks.map((m,i)=>({...m,id:'opaque-'+i})),map=new Map(masks.map((m,i)=>[m.id,renamed[i].id])),other=await OCR.recognize(image,renamed);
  assert.deepEqual(other.lines.map(l=>l.tokens.map(t=>[t.id,t.box,t.certain])),result.lines.map(l=>l.tokens.map(t=>[map.get(t.id)||null,t.box,t.certain])));
  assert((await OCR.recognize(image,masks,{detail:false})).lines.every(l=>!l.segmentation));
  const manual=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});assert.equal(manual.thresholdSearch,undefined);assert.equal(manual.threshold,result.threshold);
 }
 assert.deepEqual(Buffer.from(source.data),bytes);
 const tiny=await OCR.recognize(connected(ids,28,-3),masks);assert(tiny.lines.every(l=>l.segmentation?.method!=='dense-valleys'));
 const clean=await OCR.recognize(draw([ids],{height:56,gap:4}),masks);assert.deepEqual(clean.lines[0].tokens.map(t=>t.id),ids);assert(!clean.lines[0].segmentation);
 let cancelled=false;await assert.rejects(OCR.recognize(source,masks,{cancelled:()=>cancelled},()=>{cancelled=true;}),/取消/);
 console.log('PASS dense-valley alternatives: original/inverse, measurable whole-row improvement, conservative confirmation, opaque IDs, source integrity, native boxes, coarse/manual/tiny fallbacks, clean output and cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
