/* Synthetic soft small-print boundaries; no private image or sentence labels. */
const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{masks,draw}=require('./ocr.cjs'),{connected}=require('./ocr-touching.cjs');
const overlap=(a,b)=>{const n=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));return n/(a.width*a.height+b.width*b.height-n||1);};
const sequence=['Q','t','B','n','the','r','and','G','x','a','T','h'];
function blur(src){
 const data=new Uint8Array(src.data.length);
 for(let y=0;y<src.height;y++)for(let x=0;x<src.width;x++)for(let c=0;c<4;c++){
  let v=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)v+=src.data[(Math.max(0,Math.min(src.height-1,y+j))*src.width+Math.max(0,Math.min(src.width-1,x+i)))*4+c]*(i?1:2)*(j?1:2);
  data[(y*src.width+x)*4+c]=Math.round(v/16);
 }
 return {...src,data};
}
const summary=r=>r.lines.map(l=>({box:l.box,sampling:l.sampling,smallCutSearch:l.smallCutSearch,tokens:l.tokens.map(t=>({id:t.id,box:t.box,certain:t.certain}))}));
(async()=>{
 const image=blur(connected(sequence,34,-2)),bytes=Buffer.from(image.data),events=[];
 const result=await OCR.recognize(image,masks,{},p=>events.push(p));
 assert(result.lines.some(l=>l.smallCutSearch),'Exercise bounded fractional valley/component cuts');
 assert(events.some(p=>p.pass===2));assert.deepEqual(Buffer.from(image.data),bytes);
 const native=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});
 assert.notDeepEqual(result.lines[0].tokens.map(t=>t.id),native.lines[0].tokens.map(t=>t.id),'Exercise changed small-print boundaries');
 // This deliberately blurred/overlapping synthetic still has an ambiguous
 // word glyph. Shape improvement is not a claim of perfect small-print OCR.
 for(let i=0;i<result.lines[0].tokens.length;i++)if(result.lines[0].tokens[i].id!==sequence[i])assert(!result.lines[0].tokens[i].certain);
 for(const [i,line]of result.lines.entries())for(const token of line.tokens){
  assert(Object.values(token.box).every(Number.isInteger));assert(token.box.x>=0&&token.box.y>=0&&token.box.x+token.box.width<=image.width&&token.box.y+token.box.height<=image.height);
  if(token.certain&&line.smallCutSearch)assert(token.samplingStable&&native.lines[i].tokens.some(t=>t.certain&&t.id===token.id&&overlap(t.box,token.box)>=.85),'New boundaries cannot create confirmation');
 }
 assert.equal(native.threshold,result.threshold);assert(native.lines.every(l=>!l.smallCutSearch));
 const renamed=masks.map((m,i)=>({...m,id:'opaque-'+i})),names=new Map(masks.map((m,i)=>[m.id,renamed[i].id])),other=await OCR.recognize(image,renamed),expected=summary(result);
 for(const line of expected)for(const token of line.tokens)token.id=names.get(token.id)||null;assert.deepEqual(summary(other),expected);
 const inverse={...image,data:Uint8Array.from(image.data,(v,i)=>i%4===3?v:255-v)},inverted=await OCR.recognize(inverse,masks);
 assert.deepEqual(inverted.lines.map(l=>l.tokens.map(t=>[t.id,t.certain])),result.lines.map(l=>l.tokens.map(t=>[t.id,t.certain])));
 // Fractional .5 rounding can shift a boundary by one source pixel under
 // inversion; identities/confidence must agree and source regions must match.
 inverted.lines.forEach((l,i)=>l.tokens.forEach((t,j)=>assert(overlap(t.box,result.lines[i].tokens[j].box)>=.9)));
 for(const options of [{detail:false},{threshold:result.threshold}])assert((await OCR.recognize(image,masks,options)).lines.every(l=>!l.smallCutSearch));
 const sharp=draw([sequence],{height:34,gap:4}),clean=await OCR.recognize(sharp,masks),cleanNative=await OCR.recognize(sharp,masks,{threshold:clean.threshold,polarity:clean.polarity});assert(clean.lines.every(l=>!l.smallCutSearch));assert.deepEqual(clean.lines,cleanNative.lines,'Sharp raster is unchanged by refinement');
 const tiny=await OCR.recognize(connected(sequence,24,-2),masks);assert(tiny.lines.every(l=>!l.smallCutSearch));assert(tiny.lines.flatMap(l=>l.tokens).every(t=>!t.certain));
 let cancelled=false;await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>cancelled},p=>{if(p.pass===2)cancelled=true;}),/取消/);
 console.log('PASS bounded small soft-print cuts: real alternative boundaries, opaque IDs, inverse identity/confidence agreement, original pixels/native boxes, no new confirmation, sharp/tiny/manual/coarse guards and cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
