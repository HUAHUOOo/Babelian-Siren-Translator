/* Generated low-resolution boundary stress test: unrelated symbol order,
 * no word labels, private screenshots, or expected sentences in the engine. */
const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{masks,rasters,draw}=require('./ocr.cjs');
function soften(src){
 const data=new Uint8Array(src.data.length);
 for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++)for(let c=0;c<4;c++){
  let v=0;for(let i=-1;i<=1;i++)v+=src.data[(y*src.width+Math.max(0,Math.min(src.width-1,x+i)))*4+c]*(i?1:4);
  data[(y*src.width+x)*4+c]=Math.round(v/6);
 }
 return {...src,data};
}
function connected(ids,height,gap){
 const width=20+ids.reduce((s,id)=>s+Math.round(rasters[id].width/rasters[id].height*height)+gap,0);
 const image={width,height:height+20,data:new Uint8Array(width*(height+20)*4).fill(244)};
 for(let i=3;i<image.data.length;i+=4)image.data[i]=255;
 let start=10;
 for(const id of ids){
  const glyph=draw([[id]],{height,gap:0}),w=Math.round(rasters[id].width/rasters[id].height*height);
  // Union the ink instead of overwriting a neighbour with the new background.
  for(let y=0;y<height;y++)for(let x=0;x<w;x++)for(let c=0;c<3;c++){
   const at=((y+10)*width+start+x)*4+c;
   image.data[at]=Math.min(image.data[at],glyph.data[((y+10)*glyph.width+x+10)*4+c]);
  }
  start+=w+gap;
 }
 return soften(image);
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
 // Larger printed glyphs may also touch. This sequence is unrelated to words
 // or private cards; the old <40px gate left its shared strokes mispartitioned.
 const sequence=['Q','t','B','n','the','r','and','G','x','a','T','h'];
 const large=connected(sequence,80,-6),largeBytes=Buffer.from(large.data),largeResult=await OCR.recognize(large,masks);
 assert.equal(largeResult.lines.length,1);assert(largeResult.lines[0].segmentation);
 assert.deepEqual(largeResult.lines[0].tokens.map(t=>t.id),sequence);assert.deepEqual(Buffer.from(large.data),largeBytes);
 const largeMask=OCR.binarize(large,{threshold:largeResult.threshold,polarity:largeResult.polarity});
 const native=OCR.recognizeLine(largeMask,largeResult.lines[0].box,OCR.prepareTemplates(masks));
 assert.notDeepEqual(native.map(t=>t.id),sequence,'Exercise a genuinely ambiguous original partition');
 const iou=(a,b)=>{const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return area/(a.width*a.height+b.width*b.height-area||1);};
 for(const t of largeResult.lines[0].tokens)if(t.certain)assert(native.some(p=>p.certain&&p.id===t.id&&iou(p.box,t.box)>=.85),'New boundaries must not be auto-confirmed');
 const largeRenamed=await OCR.recognize(large,masks.map(m=>({...m,id:replacement.get(m.id)})));
 const largeExpected=summary(largeResult);for(const l of largeExpected)for(const t of l.tokens)t.id=replacement.get(t.id)||null;
 assert.deepEqual(summary(largeRenamed),largeExpected);
 assert((await OCR.recognize(large,masks,{detail:false})).lines.every(l=>!l.segmentation));
 const largeManual=await OCR.recognize(large,masks,{threshold:largeResult.threshold,polarity:largeResult.polarity});
 assert.equal(largeManual.threshold,largeResult.threshold);assert.deepEqual(largeManual.lines[0].tokens.map(t=>t.id),sequence);
 for(const height of [40,48,80]){
  const clean=await OCR.recognize(draw([sequence],{height,gap:4}),masks);
  assert.deepEqual(clean.lines[0].tokens.map(t=>t.id),sequence);assert(!clean.lines[0].segmentation);
 }
 let cancel=false;await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>cancel},()=>{cancel=true;}),/取消/);
 console.log('PASS touching-glyph refinement: small/large connected strokes, image-only boundaries, opaque-ID invariance, original pixels, conservative confirmation, coarse opt-out, manual threshold, clean-size regression, cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
