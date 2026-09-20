/* Optional private reference. Gold is evaluation-only; recognizer inputs are
 * pixels and opaque template IDs. No screenshot is bundled or uploaded. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),PNG=require('./png.cjs'),{masks}=require('./ocr.cjs');
if(!process.env.BABELIAN_SMALL_FIXTURE){console.log('SKIP private small-stroke sample: set BABELIAN_SMALL_FIXTURE');process.exit(0);}
const labelPath=process.env.BABELIAN_SMALL_LABELS?path.resolve(process.env.BABELIAN_SMALL_LABELS):path.join(__dirname,'fixtures/babelian-3935.json');
assert(fs.existsSync(labelPath),'Private labels are not published; set BABELIAN_SMALL_LABELS to the evaluation JSON path');
const fixture=JSON.parse(fs.readFileSync(labelPath,'utf8'));
const OCR=require(process.env.BABELIAN_REFERENCE_ENGINE?path.resolve(process.env.BABELIAN_REFERENCE_ENGINE):'../src/ocr-engine.js');
const original=PNG(fs.readFileSync(process.env.BABELIAN_SMALL_FIXTURE));assert.deepEqual([original.width,original.height],fixture.dimensions);
function align(a,b){const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+Number(a[i-1]!==b[j-1]));let i=a.length,j=b.length,pairs=[];while(i||j){if(i&&j&&d[i][j]===d[i-1][j-1]+Number(a[i-1]!==b[j-1]))pairs.push([--i,--j]);else if(i&&d[i][j]===d[i-1][j]+1)pairs.push([--i,-1]);else pairs.push([-1,--j]);}return {edits:d[a.length][b.length],pairs};}
(async()=>{
 const reports=[],expected=fixture.lines.map(s=>s.split(' ')),flat=expected.flat();
 for(const inverse of [false,true]){
  const image={...original,data:Uint8Array.from(original.data,(v,i)=>inverse&&i%4!==3?255-v:v)},bytes=Buffer.from(image.data),start=Date.now();
  const result=await OCR.recognize(image,masks),tokens=result.lines.flatMap(l=>l.tokens),a=align(flat,tokens.map(t=>t.id));
  const wrongCertain=a.pairs.filter(([i,j])=>j>=0&&tokens[j].certain&&tokens[j].id!==flat[i]).length;
  const report={inverse,seconds:(Date.now()-start)/1000,expected:flat.length,lines:result.lines.length,tokens:tokens.length,edits:a.edits,certain:tokens.filter(t=>t.certain).length,wrongCertain,threshold:result.threshold,sampling:result.samplingRefinement,actual:result.lines.map(l=>l.tokens.map(t=>t.id||'?').join(' '))};reports.push(report);
  assert.deepEqual(Buffer.from(image.data),bytes);
  if(!process.env.BABELIAN_REFERENCE_ENGINE){
   assert.deepEqual(result.lines.map(l=>l.tokens.map(t=>t.id)),expected);assert.equal(wrongCertain,0);
   assert(report.certain<flat.length,'Interpolation is not evidence to confirm every item');
   assert(!result.lines[21].tokens[6].certain&&!result.lines[21].tokens[7].certain,'Keep the shared a+t / T+A boundary uncertain');
   for(const t of tokens)for(const [k,v]of Object.entries(t.box))assert(Number.isInteger(v)&&v>=0,'Source-pixel rectangle '+k);
   for(const t of tokens){assert(t.box.x+t.box.width<=image.width);assert(t.box.y+t.box.height<=image.height);}
  }
  console.log(JSON.stringify(report));
 }
 if(process.env.BABELIAN_REFERENCE_REPORT)fs.writeFileSync(process.env.BABELIAN_REFERENCE_REPORT,JSON.stringify(reports,null,2));
 console.log('PASS development reference and inverse; these are not independent unseen accuracy claims.');
})().catch(e=>{console.error(e);process.exitCode=1;});
