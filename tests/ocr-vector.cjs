/* Generic, generated shape tests. No extracted fonts or story passages. */
const assert=require('node:assert/strict'),vm=require('node:vm');
const OCR=require('../src/ocr-engine.js'),{masks,draw}=require('./ocr.cjs');
function legacyDescriptor(mask,box=OCR.bounds(mask),detail=true){
 if(!box)return null;
 function sample(size){
  const stride=size>>>5,rows=new Uint32Array(size*stride),wide=new Uint32Array(size*stride);let count=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
   let ink=0;for(const dy of [.25,.75])for(const dx of [.25,.75]){
    const sx=Math.min(mask.width-1,Math.floor(box.x+(x+dx)*box.width/size)),sy=Math.min(mask.height-1,Math.floor(box.y+(y+dy)*box.height/size));ink+=mask.data[sy*mask.width+sx];
   }
   if(ink>=2){rows[y*stride+(x>>>5)]|=1<<(x&31);count++;}
  }
  for(let y=0;y<size;y++)for(let half=0;half<stride;half++){
   const at=y*stride+half,r=rows[at]|(rows[at-stride]||0)|(rows[at+stride]||0);
   wide[at]=r|(r<<1)|(r>>>1);
   if(stride===2){
    const next=rows[y*2+1-half]|(rows[(y-1)*2+1-half]||0)|(rows[(y+1)*2+1-half]||0);
    wide[at]|=half?next>>>31:next<<31;
   }
  }
  return {rows,wide,count};
 }
 return {...sample(32),ratio:box.width/box.height,...(detail?{fine:sample(64)}:{})};
}
function pack(id,mask,height){
 const d=OCR.describe(mask),json=x=>({rows:Array.from(x.rows),wide:Array.from(x.wide),count:x.count});
 return {id,targetHeight:height,ratio:d.ratio,...json(d),fine:json(d.fine)};
}
async function run(){
 let checked=0;
 for(const mask of masks)for(const detail of [true,false]){
  const b=OCR.bounds(mask);
  for(const box of [b,{x:0,y:0,width:mask.width,height:mask.height},{...b,width:Math.max(1,b.width-2)}]){
   assert.deepEqual(OCR.describe(mask,box,detail),legacyDescriptor(mask,box,detail));checked++;
  }
 }
 let state=95123;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
 for(let i=0;i<100;i++){
  const width=1+Math.floor(random()*180),height=1+Math.floor(random()*180),mask={width,height,data:Uint8Array.from({length:width*height},()=>random()<.3?1:0)};
  assert.deepEqual(OCR.describe(mask),legacyDescriptor(mask));checked++;
 }
 const mask=masks[0],other=masks[1],twins=[{...mask,id:'primary'},{...mask,id:'rescue'}],image=draw([[mask.id]],{height:64,gap:4});
 const profile={version:1,variants:[pack('primary',other,40),pack('primary',other,80),pack('rescue',mask,40),pack('rescue',mask,80)]};
 assert.equal(OCR.prepareVectorProfile(profile,['primary','rescue']).size,2);
 const before=await OCR.recognize(image,twins),after=await OCR.recognize(image,twins,{vectorProfile:profile});
 assert.equal(before.lines[0].tokens[0].id,'primary');
 assert.equal(after.lines[0].tokens[0].id,'rescue');
 assert.equal(after.vectorReview.changed,1);
 assert.deepEqual(after.lines[0].tokens[0].box,before.lines[0].tokens[0].box);
 assert.equal(after.lines[0].tokens[0].certain,false);
 assert.equal(after.lines[0].tokens[0].candidates[0].id,'rescue');
 const certain=await OCR.recognize(image,[twins[0]],{vectorProfile:{version:1,variants:profile.variants.filter(v=>v.id==='primary')}});
 assert.equal(certain.lines[0].tokens[0].certain,true);assert.equal(certain.vectorReview.changed,0);
 const manual=await OCR.recognize(image,twins,{threshold:127,vectorProfile:profile});assert(!manual.vectorReview);assert.equal(manual.lines[0].tokens[0].id,'primary');
 const coarse=await OCR.recognize(image,twins,{detail:false,vectorProfile:profile});assert(!coarse.vectorReview);
 const oneSize={version:1,variants:profile.variants.filter(v=>v.targetHeight===40)};
 assert.equal((await OCR.recognize(image,twins,{vectorProfile:oneSize})).vectorReview.changed,0);
 const incomplete={version:1,variants:profile.variants.filter(v=>v.id==='rescue')};
 assert.equal((await OCR.recognize(image,twins,{vectorProfile:incomplete})).vectorReview.changed,0,'Missing competing templates must not be treated as negative evidence.');
 for(const invalid of [{}, {...profile,version:2},{version:1,variants:[...profile.variants,profile.variants[0]]},{version:1,variants:[{...profile.variants[0],count:1}]},{version:1,variants:[{...profile.variants[0],id:'unknown'}]},{version:1,variants:[{...profile.variants[0],ratio:NaN}]},{version:1,variants:[{...profile.variants[0],rows:[-1]}]}])assert.throws(()=>OCR.prepareVectorProfile(invalid,['primary','rescue']),/矢量辅助模板/);
 const messages=[],context={setTimeout,postMessage:v=>messages.push(v)};vm.createContext(context);vm.runInContext(OCR.workerSource(),context);
 await context.onmessage({data:{image,templates:twins,options:{vectorProfile:profile}}});
 assert(!messages.at(-1).error);assert.equal(messages.at(-1).result.lines[0].tokens[0].id,'rescue');
 // The same mask object can be edited by correction code. No stale cache.
 const edited={...mask,data:mask.data.slice()},a=OCR.describe(edited);edited.data.fill(0);assert.equal(OCR.describe(edited),null);assert(a.count>0);
 console.log(`PASS fast/vector OCR: ${checked} exact descriptor comparisons; shape-only rescue; 2 resolutions/2 thresholds; no boundary/confidence promotion; worker; validation; in-place mask edits.`);
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={legacyDescriptor,pack,run};
