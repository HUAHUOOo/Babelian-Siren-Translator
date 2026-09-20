const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{masks,draw}=require('./ocr.cjs');
function blur(image){
 const data=new Uint8Array(image.data.length);
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++)for(let c=0;c<4;c++){
  let sum=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=image.data[(Math.max(0,Math.min(image.height-1,y+j))*image.width+Math.max(0,Math.min(image.width-1,x+i)))*4+c]*(i?1:2)*(j?1:2);
  data[(y*image.width+x)*4+c]=Math.round(sum/16);
 }return {...image,data};
}
(async()=>{
 const ids=masks.map(m=>m.id),lines=[ids.slice(0,19),ids.slice(19,38),ids.slice(38)];
 // Sharp inputs must not gain invented shades or new segmentation errors.
 for(const height of [30,32,34,36,38]){
  const image=draw(lines,{height,gap:1}),result=await OCR.recognize(image,masks),native=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});
  assert.equal(result.samplingRefinement?.rows,0);assert.deepEqual(result.lines,native.lines);
 }
 const input=blur(draw([ids.slice(0,10)],{height:34,gap:3})),bytes=Buffer.from(input.data),events=[];
 const result=await OCR.recognize(input,masks,{},p=>events.push(p));assert(events.some(p=>p.pass===2),'Exercise soft-edge refinement');assert.deepEqual(Buffer.from(input.data),bytes);
 for(const l of result.lines)for(const t of l.tokens){
  assert(Object.values(t.box).every(Number.isInteger));assert(t.box.x>=0&&t.box.y>=0&&t.box.x+t.box.width<=input.width&&t.box.y+t.box.height<=input.height);
  if(t.certain&&l.sampling)assert(t.samplingStable&&t.box.height>=30);
 }
 const renamed=masks.map((m,i)=>({...m,id:'opaque-'+i})),renamedResult=await OCR.recognize(input,renamed),map=new Map(masks.map((m,i)=>[m.id,renamed[i].id]));
 assert.deepEqual(renamedResult.lines.map(l=>l.tokens.map(t=>[t.id,t.box,t.certain])),result.lines.map(l=>l.tokens.map(t=>[t.id?map.get(t.id):null,t.box,t.certain])));
 for(const options of [{threshold:result.threshold},{detail:false}])assert.equal((await OCR.recognize(input,masks,options)).samplingRefinement,undefined);
 const tiny=await OCR.recognize(blur(draw([ids.slice(0,10)],{height:24})),masks);assert.equal(tiny.samplingRefinement?.rows,0);assert(tiny.lines.flatMap(l=>l.tokens).every(t=>!t.certain));
 for(const stopAt of [1,events.filter(p=>p.pass===2).length]){
  let seen=0,cancel=false;await assert.rejects(OCR.recognize(input,masks,{cancelled:()=>cancel},p=>{if(p.pass===2&&++seen===stopAt)cancel=true;}),/取消/);
 }
 console.log('PASS soft-edge-only subpixel refinement: sharp-input preservation, opaque IDs, native integer boxes, original pixels, resolution confidence gate, manual/coarse fallback and cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
