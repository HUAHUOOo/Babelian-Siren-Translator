/* Public generated-symbol regression: no private screenshot, passage, mapped
 * words or sentence expectations. Repeated glyph IDs are opaque raster keys. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const OCR=require('../src/ocr-engine.js');
const {masks,rasters}=require('./ocr.cjs');

// Negative spacing unions foreground pixels; drawing a neighbour must not erase
// the preceding symbol with its background. Other rows supply clean references.
function render(rows,{height=48,gap=-4,referenceGap=4,rowHeights=[]}={}){
 const margin=10,rowHeight=height+14;
 const glyphWidth=(id,h=height)=>Math.round(rasters[id].width/rasters[id].height*h);
 const width=Math.max(...rows.map((row,i)=>margin*2+row.reduce((sum,id)=>sum+glyphWidth(id,rowHeights[i]||height)+(i?referenceGap:gap),0)));
 const image={width,height:rows.length*rowHeight+margin*2,data:new Uint8Array(width*(rows.length*rowHeight+margin*2)*4).fill(244)};
 for(let at=3;at<image.data.length;at+=4)image.data[at]=255;
 rows.forEach((row,i)=>{
  let left=margin;
  const h=rowHeights[i]||height;
  for(const id of row){
   const source=rasters[id],w=glyphWidth(id,h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const sx=Math.min(source.width-1,Math.floor((x+.5)*source.width/w));
    const sy=Math.min(source.height-1,Math.floor((y+.5)*source.height/h));
    const alpha=source.data[(sy*source.width+sx)*4+3]/255;
    const value=Math.round(244-209*alpha),at=((margin+i*rowHeight+y)*width+left+x)*4;
    for(let channel=0;channel<3;channel++)image.data[at+channel]=Math.min(image.data[at+channel],value);
   }
   left+=w+(i?referenceGap:gap);
  }
 });
 return image;
}
const ids=line=>line.tokens.map(token=>token.id);
const iou=(a,b)=>{
 const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
 return area/(a.width*a.height+b.width*b.height-area||1);
};
function covered(mask,tokens,box=OCR.bounds(mask)){
 for(const token of tokens){
  for(const value of Object.values(token.box))assert(Number.isInteger(value)&&value>=0,'Source rectangles use original integer coordinates');
  assert(token.box.width>0&&token.box.height>0);
  assert(token.box.x+token.box.width<=mask.width&&token.box.y+token.box.height<=mask.height);
 }
 for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++)if(mask.data[y*mask.width+x]){
  assert(tokens.some(({box:b})=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height),`Foreground pixel ${x},${y} must remain covered`);
 }
}
function summary(result,rename=id=>id){
 return {
  pageRefinement:result.pageRefinement,
  lines:result.lines.map(line=>({box:line.box,segmentation:line.segmentation,pageMatching:line.pageMatching,
   tokens:line.tokens.map(token=>({...token,id:token.id?rename(token.id):null,candidates:token.candidates.map(candidate=>({...candidate,id:rename(candidate.id)}))}))}))
 };
}

function checkLocalSupportGuard(){
 // Exercise the production helper without adding a test-only public API. Only
 // its export list is instrumented; the guard body is the unmodified source.
 const source=fs.readFileSync(require.resolve('../src/ocr-engine.js'),'utf8'),exportPoint='return {binarize,';
 assert.equal(source.split(exportPoint).length,2,'One production export point');
 const scope={module:{exports:{}}};
 vm.runInNewContext(source.replace(exportPoint,'return {supportedPageChanges,binarize,'),scope,{filename:'ocr-local-support-guard.js'});
 const supported=scope.module.exports.supportedPageChanges;
 assert.equal(typeof supported,'function');
 const box={x:0,y:0,width:160,height:40};
 const token=(id,x,width,score,nativeScore)=>({id,box:{x,y:0,width,height:40},score,certain:false,
  candidates:[{id,score,...(nativeScore===undefined?{}:{nativeScore})}]});
 const cases=[
  {name:'stable ID sequences need no new page evidence',before:[token('shape-a',0,40,.7)],after:[token('shape-a',0,40,.7)],accept:true},
  {name:'supported overlapping repartition improves local evidence',before:[token('shape-a',0,60,.82)],after:[token('shape-b',0,30,.9,.86),token('shape-c',30,30,.9,.85)],accept:true},
  {name:'stronger native-only replacement has no held-out support',before:[token('shape-a',0,60,.82)],after:[token('shape-b',0,30,.9),token('shape-c',30,30,.9)],accept:false},
  {name:'a reference field without actual scoring benefit is insufficient',before:[token('shape-a',0,40,.8)],after:[token('shape-b',0,40,.9,.9)],accept:false},
  {name:'tiny local-reference gain remains below its gate',before:[token('shape-a',0,40,.8)],after:[token('shape-b',0,40,.9,.896)],accept:false},
  {name:'meaningful local-reference gain clears its gate',before:[token('shape-a',0,40,.8)],after:[token('shape-b',0,40,.9,.894)],accept:true},
  {name:'reference gain cannot excuse worse adapted local quality',before:[token('shape-a',0,40,.93)],after:[token('shape-b',0,40,.91,.86)],accept:false},
  {name:'adapted-quality improvement below .008 is insufficient',before:[token('shape-a',0,40,.9)],after:[token('shape-b',0,40,.907,.85)],accept:false},
  {name:'adapted-quality improvement above .008 is sufficient',before:[token('shape-a',0,40,.9)],after:[token('shape-b',0,40,.909,.85)],accept:true},
  {name:'extra fragments retain the per-token evidence penalty',before:[token('shape-a',0,40,.9)],after:[token('shape-b',0,20,.915,.865),token('shape-c',20,20,.915,.865)],accept:false},
  {name:'benefit is source-width weighted, not one small lucky fragment',before:[token('shape-a',0,100,.8)],after:[token('shape-b',0,1,.95,.9),token('shape-c',1,99,.95,.95)],accept:false},
  {name:'a distant stable symbol boost cannot authorize unsupported changes',before:[token('shape-a',0,40,.8),token('stable',100,40,.7)],after:[token('shape-b',0,40,.94),token('stable',100,40,.96,.7)],accept:false},
  {name:'every changed region needs its own support',before:[token('shape-a',0,40,.8),token('shape-b',80,40,.8)],after:[token('shape-c',0,40,.94,.88),token('shape-d',80,40,.94)],accept:false},
  {name:'adjacent non-overlapping regions cannot borrow support',before:[token('shape-a',0,40,.8),token('shape-b',40,40,.8)],after:[token('shape-c',0,40,.94,.88),token('shape-d',40,40,.94)],accept:false},
  {name:'new cuts crossing old boundaries share one connected region',before:[token('shape-a',0,30,.8),token('shape-b',30,30,.8)],after:[token('shape-c',0,20,.9,.85),token('shape-d',20,40,.9,.85)],accept:true},
  {name:'disjoint replacement cannot drop the old covered region',before:[token('shape-a',0,40,.8)],after:[token('shape-b',60,40,.94,.88)],accept:false},
  {name:'non-finite reference evidence cannot authorize a change',before:[token('shape-a',0,40,.8)],after:[token('shape-b',0,40,.94,NaN)],accept:false}
 ];
 // Close native partitions are a bounded exception, not a lower global gate.
 const tieBefore=()=>[token('shape-a',0,30,.9),token('shape-b',30,30,.9)].map(t=>({...t,segmentationMargin:.003}));
 const tieAfter=()=>[token('shape-c',0,20,.904,.895),token('shape-d',20,40,.904,.895)];
 const tieCase=(name,edit,accept=false)=>{
  const before=tieBefore(),after=tieAfter();edit(before,after);cases.push({name,before,after,accept});
 };
 tieCase('short pending native tie has independently supported stronger cuts',()=>{},true);
 tieCase('a confirmed old symbol blocks the native-tie exception',before=>{before[0].certain=true;});
 tieCase('old segmentation margin outside the tie range is protected',before=>{before[1].segmentationMargin=.01;});
 tieCase('unknown old segmentation margin is protected',before=>{delete before[1].segmentationMargin;});
 tieCase('negative old margin cannot supply partition evidence',before=>{before[1].segmentationMargin=-.001;});
 tieCase('non-finite old margin cannot supply partition evidence',before=>{before[1].segmentationMargin=NaN;});
 tieCase('every new symbol needs held-out references',(_,after)=>{delete after[0].candidates[0].nativeScore;});
 tieCase('every new symbol needs a strong native match',(_,after)=>{after[0].candidates[0].nativeScore=.839;});
 tieCase('infinite native score cannot qualify a partition',(_,after)=>{after[0].candidates[0].nativeScore=Infinity;});
 tieCase('new labels must match the first ranked candidate',(_,after)=>{after[0].candidates[0].id='other';});
 tieCase('a close runner-up blocks the native-tie exception',(_,after)=>{after[0].candidates.push({id:'rival',score:.88});});
 tieCase('local reference gain remains necessary for native ties',(_,after)=>{after.forEach(t=>{t.candidates[0].nativeScore=.9;});});
 tieCase('native ties still need a positive quality gain above .002',(_,after)=>{after.forEach(t=>{t.score=t.candidates[0].score=.9015;});});
 tieCase('a one-symbol substitution is not a close multi-symbol partition',before=>{before.splice(1);before[0].box.width=60;before[0].score=before[0].candidates[0].score=.883333;});
 tieCase('a one-symbol replacement is not a close multi-symbol partition',(_,after)=>{after.splice(1);after[0].box.width=60;after[0].score=after[0].candidates[0].score=.89;after[0].candidates[0].nativeScore=.88;});
 tieCase('unbounded old partition cannot borrow the tie exception',before=>{before.splice(0,before.length,...Array.from({length:7},(_,i)=>({...token('old-'+i,i*8,8,.991),segmentationMargin:.003})));});
 tieCase('unbounded new partition cannot borrow the tie exception',(_,after)=>{after.splice(0,after.length,...Array.from({length:7},(_,i)=>token('new-'+i,i*8,8,.995,.986)));});
 const rename=tokens=>tokens.map(token=>({...token,id:'opaque-'+token.id,candidates:token.candidates.map(candidate=>({...candidate,id:'opaque-'+candidate.id}))}));
 for(const {name,before,after,accept} of cases){
  const frozen=JSON.stringify([before,after]);
  assert.equal(supported(before,after,box),accept,name);
  assert.equal(supported(rename(before),rename(after),box),accept,name+' with renamed opaque IDs');
  assert.equal(JSON.stringify([before,after]),frozen,'Local-support checks must not mutate caller tokens');
 }
 console.log('PASS local page-change guard: independent reference/quality gains; bounded pending native ties; confirmed/weak/unbounded partition rejection; width weighting, fragment penalty, opaque IDs and unchanged inputs.');
}

async function run(){
 checkLocalSupportGuard();
 const target=['l','l','t','h','a','t'];
 const reference=['l','t','h','a','l','t','h','a'];
 const rows=[target,reference,reference.slice().reverse(),reference];
 const image=render(rows),sourceBytes=Buffer.from(image.data),templateBytes=masks.map(mask=>Buffer.from(mask.data)),events=[];
 const result=await OCR.recognize(image,masks,{},progress=>events.push(progress));
 assert.equal(result.lines.length,rows.length);
 assert(result.pageRefinement?.rows>=1,'Exercise same-page reference matching, not merely the ordinary row recognizer');
 assert.equal(result.lines[0].pageMatching?.method,'repeated-glyphs');
 assert(result.lines[0].pageMatching.referenceIds>=3);
 assert.deepEqual(ids(result.lines[0]),target);
 assert(events.some(event=>event.pass===4),'Page-level refinement reports bounded progress');
 assert.deepEqual(Buffer.from(image.data),sourceBytes,'Source image remains immutable');
 masks.forEach((mask,i)=>assert.deepEqual(Buffer.from(mask.data),templateBytes[i],'Native templates remain immutable'));

 const manual=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});
 assert.equal(manual.threshold,result.threshold);
 assert.equal(manual.pageRefinement,undefined,'Manual threshold skips learned page references');
 assert.equal(manual.thresholdSearch,undefined);
 assert.equal(manual.samplingRefinement,undefined);
 assert.notDeepEqual(ids(manual.lines[0]),target,'The generated target has a genuinely ambiguous native partition');
 for(let row=1;row<rows.length;row++){
  assert.deepEqual(ids(result.lines[row]),rows[row]);
  assert.deepEqual(result.lines[row].tokens,manual.lines[row].tokens,'Stable reference rows must not be rewritten or self-trained');
 }
 for(const token of result.lines[0].tokens){
  assert.equal(token.manual,false);
  if(token.certain)assert(manual.lines[0].tokens.some(peer=>peer.certain&&peer.id===token.id&&iou(peer.box,token.box)>=.85),'A new label/boundary cannot become automatically confirmed');
 }
 assert(result.lines[0].tokens.slice(0,3).every(token=>!token.certain),'Newly recovered boundaries remain pending review');

 const mask=OCR.binarize(image,{threshold:result.threshold,polarity:result.polarity});
 for(const line of result.lines)covered(mask,line.tokens,line.box);
 const templates=OCR.prepareTemplates(masks),box=result.lines[0].box;
 const native=OCR.recognizeLine(mask,box,templates),components=OCR.recognizeLine(mask,box,templates,'components');
 covered(mask,native,box);covered(mask,components,box);
 assert.notDeepEqual(components.map(token=>token.box),native.map(token=>token.box),'Disconnected-component edges offer additional competing cut sites');
 const insideInk=components.slice(1).some(token=>{
  const x=token.box.x;
  let left=0,right=0;
  for(let y=box.y;y<box.y+box.height;y++){left+=mask.data[y*mask.width+x-1]||0;right+=mask.data[y*mask.width+x]||0;}
  return left>0&&right>0;
 });
 assert(insideInk,'The component-cut fixture contains boundaries without a blank projection column');

 const replacement=new Map(masks.map((mask,i)=>[mask.id,'opaque-raster-'+i]));
 const renamed=await OCR.recognize(image,masks.map(mask=>({...mask,id:replacement.get(mask.id)})));
 assert.deepEqual(summary(renamed),summary(result,id=>replacement.get(id)),'Opaque IDs cannot change pixels, references, cuts, scores or confidence');

 // A short unrelated row previously disabled all native-size page matching.
 // It must keep its own small-resolution guards while larger rows can refine.
 const mixedImage=render([...rows,['Q']],{rowHeights:[48,48,48,48,28]}),mixedBytes=Buffer.from(mixedImage.data);
 const mixed=await OCR.recognize(mixedImage,masks);
 assert.deepEqual(mixed.lines.map(ids),[...rows,['Q']]);
 assert.equal(mixed.lines[0].pageMatching?.method,'repeated-glyphs');
 assert.equal(mixed.lines.at(-1).pageMatching,undefined);
 assert(mixed.lines.at(-1).tokens.every(token=>!token.certain),'An unrelated small row stays pending');
 assert.deepEqual(Buffer.from(mixedImage.data),mixedBytes);
 const mixedMask=OCR.binarize(mixedImage,{threshold:mixed.threshold,polarity:mixed.polarity});
 for(const line of mixed.lines)covered(mixedMask,line.tokens,line.box);
 const mixedRenamed=await OCR.recognize(mixedImage,masks.map(mask=>({...mask,id:replacement.get(mask.id)})));
 assert.deepEqual(summary(mixedRenamed),summary(mixed,id=>replacement.get(id)));
 const mixedManual=await OCR.recognize(mixedImage,masks,{threshold:mixed.threshold});
 assert.equal(mixedManual.pageRefinement,undefined);assert.notDeepEqual(ids(mixedManual.lines[0]),target);

 const coarseEvents=[],coarse=await OCR.recognize(image,masks,{detail:false},event=>coarseEvents.push(event));
 assert.equal(coarse.detail,false);assert.equal(coarse.pageRefinement,undefined);assert.equal(coarse.thresholdSearch,undefined);
 assert(coarse.lines.every(line=>!line.pageMatching));assert(coarseEvents.every(event=>event.pass!==4));

 // Cross-row independence and the minimum support gates are meaningful, even
 // when many identical symbols are available on a single row.
 const twoRows=await OCR.recognize(render([target,reference]),masks);
 assert.equal(twoRows.pageRefinement,undefined,'One other row cannot supply independent page references');
 const oneReferenceRow=await OCR.recognize(render([target,reference.concat(reference),['Q']]),masks);
 assert.equal(oneReferenceRow.lines[0].pageMatching,undefined,'Repeated copies on only one other row are insufficient');
 const sparse=await OCR.recognize(render([target,['l','t','h','a'],['a','h','t','l']]),masks);
 assert.equal(sparse.lines[0].pageMatching,undefined,'Two clean copies per ID do not meet the three-reference gate');
 const twoKinds=await OCR.recognize(render([target,['l','t','l','t'],['t','l','t','l'],['l','t','l','t']]),masks);
 assert.equal(twoKinds.pageRefinement,undefined,'At least three distinct supported IDs are required');
 const tiny=await OCR.recognize(render(rows,{height:28,gap:0}),masks);
 assert.equal(tiny.pageRefinement,undefined);assert(tiny.lines.flatMap(line=>line.tokens).every(token=>!token.certain),'Small repeated glyphs cannot bypass the source-resolution gate');
 const clean=await OCR.recognize(render(rows,{gap:4}),masks);
 assert.equal(clean.pageRefinement,undefined);assert.deepEqual(clean.lines.map(ids),rows,'Clean synthetic text stays unchanged');

 let cancelled=false,sawPagePass=false;
 await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>cancelled},event=>{
  if(event.pass===4){sawPagePass=true;cancelled=true;}
 }),/取消/);
 assert(sawPagePass,'Cancellation is exercised inside page refinement');
 await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>true}),/取消/);
 console.log('PASS repeated-glyph page refinement: generated opaque symbols, independent cross-row support, component cuts, complete original-ink coverage, immutable image/templates, pending new boundaries, coarse/manual opt-outs, small/clean/insufficient-reference guards and cancellation.');
}
if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={render};
