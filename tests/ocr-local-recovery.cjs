/* Public synthetic tests for local weak-token recovery, mixed-height threshold
 * search, row-fenced faded-tip hysteresis, scaled reference-grid width, and
 * single-letter whole-word formatting boundaries. No private images or passages. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const OCR=require('../src/ocr-engine.js');
const {create,reflow}=require('../src/text-format.js');
const {masks,rasters,draw}=require('./ocr.cjs');
const {connected}=require('./ocr-touching.cjs');

const wordData=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../src/english-words.txt.gz'))).toString('utf8');
const formatter=create(wordData.trim().split(/\s+/).filter(w=>/^[a-z]{2,32}$/.test(w)||w==='a'||w==='i').join(' '));

function invertImage(img){
  return {...img,data:Uint8Array.from(img.data,(v,i)=>i%4===3?v:255-v)};
}

// Render synthetic rows whose vertical tails taper smoothly toward gray paper
// so Otsu truncates the lower portion while row-fenced hysteresis recovers it.
function drawFadedParchment(rows,{height=56,gap=3,bg=206,ink=36,fadeStart=.55,fadeEnd=186}={}){
  const margin=12,rowGap=8,rowStep=height+rowGap;
  const width=Math.max(...rows.map(row=>row.reduce((s,id)=>s+Math.round(rasters[id].width/rasters[id].height*height)+gap,margin*2)));
  const totalH=rows.length*rowStep+margin*2;
  const data=new Uint8Array(width*totalH*4);
  for(let y=0;y<totalH;y++)for(let x=0;x<width;x++){
    const o=(y*width+x)*4;
    // Slight deterministic parchment variation (still far from ink core)
    const grain=((x*13+y*29)%9)-4;
    const v=Math.max(0,Math.min(255,bg+grain));
    data[o]=data[o+1]=data[o+2]=v;data[o+3]=255;
  }
  rows.forEach((row,ri)=>{
    let x=margin;
    const top=margin+ri*rowStep;
    for(const id of row){
      const src=rasters[id],w=Math.round(src.width/src.height*height);
      for(let y=0;y<height;y++){
        const frac=y/(height-1);
        const strokeTone=frac<=fadeStart?ink:Math.round(ink+(fadeEnd-ink)*(frac-fadeStart)/(1-fadeStart));
        for(let xx=0;xx<w;xx++){
          const sx=Math.min(src.width-1,Math.floor((xx+.5)*src.width/w));
          const sy=Math.min(src.height-1,Math.floor((y+.5)*src.height/height));
          const a=src.data[(sy*src.width+sx)*4+3]/255;
          if(a<=0)continue;
          const o=((top+y)*width+x+xx)*4;
          const blended=Math.round(data[o]*(1-a)+strokeTone*a);
          data[o]=data[o+1]=data[o+2]=Math.min(data[o],blended);
        }
      }
      x+=w+gap;
    }
  });
  return {width,height:totalH,data};
}

// Render a mostly clean 64px row with a single touching pair in the middle so
// whole-row evidence stays >= 0.86 while the pair produces a weak token (<0.72).
function drawCleanWithLocalTouch(prefix,pair,suffix,{height=64,cleanGap=6,touchGap=-4}={}){
  const all=[...prefix,...pair,...suffix];
  const widths=all.map(id=>Math.round(rasters[id].width/rasters[id].height*height));
  const margin=12;
  let totalW=margin*2;
  all.forEach((_,i)=>{
    totalW+=widths[i]+(i===prefix.length?touchGap:cleanGap);
  });
  const totalH=height+margin*2,data=new Uint8Array(totalW*totalH*4).fill(248);
  for(let i=3;i<data.length;i+=4)data[i]=255;
  let x=margin;
  all.forEach((id,i)=>{
    const src=rasters[id],w=widths[i];
    for(let y=0;y<height;y++)for(let xx=0;xx<w;xx++){
      const sx=Math.min(src.width-1,Math.floor((xx+.5)*src.width/w));
      const sy=Math.min(src.height-1,Math.floor((y+.5)*src.height/height));
      const a=src.data[(sy*src.width+sx)*4+3]/255;
      if(a<=0)continue;
      const v=Math.round(248-220*a),o=((margin+y)*totalW+x+xx)*4;
      data[o]=data[o+1]=data[o+2]=Math.min(data[o],v);
    }
    x+=w+(i===prefix.length?touchGap:cleanGap);
  });
  return {width:totalW,height:totalH,data};
}

async function run(){
  // 1. Mixed row heights (56px rows + one 32px short row) MUST still run thresholdSearch!
  const mixedRows=[['B','u','r','n','i','n','g'],['w','i','t','h','f','i','r','e'],['Q','x']];
  const r0=draw([mixedRows[0],mixedRows[1]],{height:56,gap:4});
  const rSmall=draw([mixedRows[2]],{height:32,gap:4});
  const wMix=Math.max(r0.width,rSmall.width),hMix=r0.height+rSmall.height;
  const dMix=new Uint8Array(wMix*hMix*4).fill(244);
  for(let i=3;i<dMix.length;i+=4)dMix[i]=255;
  for(let y=0;y<r0.height;y++)dMix.set(r0.data.subarray(y*r0.width*4,(y+1)*r0.width*4),y*wMix*4);
  for(let y=0;y<rSmall.height;y++)dMix.set(rSmall.data.subarray(y*rSmall.width*4,(y+1)*rSmall.width*4),(r0.height+y)*wMix*4);
  const mixedImg={width:wMix,height:hMix,data:dMix};
  const mixedRes=await OCR.recognize(mixedImg,masks);
  assert(mixedRes.thresholdSearch,'Mixed-height page with >=40px rows must run thresholdSearch');
  assert.deepEqual(mixedRes.lines.map(l=>l.tokens.map(t=>t.id)),mixedRows);

  // 2. Row-fenced faded-tip hysteresis: polarity symmetry, opaque-ID invariance, no row merging, conservative confirmation
  const fadedRows=[['B','e','g','i','n','s','w','i','t','h'],['a','n','d','t','h','e','r','e','s','t']];
  const faded=drawFadedParchment(fadedRows,{height:56,gap:4,bg:204,ink:34,fadeStart:.45,fadeEnd:184});
  const fadedBytes=Buffer.from(faded.data);
  const fadedRes=await OCR.recognize(faded,masks);
  assert.equal(fadedRes.lines.length,fadedRows.length,'Row-fenced hysteresis must not merge rows');
  assert.deepEqual(Buffer.from(faded.data),fadedBytes,'Source image must stay immutable');
  // Polarity symmetry
  const fadedInv=await OCR.recognize(invertImage(faded),masks);
  assert.equal(fadedInv.lines.length,fadedRes.lines.length);
  assert.deepEqual(fadedInv.lines.map(l=>l.tokens.map(t=>[t.id,t.certain])),fadedRes.lines.map(l=>l.tokens.map(t=>[t.id,t.certain])),'Faded-tip recovery must be polarity-symmetric');
  // Opaque-ID invariance
  const map=new Map(masks.map((m,i)=>[m.id,'opaque-'+i]));
  const fadedRenamed=await OCR.recognize(faded,masks.map(m=>({...m,id:map.get(m.id)})));
  assert.deepEqual(fadedRenamed.lines.map(l=>l.tokens.map(t=>[t.id,t.box,t.certain])),fadedRes.lines.map(l=>l.tokens.map(t=>[t.id?map.get(t.id):null,t.box,t.certain])),'Opaque IDs cannot alter faded-tip recovery');
  // Manual & coarse opt-out
  const fadedManual=await OCR.recognize(faded,masks,{threshold:fadedRes.threshold,polarity:fadedRes.polarity});
  assert.equal(fadedManual.fadedRefinement,undefined,'Manual threshold skips automatic fadedRefinement');
  const fadedCoarse=await OCR.recognize(faded,masks,{detail:false});
  assert.equal(fadedCoarse.fadedRefinement,undefined,'Coarse mode skips automatic fadedRefinement');

  // 3. Local weak-token recovery on a mostly clean row: preserves clean neighbors & opaque-ID invariance
  const localImg=drawCleanWithLocalTouch(['B','u','r','n','i','n','g','w','i','t','h'],['e','a'],['g','o','d','s','f','i','r','e']);
  const localRes=await OCR.recognize(localImg,masks);
  const expectedLocal=['B','u','r','n','i','n','g','w','i','t','h','e','a','g','o','d','s','f','i','r','e'];
  assert.deepEqual(localRes.lines[0].tokens.map(t=>t.id),expectedLocal,'Local touching pair inside high-score row must recover cleanly');
  const localRenamed=await OCR.recognize(localImg,masks.map(m=>({...m,id:map.get(m.id)})));
  assert.deepEqual(localRenamed.lines[0].tokens.map(t=>t.id),expectedLocal.map(id=>map.get(id)));

  // 4. Height-scaled referenceGridSupported guard (h=40 -> cap 160; h=70 -> cap 280)
  const src=fs.readFileSync(require.resolve('../src/ocr-engine.js'),'utf8');
  const scope={module:{exports:{}}};
  vm.runInNewContext(src.replace('return {binarize,','return {referenceGridSupported,binarize,'),scope);
  const refGuard=scope.module.exports.referenceGridSupported;
  const mk=(id,x,w,sc,nat,h)=>({id,box:{x,y:0,width:w,height:h},score:sc,certain:true,manual:false,candidates:[{id,score:sc,...(nat===undefined?{}:{nativeScore:nat})}]});
  const makeCase=(h,w)=>{
    const before=[mk('o0',0,w/2,.9,undefined,h),mk('o1',w/2,w/2,.9,undefined,h)];
    const native=before.map(t=>({...t,segmentationMargin:.003}));
    const after=[mk('n0',0,w/3,.93,.91,h),mk('n1',w/3,w/3,.93,.91,h),mk('n2',w*2/3,w/3,.93,undefined,h)];
    const adapted=[{id:'n0',references:[{},{},{}]},{id:'n1',references:[{},{},{}]}];
    return refGuard(before,native,after,adapted,{x:0,y:0,width:w,height:h});
  };
  assert.equal(makeCase(40,160),true,'40px height allows 160px width');
  assert.equal(makeCase(40,161),false,'40px height still rejects 161px width');
  assert.equal(makeCase(70,210),true,'70px height scales width limit to 4*h=280px');
  assert.equal(makeCase(70,281),false,'70px height rejects width > 4*h');

  // 5. Formatting: whole-word glyph a_word keeps real word boundary; ordinary letter A does not
  const withAWord={
    text:'ItfellAlongtimeago',
    spans:[
      {glyph:'I',start:0,end:1,text:'I'},{glyph:'t',start:1,end:2,text:'t'},
      {glyph:'f',start:2,end:3,text:'f'},{glyph:'e',start:3,end:4,text:'e'},{glyph:'l',start:4,end:5,text:'l'},{glyph:'l',start:5,end:6,text:'l'},
      {glyph:'a_word',start:6,end:7,text:'A'},
      {glyph:'l',start:7,end:8,text:'l'},{glyph:'o',start:8,end:9,text:'o'},{glyph:'n',start:9,end:10,text:'n'},{glyph:'g',start:10,end:11,text:'g'},
      {glyph:'t',start:11,end:12,text:'t'},{glyph:'i',start:12,end:13,text:'i'},{glyph:'m',start:13,end:14,text:'m'},{glyph:'e',start:14,end:15,text:'e'},
      {glyph:'a',start:15,end:16,text:'a'},{glyph:'g',start:16,end:17,text:'g'},{glyph:'o',start:17,end:18,text:'o'}
    ]
  };
  const outAWord=formatter.suggest(withAWord,{punctuate:false});
  assert.equal(outAWord.text,'It fell A longtime ago','a_word whole-word glyph must keep its boundary separate from following letters');
  assert.equal(reflow(withAWord,outAWord.text).text,outAWord.text);
  const withLetterA={...withAWord,spans:withAWord.spans.map(s=>s.glyph==='a_word'?{...s,glyph:'A'}:s)};
  assert.equal(formatter.suggest(withLetterA,{punctuate:false}).text,'It fell Along time ago','Ordinary letter A without word-glyph ID stays eligible to join Along');
  assert.equal(formatter.suggest({text:'MemorydefraggedRebooting',spans:[]},{punctuate:false}).text,'Memory defragged Rebooting');
  assert.equal(formatter.suggest({text:'Gitgood!/?',spans:[]},{punctuate:false}).text,'Git good!/?');

  // 6. Cancellation inside fadedRefinement
  let cancelled=false;
  await assert.rejects(OCR.recognize(faded,masks,{cancelled:()=>cancelled},p=>{if(p.pass===3)cancelled=true;}),/取消/);

  console.log('PASS local recovery & formatting: mixed-height threshold search, row-fenced faded hysteresis (polarity/opaque/guards), local weak-token cut recovery, height-scaled reference grid, a_word whole-word boundary and terms.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
