/* Optional private card benchmark. Labels are evaluation-only and never
 * passed into the recognizer. No card image or passage is published. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),PNG=require('./png.cjs'),{masks}=require('./ocr.cjs');
if(!process.env.BABELIAN_CARD_FIXTURE||!process.env.BABELIAN_CARD_LABELS){console.log('SKIP private card: set BABELIAN_CARD_FIXTURE and BABELIAN_CARD_LABELS');process.exit(0);}
const fixture=JSON.parse(fs.readFileSync(process.env.BABELIAN_CARD_LABELS,'utf8'));
const OCR=require(process.env.BABELIAN_REFERENCE_ENGINE?path.resolve(process.env.BABELIAN_REFERENCE_ENGINE):'../src/ocr-engine.js');
const original=PNG(fs.readFileSync(process.env.BABELIAN_CARD_FIXTURE));assert.deepEqual([original.width,original.height],fixture.dimensions);
function distance(a,b){let p=Array.from({length:b.length+1},(_,i)=>i);for(let i=0;i<a.length;i++){const r=[i+1];for(let j=0;j<b.length;j++)r.push(Math.min(r[j]+1,p[j+1]+1,p[j]+Number(a[i]!==b[j])));p=r;}return p[b.length];}
(async()=>{
 const reports=[],expected=fixture.lines.map(s=>s.split(' ')),flat=expected.flat(),[x,y,width,height]=fixture.crop;
 for(const inverse of [false,true]){
  const image={width,height,data:new Uint8Array(width*height*4)};
  for(let row=0;row<height;row++)image.data.set(original.data.subarray(((y+row)*original.width+x)*4,((y+row)*original.width+x+width)*4),row*width*4);
  if(inverse)image.data=Uint8Array.from(image.data,(v,i)=>i%4===3?v:255-v);
  const bytes=Buffer.from(image.data),start=Date.now(),result=await OCR.recognize(image,masks),tokens=result.lines.flatMap(l=>l.tokens);
  const report={inverse,seconds:(Date.now()-start)/1000,expected:flat.length,lines:result.lines.length,tokens:tokens.length,edits:distance(flat,tokens.map(t=>t.id)),missing:tokens.filter(t=>!OCR.tokenGlyph(t)).length,certain:tokens.filter(t=>t.certain).length,refinedRows:result.lines.filter(l=>l.segmentation).length,threshold:result.threshold,actual:result.lines.map(l=>l.tokens.map(t=>t.id||'?').join(' '))};reports.push(report);
  assert.deepEqual(Buffer.from(image.data),bytes);
  if(!process.env.BABELIAN_REFERENCE_ENGINE){
   assert.deepEqual(result.lines.map(l=>l.tokens.map(t=>t.id)),expected);assert.equal(report.missing,0);assert.equal(report.certain,0,'27px image remains pending');
   const map=Object.fromEntries(masks.map(m=>[m.id,m.id]));
   assert(!OCR.transcribe(result,map).includes('[?]'),'Pending candidates appear in the output');
   for(const t of tokens){assert(t.box.x>=0&&t.box.y>=0);assert(t.box.x+t.box.width<=width&&t.box.y+t.box.height<=height);}
  }
  console.log(JSON.stringify(report));
 }
 if(process.env.BABELIAN_REFERENCE_REPORT)fs.writeFileSync(process.env.BABELIAN_REFERENCE_REPORT,JSON.stringify(reports,null,2));
 console.log('PASS private development card and inverse. Not an independent unseen accuracy estimate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
