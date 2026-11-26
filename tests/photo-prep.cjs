/* Offline mobile-photo preprocessing checks: uneven shadow/glare equalization,
 * inversion symmetry, skew estimation & deskew OCR recovery, lossless 90° turns,
 * immutability, and Siren uneven-lighting recovery. Public synthetic inputs only. */
'use strict';
const assert=require('node:assert/strict');
const Prep=require('../src/photo-prep.js'),OCR=require('../src/ocr-engine.js'),Siren=require('../src/siren-recognition.js');
const {masks,draw}=require('./ocr.cjs'),F=require('./siren-fixture.cjs'),C=require('../src/siren-core.js'),decodePNG=require('./png.cjs');
const decodeAlpha=a=>{const r=decodePNG(Buffer.from(a.src.split(',')[1],'base64'));return {...a,width:r.width,height:r.height,alpha:Uint8Array.from({length:r.width*r.height},(_,i)=>r.data[i*4+3])};};
const sirenTemplates={base:decodeAlpha(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decodeAlpha(a)])),path:F.path};
const sirenEngine=Siren.create(sirenTemplates);
function renderSiren(group){
  const rec=sirenEngine.reconstruct({width:600,height:600,ink:new Float32Array(360000)},{cx:group.cx,cy:group.cy,size:group.baseSize,rotation:group.baseRotation},group.items.map(i=>({...i,rotation:C.rotationFor(group,i)})));
  return {width:600,height:600,data:Uint8ClampedArray.from({length:600*600*4},(_,i)=>i%4===3?255:Math.round(255*(1-rec.ink[i>>2])))};
}

const flattenText=res=>res.lines.map(l=>l.tokens.map(t=>t.id||'?').join('')).join('\n');

// 1. Severe shadow gradient across a multi-row Babelian image (left bright 240, right dark shadow 85).
const cleanRows=[['H','E','R','E','I','S'],['T','H','E','K','E','Y']];
const clean=draw(cleanRows,{height:44,gap:3});
const shadowed={width:clean.width,height:clean.height,data:new Uint8ClampedArray(clean.data.length)};
for(let y=0;y<clean.height;y++)for(let x=0;x<clean.width;x++){
  const factor=1-0.65*(x/(clean.width-1));
  const i=(y*clean.width+x)*4;
  for(let c=0;c<3;c++)shadowed.data[i+c]=Math.round(clean.data[i+c]*factor);
  shadowed.data[i+3]=255;
}
const shadowBytes=Buffer.from(shadowed.data);
const assessedShadow=Prep.assess(shadowed);
assert(assessedShadow.unevenLighting&&assessedShadow.gradientSpan>=80,'Should detect strong shadow gradient');
assert.deepEqual(Buffer.from(shadowed.data),shadowBytes,'assess must not mutate pixels');

// 2. Additive specular glare washing out dark ink to mid-gray across a diagonal band.
const glared={width:clean.width,height:clean.height,data:new Uint8ClampedArray(clean.data.length)};
for(let y=0;y<clean.height;y++)for(let x=0;x<clean.width;x++){
  const glare=Math.max(0,1-Math.abs((x/clean.width-y/clean.height)*2))*110;
  const i=(y*clean.width+x)*4;
  for(let c=0;c<3;c++)glared.data[i+c]=Math.min(255,Math.round(clean.data[i+c]+glare));
  glared.data[i+3]=255;
}

// 3. Exact inversion symmetry of equalizeLighting (dark-on-light vs light-on-dark).
const invShadow={width:shadowed.width,height:shadowed.height,data:Uint8ClampedArray.from(shadowed.data,(v,i)=>i%4===3?255:255-v)};
const eqDark=Prep.equalizeLighting(shadowed),eqLight=Prep.equalizeLighting(invShadow);
assert.equal(eqDark.polarity,'dark');assert.equal(eqLight.polarity,'light');
for(let i=0;i<eqDark.data.length;i+=4){
  assert.equal(eqDark.data[i],255-eqLight.data[i],'Lighting equalization must be inversion symmetric');
}
assert.deepEqual(Buffer.from(shadowed.data),shadowBytes,'equalizeLighting must not mutate source');

// 4. Lossless 90° quarter-turns round trip.
let turned=clean;
for(let k=0;k<4;k++)turned=Prep.transformImage(turned,{quarterTurns:1});
assert.equal(turned.width,clean.width);assert.equal(turned.height,clean.height);
assert.deepEqual(Buffer.from(turned.data),Buffer.from(clean.data),'Four 90-degree turns must be bit-for-bit lossless');

