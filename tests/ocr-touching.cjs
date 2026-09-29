/* Generated low-resolution boundary stress test: unrelated symbol order,
 * no word labels, private screenshots, or expected sentences in the engine. */
const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{masks,draw}=require('./ocr.cjs');
function soften(src){
 const data=new Uint8Array(src.data.length);
 for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++)for(let c=0;c<4;c++){
  let v=0;for(let i=-1;i<=1;i++)v+=src.data[(y*src.width+Math.max(0,Math.min(src.width-1,x+i)))*4+c]*(i?1:4);
  data[(y*src.width+x)*4+c]=Math.round(v/6);
 }
 return {...src,data};
}
(async()=>{
 const all=masks.map(m=>m.id),ids=all.filter((_,i)=>i%2===0).reverse().concat(all.filter((_,i)=>i%2===1));
 const rows=[ids.slice(0,20),ids.slice(20,40),ids.slice(40)];
 // Negative spacing intentionally obscures neighboring edges. This tests
 // safe behavior under ambiguity, not a claim of perfect OCR on overlap.
 const image=soften(draw(rows,{height:27,gap:-3})),bytes=Buffer.from(image.data);
 const result=await OCR.recognize(image,masks),refined=result.lines.filter(l=>l.segmentation);
 assert(refined.length>0,'Exercise additional local valley candidates');
 assert(refined.every(l=>l.segmentation.method==='touching-valleys'));
 assert(result.lines.flatMap(l=>l.tokens).every(t=>!t.certain),'Tiny source remains pending');
 assert.deepEqual(Buffer.from(image.data),bytes,'Source image is immutable');
 for(const line of result.lines)for(const t of line.tokens){
  for(const v of Object.values(t.box))assert(Number.isInteger(v)&&v>=0);
  assert(t.box.x+t.box.width<=image.width&&t.box.y+t.box.height<=image.height);
 }
 const replacement=new Map(masks.map((m,i)=>[m.id,'opaque-'+i]));
 const renamed=await OCR.recognize(image,masks.map(m=>({...m,id:replacement.get(m.id)})));
 const summary=r=>r.lines.map(l=>({box:l.box,segmentation:l.segmentation,tokens:l.tokens.map(t=>({id:t.id,box:t.box,certain:t.certain}))}));
 const expected=summary(result);for(const l of expected)for(const t of l.tokens)t.id=replacement.get(t.id)||null;
 assert.deepEqual(summary(renamed),expected,'Opaque IDs cannot influence boundaries');
 const coarse=await OCR.recognize(image,masks,{detail:false});assert(coarse.lines.every(l=>!l.segmentation));
 const manual=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});
 assert.equal(manual.threshold,result.threshold);assert.equal(manual.thresholdSearch,undefined);assert.equal(manual.samplingRefinement,undefined);
 const sharp=await OCR.recognize(draw(rows,{height:64,gap:4}),masks);
 assert(sharp.lines.every(l=>!l.segmentation));assert.deepEqual(sharp.lines.flatMap(l=>l.tokens.map(t=>t.id)),ids);
 let cancel=false;await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>cancel},()=>{cancel=true;}),/取消/);
 console.log('PASS touching-glyph refinement: image-only boundaries, opaque-ID invariance, original pixels, pending status, coarse opt-out, manual threshold, high-resolution regression, cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
