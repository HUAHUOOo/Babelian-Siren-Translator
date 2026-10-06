/* Generated raster IDs only: no private screenshots, corrections or text. */
'use strict';
const assert=require('node:assert/strict');
const OCR=require('../src/ocr-engine.js'),{masks}=require('./ocr.cjs'),{render}=require('./ocr-repeated.cjs');
const target=['l','l','t','h','a','t'],reference=['l','t','h','a','l','t','h','a'];
const rows=[target,reference,reference.slice().reverse(),reference];
const ids=result=>result.lines.map(line=>line.tokens.map(token=>token.id));
const overlap=(a,b)=>{
 const n=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 return n/(a.width*a.height+b.width*b.height-n||1);
};
function assertPendingChanges(result,before){
 for(const [row,line]of result.lines.entries())for(const token of line.tokens){
  assert.equal(token.manual,false);
  assert(Object.values(token.box).every(Number.isInteger));
  if(token.certain)assert(before.lines[row].tokens.some(peer=>peer.certain&&peer.id===token.id&&overlap(peer.box,token.box)>=.85),'New labels and boundaries cannot become confirmed');
 }
}
(async()=>{
 for(const height of [32,34,36,38]){
  const image=render(rows,{height,gap:-3}),bytes=Buffer.from(image.data),events=[];
  const result=await OCR.recognize(image,masks,{},event=>events.push(event));
  const before=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});
  assert(result.lines.every(line=>line.box.height<40),'Exercise native small print');
  assert(result.pageRefinement?.rows>=1);
  assert.equal(result.lines[0].pageMatching?.method,'repeated-glyphs');
  assert(events.some(event=>event.pass===4));
  assert.deepEqual(ids(result),rows);
  assert.notDeepEqual(ids(before)[0],target,'The generated partition really needs the small-page pass');
  assertPendingChanges(result,before);
  assert.deepEqual(Buffer.from(image.data),bytes);
  assert.equal(before.pageRefinement,undefined,'Manual threshold remains authoritative');
 }
 const image=render(rows,{height:34,gap:-3}),result=await OCR.recognize(image,masks);
 const renamed=masks.map((mask,i)=>({...mask,id:'opaque-shape-'+i})),mapping=new Map(masks.map((mask,i)=>[mask.id,renamed[i].id]));
 const renamedResult=await OCR.recognize(image,renamed);
 assert.deepEqual(ids(renamedResult),ids(result).map(line=>line.map(id=>id&&mapping.get(id))));
 assert.deepEqual(renamedResult.lines.map(line=>line.tokens.map(token=>[token.box,token.certain])),result.lines.map(line=>line.tokens.map(token=>[token.box,token.certain])));
 const inverse={...image,data:Uint8Array.from(image.data,(v,i)=>i%4===3?v:255-v)};
 const inverted=await OCR.recognize(inverse,masks);
 assert.deepEqual(ids(inverted),ids(result));
 assert.deepEqual(inverted.lines.map(line=>line.tokens.map(token=>token.certain)),result.lines.map(line=>line.tokens.map(token=>token.certain)));
 const coarse=await OCR.recognize(image,masks,{detail:false});
 assert.equal(coarse.pageRefinement,undefined);
 const tiny=await OCR.recognize(render(rows,{height:28,gap:-3}),masks);
 assert.equal(tiny.pageRefinement,undefined);
 assert(tiny.lines.flatMap(line=>line.tokens).every(token=>!token.certain),'Upsampling never bypasses the original-resolution floor');
 const clean=await OCR.recognize(render(rows,{height:34,gap:4}),masks);
 assert.equal(clean.pageRefinement,undefined);assert.deepEqual(ids(clean),rows);
 const insufficient=await OCR.recognize(render(rows.slice(0,2),{height:34,gap:-3}),masks);
 assert.equal(insufficient.pageRefinement,undefined,'One other row cannot supply independent references');
 let cancelled=false,sawPage=false;
 await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>cancelled},event=>{if(event.pass===4){sawPage=true;cancelled=true;}}),/取消/);
 assert(sawPage);
 console.log('PASS small-page repeated shapes: generated 32–38 px recovery, opaque IDs, inverse polarity, pending new boundaries, native coordinates, immutable input, tiny/clean/insufficient-reference/manual/coarse guards and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