// 5. Blank image & noise-free horizontal image safety guards.
const blank={width:200,height:120,data:new Uint8ClampedArray(200*120*4).fill(255)};
assert.deepEqual({angle:Prep.estimateSkew(blank).angle,confident:Prep.estimateSkew(blank).confident},{angle:0,confident:false});
assert.equal(Prep.estimateSkew(clean).angle,0,'Already horizontal text stays at 0°');

// 6. Siren uneven-lighting recovery on a shadowed spiral image.
const sirenGroup=C.fromText('A').groups[0];assert(F.geometry.arrange(sirenGroup));
const sirenClean=renderSiren(sirenGroup);
const sirenShadow={width:600,height:600,data:new Uint8ClampedArray(sirenClean.data.length)};
for(let y=0;y<600;y++)for(let x=0;x<600;x++){
  const f=0.35+0.65*(x/599),i=(y*600+x)*4;
  for(let c=0;c<3;c++)sirenShadow.data[i+c]=Math.round(sirenClean.data[i+c]*f);
  sirenShadow.data[i+3]=255;
}
const rawSirenBin=Siren.binarize(sirenShadow);
const eqSirenBin=Siren.binarize(Prep.equalizeLighting(sirenShadow));
// Shadowed left border (background) should stay 0 ink after equalization, not turn solid ink.
let rawLeftBg=0,eqLeftBg=0;
for(let y=20;y<580;y++){rawLeftBg+=rawSirenBin.ink[y*600+8];eqLeftBg+=eqSirenBin.ink[y*600+8];}
assert(rawLeftBg>200,'Raw shadowed border falsely becomes ink without lighting equalization');
assert(eqLeftBg<30,`Equalized shadowed border should drop near zero ink (got ${eqLeftBg.toFixed(1)} vs raw ${rawLeftBg.toFixed(1)})`);

