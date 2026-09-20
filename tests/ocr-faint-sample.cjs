/* Private development sample, plus image-only transformations. No gold labels
 * are passed to the recognizer, and no private PNG is committed. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),PNG=require('./png.cjs'),{masks}=require('./ocr.cjs');
if(!process.env.BABELIAN_FAINT_FIXTURE){console.log('SKIP private faint-stroke sample: set BABELIAN_FAINT_FIXTURE');process.exit(0);}
const labelPath=process.env.BABELIAN_FAINT_LABELS?path.resolve(process.env.BABELIAN_FAINT_LABELS):path.join(__dirname,'fixtures/babelian-9301.json');
assert(fs.existsSync(labelPath),'Private labels are not published; set BABELIAN_FAINT_LABELS to the evaluation JSON path');
const fixture=JSON.parse(fs.readFileSync(labelPath,'utf8'));
const OCR=require(process.env.BABELIAN_REFERENCE_ENGINE?path.resolve(process.env.BABELIAN_REFERENCE_ENGINE):'../src/ocr-engine.js');
const original=PNG(fs.readFileSync(process.env.BABELIAN_FAINT_FIXTURE));assert.deepEqual([original.width,original.height],fixture.dimensions);
function resize(src,f){const width=Math.round(src.width*f),height=Math.round(src.height*f),data=new Uint8Array(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){let xx=(x+.5)/f-.5,yy=(y+.5)/f-.5,ix=Math.floor(xx),iy=Math.floor(yy),dx=xx-ix,dy=yy-iy;for(let c=0;c<4;c++){let sum=0;for(let j=0;j<2;j++)for(let i=0;i<2;i++)sum+=src.data[(Math.max(0,Math.min(src.height-1,iy+j))*src.width+Math.max(0,Math.min(src.width-1,ix+i)))*4+c]*(i?dx:1-dx)*(j?dy:1-dy);data[(y*width+x)*4+c]=Math.round(sum);}}return {width,height,data};}
function align(a,b){const d=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));for(let i=0;i<=a.length;i++)d[i][0]=i;for(let j=0;j<=b.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+Number(a[i-1]!==b[j-1]));let i=a.length,j=b.length,pairs=[];while(i||j){if(i&&j&&d[i][j]===d[i-1][j-1]+Number(a[i-1]!==b[j-1]))pairs.push([--i,--j]);else if(i&&d[i][j]===d[i-1][j]+1)pairs.push([--i,-1]);else pairs.push([-1,--j]);}return {edits:d[a.length][b.length],pairs};}
(async()=>{
 const reports=[],expected=fixture.lines.map(s=>s.split(' ')),flat=expected.flat();
 for(const [name,f,inverse]of [['native',1,false],['inverse',1,true],['resize-80',.8,false],['resize-60',.6,false],['resize-40',.4,false]]){
  const image=resize(original,f);if(inverse)for(let i=0;i<image.data.length;i++)if(i%4!==3)image.data[i]=255-image.data[i];
  const bytes=Buffer.from(image.data),start=Date.now(),result=await OCR.recognize(image,masks),tokens=result.lines.flatMap(l=>l.tokens),a=align(flat,tokens.map(t=>t.id));
  const wrongCertain=a.pairs.filter(([i,j])=>j>=0&&tokens[j].certain&&tokens[j].id!==flat[i]).length;
  const report={name,seconds:(Date.now()-start)/1000,expected:flat.length,lines:result.lines.length,tokens:tokens.length,edits:a.edits,certain:tokens.filter(t=>t.certain).length,wrongCertain,threshold:result.threshold,search:result.thresholdSearch,actual:result.lines.map(l=>l.tokens.map(t=>t.id||'?').join(' '))};reports.push(report);
  assert.deepEqual(Buffer.from(image.data),bytes,'Do not alter source pixels');
  if(!process.env.BABELIAN_REFERENCE_ENGINE&&f===1){assert.deepEqual(result.lines.map(l=>l.tokens.map(t=>t.id)),expected);assert.equal(wrongCertain,0);assert(report.certain>=195&&report.certain<217,'Keep unresolved boundaries for human review');}
  if(!process.env.BABELIAN_REFERENCE_ENGINE&&f>=.6)assert.equal(wrongCertain,0,'Wrong transformed candidates must remain uncertain');
  console.log(JSON.stringify(report));
 }
 if(process.env.BABELIAN_REFERENCE_REPORT)fs.writeFileSync(process.env.BABELIAN_REFERENCE_REPORT,JSON.stringify(reports,null,2));
 console.log('PASS native and inverted reference; resized variants are stress measurements, not independent accuracy claims.');
})().catch(e=>{console.error(e);process.exitCode=1;});