(async()=>{
  const expected='HEREIS\nTHEKEY';
  const rawShadowRes=await OCR.recognize(shadowed,masks);
  const eqShadowRes=await OCR.recognize(eqDark,masks);
  assert.notEqual(flattenText(rawShadowRes),expected,'Severe shadow should corrupt raw global-threshold OCR');
  assert.equal(flattenText(eqShadowRes),expected,'Equalized shadow image recovers 100% of glyphs');

  const eqGlareRes=await OCR.recognize(Prep.equalizeLighting(glared),masks);
  assert.equal(flattenText(eqGlareRes),expected,'Equalized glare image recovers 100% of glyphs');

  // 7. Tilted phone photos (+6° and -7.5°): auto-deskew estimates angle and recovers 100% OCR.
  const padded=draw([['H','E','R','E','I','S','T','H','E'],['W','A','T','E','R','G','A','T','E']],{height:40,gap:3});
  const padW=padded.width+120,padH=padded.height+120,framed={width:padW,height:padH,data:new Uint8ClampedArray(padW*padH*4).fill(255)};
  for(let y=0;y<padded.height;y++)framed.data.set(padded.data.subarray(y*padded.width*4,(y+1)*padded.width*4),((y+60)*padW+60)*4);
  const expectedFramed='HEREISTHE\nWATERGATE';
  for(const tilt of [6,-7.5]){
    const tilted=Prep.transformImage(framed,{angle:tilt});
    const rawRes=await OCR.recognize(tilted,masks);
    assert.notEqual(flattenText(rawRes),expectedFramed,`Tilted ${tilt}° image should fail raw row segmentation`);
    const est=Prep.estimateSkew(tilted);
    assert(est.confident,`estimateSkew should be confident for ${tilt}° tilt`);
    assert(Math.abs(est.angle+tilt)<=0.6,`Expected correction ~${-tilt}°, got ${est.angle}°`);
    const fixed=Prep.transformImage(tilted,{angle:est.angle});
    const fixedRes=await OCR.recognize(fixed,masks);
    assert.equal(flattenText(fixedRes),expectedFramed,`Auto-deskewed ${tilt}° image recovers 100% of glyphs`);
  }
  // 8. Real ocr-ui.js & siren-ui.js photo-prep button integration check.
  const fs=require('node:fs'),vm=require('node:vm');
  function parseMarkup(file){
    const nodes=new Map();
    class El{
      constructor(tag='div'){this.tagName=tag.toUpperCase();this.attrs={};this.children=[];this.parentElement=this.parentNode=null;this.events={};this.dataset={};this.style={};this.className='';this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.scrollTop=0;this.clientWidth=600;this.clientHeight=200;this._pixels=null;
        this.classList={contains:n=>this.className.split(/\s+/).includes(n),add:n=>{if(!this.classList.contains(n))this.className+=' '+n;},remove:n=>{this.className=this.className.split(/\s+/).filter(x=>x!==n).join(' ');},toggle:(n,on)=>{const yes=on??!this.classList.contains(n);yes?this.classList.add(n):this.classList.remove(n);return yes;}};
        this.ctx={clearRect(){},fillRect(){},strokeRect(){},save(){},restore(){},scale(){},translate(){},rotate(){},beginPath(){},arc(){},moveTo(){},lineTo(){},stroke(){},fillText(){},setLineDash(){},measureText:t=>({width:t.length*8}),
          drawImage:(src)=>{if(src&&src.width&&src.height)this._lastDrawn=src;},
          createImageData:(w,h)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4)}),
          putImageData:(img)=>{this._pixels=img;},
          getImageData:(x,y,w,h)=>this._pixels&&this._pixels.width===w&&this._pixels.height===h?this._pixels:{width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(240)}};
      }
      set width(v){this._w=v;}get width(){return this._w||1;}set height(v){this._h=v;}get height(){return this._h||1;}
      setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=v;if(k==='class')this.className=v;if(['value','type'].includes(k))this[k]=String(v);if(['hidden','disabled','checked','readonly'].includes(k))this[k==='readonly'?'readOnly':k]=true;}
      getAttribute(k){return this.attrs[k]??null;}removeAttribute(k){delete this.attrs[k];if(k==='hidden')this.hidden=false;}
      addEventListener(k,fn){(this.events[k]??=[]).push(fn);}async emit(k,e={}){for(const fn of this.events[k]||[])await fn({target:this,button:0,pointerId:1,preventDefault(){},...e});}
      click(){return this.emit('click');}append(...c){for(const x of c){x.parentElement=x.parentNode=this;this.children.push(x);}}insertBefore(n){this.append(n);}replaceChildren(...c){this.children=[];this.append(...c);}
      contains(t){return this===t||this.children.some(c=>c.contains(t));}querySelectorAll(){return [];}querySelector(){return null;}closest(){return null;}
      focus(){}blur(){}select(){}scrollIntoView(){}setPointerCapture(){}getContext(){return this.ctx;}getBoundingClientRect(){return {left:0,top:0,width:this.width,height:this.height};}
    }
    const html=fs.readFileSync(require.resolve(file),'utf8'),body=new El('body'),stack=[body];
    for(const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
      if(m[0].startsWith('<!--'))continue;const [,closing,tag,attrs]=m;if(closing){stack.pop();continue;}
      const node=new El(tag);for(const a of attrs.matchAll(/([\w:-]+)(?:="([^"]*)")?/g))node.setAttribute(a[1],a[2]??'');
      stack.at(-1).append(node);if(node.id)nodes.set(node.id,node);if(!['input','img','br','hr','meta','link','wbr'].includes(tag))stack.push(node);
    }
    const doc={body,activeElement:body,getElementById:id=>{assert(nodes.has(id),'Missing '+id);return nodes.get(id);},createElement:t=>new El(t),addEventListener(){},execCommand:()=>true};
    return {nodes,doc,$:id=>nodes.get(id)};
  }
  const uiOcr=parseMarkup('../src/ocr-panel.html');
  const ImgOcr=class{constructor(){this.naturalWidth=600;this.naturalHeight=240;}set src(_){queueMicrotask(()=>this.onload?.());}};
  const ocrCtx={console,document:uiOcr.doc,Image:ImgOcr,URL:{createObjectURL:()=>'blob:p',revokeObjectURL(){}},Blob,Uint8Array,Uint8ClampedArray,setTimeout,clearTimeout,queueMicrotask,TextEncoder,AbortController,confirm:()=>true,navigator:{},matchMedia:()=>({matches:false}),window:{addEventListener(){},scrollBy(){}},BabelianOCR:OCR,BabelianOCRWork:require('../src/ocr-work.js'),BabelianOCRCorrection:require('../src/ocr-correction.js'),BabelianTextFormat:require('../src/text-format.js'),BabelianTranslation:require('../src/translation.js'),BabelianPhotoPrep:Prep};
  vm.createContext(ocrCtx);vm.runInContext(fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8'),ocrCtx);
  const ocrApp=ocrCtx.BabelianOCRUI.mount({glyphs:{a:{src:'data:a'}},wordData:'the',getMapping:()=>({a:'a'}),editMapping(){},append(){},notify(){}});
  const json=v=>JSON.parse(JSON.stringify(v));
  await uiOcr.$('ocr-file').emit('change',{target:{files:[{name:'photo.jpg',type:'image/jpeg',size:100}]}});
  assert.deepEqual(json(ocrApp.snapshot().crop),{x:0,y:0,width:600,height:240});assert(uiOcr.$('ocr-photo-reset').disabled);
  await uiOcr.$('ocr-turn-right').click();assert.deepEqual(json(ocrApp.snapshot().crop),{x:0,y:0,width:240,height:600},'90° turn updates OCR working dimensions');
  uiOcr.$('ocr-illumination').checked=true;await uiOcr.$('ocr-illumination').emit('change');assert(!uiOcr.$('ocr-photo-reset').disabled);
  await uiOcr.$('ocr-deskew-auto').click();
  await uiOcr.$('ocr-photo-reset').click();assert.deepEqual(json(ocrApp.snapshot().crop),{x:0,y:0,width:600,height:240},'Reset restores original OCR dimensions');assert(uiOcr.$('ocr-photo-reset').disabled);

  const uiSiren=parseMarkup('../src/siren-panel.html');
  const ImgSiren=class{set src(_){this.width=480;this.height=300;queueMicrotask(()=>this.onload?.());}};
  const sirenCtx={console,document:uiSiren.doc,Image:ImgSiren,SirenCore:C,SirenIntersections:{prepare:()=>({analyze:g=>({items:g.items.map(i=>({id:i.id,at:i.x}))}),basePoints:()=>[],arrange:()=>true})},SirenStrip:{},SirenRecognition:{createRecognitionBoundary:()=>()=>true,workerSource:()=>''},SirenScan:{create:()=>({cancel(){},async run(){return [];}})},SirenReview:require('../src/siren-review.js'),SirenMemory:require('../src/siren-memory.js'),BabelianTextFormat:require('../src/text-format.js'),SirenFormat:require('../src/siren-format.js'),BabelianTranslation:{...require('../src/translation.js'),createClient:()=>async()=>''},BabelianPhotoPrep:Prep,BabelianHost:{download:async()=>{}},confirm:()=>true,window:{addEventListener(){}},navigator:{clipboard:{}},Blob,URL:{createObjectURL:()=>'blob:s',revokeObjectURL(){}},DataView,Uint8Array,Uint8ClampedArray,atob,setTimeout,clearTimeout};
  vm.createContext(sirenCtx);vm.runInContext(fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8'),sirenCtx);
  const sirenApp=sirenCtx.SirenUI.mount({assets:F.assets,path:F.path,wordData:'the',notify(){}});
  await sirenApp.ready;sirenApp.setMode('review');
  await uiSiren.$('siren-image-file').emit('change',{target:{files:[Object.assign(new Blob(['x'],{type:'image/jpeg'}),{name:'card.jpg'})]}});
  assert.equal(uiSiren.$('siren-source-canvas').width,480);assert.equal(uiSiren.$('siren-source-canvas').height,300);assert(uiSiren.$('siren-photo-reset').disabled);
  await uiSiren.$('siren-turn-right').click();assert.equal(uiSiren.$('siren-source-canvas').width,300);assert.equal(uiSiren.$('siren-source-canvas').height,480);assert(!uiSiren.$('siren-photo-reset').disabled);
  uiSiren.$('siren-illumination').checked=true;await uiSiren.$('siren-illumination').emit('change');
  await uiSiren.$('siren-photo-reset').click();assert.equal(uiSiren.$('siren-source-canvas').width,480);assert.equal(uiSiren.$('siren-source-canvas').height,300);assert(uiSiren.$('siren-photo-reset').disabled);

  console.log('PASS photo preprocessing: shadow & glare OCR recovery, exact inversion symmetry, lossless 90° turns, +6°/-7.5° auto-deskew OCR recovery, Siren shadow removal, OCR & Siren UI photo controls, blank/level guards and immutability.');
})().catch(e=>{console.error(e);process.exitCode=1;});
