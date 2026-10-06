/* Synthetic state, coordinate, DOM and canvas doubles only. This is not browser,
 * visual or recognition-accuracy QA. No private source images/text are used. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/siren-core.js'),F=require('../src/text-format.js'),T=require('../src/translation.js'),assets=require('../src/siren-glyphs.json');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M8AAAICAQB7CY0KAAAAAElFTkSuQmCC';
const nodes=new Map(),events=new Map(),documentEvents=new Map(),downloads=[];let document,sourceDimensions={width:1600,height:800},scanReply=[],lastPayload,scanCalls=0,cancels=0,confirmReply=true;
class Element{
 constructor(tag='div'){this.tagName=tag.toUpperCase();this.children=[];this.listeners=new Map();this.attributes={};this.style={};this.width=600;this.height=600;this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.clientHeight=200;this.ctx=new Proxy({arcs:[],boxes:[],draws:[],drawImage(...args){this.draws.push(args);},arc(...args){this.arcs.push(args);},strokeRect(...args){this.boxes.push(args);},getImageData:(x,y,w,h)=>({width:w,height:h,data:new Uint8Array(w*h*4)}),measureText:t=>({width:t.length*10})},{get:(o,k)=>o[k]||(()=>{})});}
 addEventListener(k,f){this.listeners.set(k,f);}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=[...items];}
 getContext(){return this.ctx;}getBoundingClientRect(){return this.rect||{left:0,top:0,width:600,height:600};}setPointerCapture(){}focus(options){document.activeElement=this;this.focusOptions=options;}blur(){document.activeElement=null;}scrollIntoView(){}select(){}click(){return this.fire('click');}
 async fire(type,extra={}){const event={type,target:this,button:0,pointerId:1,preventDefault(){},...extra},value=this.listeners.get(type)?.(event);if(type==='keydown')documentEvents.get(type)?.(event);return value;}toDataURL(){return png;}toBlob(fn){fn(new Blob([''],{type:'image/png'}));}
}
const markup=fs.readFileSync(require.resolve('../src/siren-panel.html'),'utf8');
for(const tag of markup.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const el=new Element(tag[1]);el.id=tag[3];el.hidden=/\shidden\b/.test(tag[2]);el.disabled=/\sdisabled\b/.test(tag[2]);el.checked=/\schecked\b/.test(tag[2]);nodes.set(el.id,el);}
document={activeElement:null,getElementById:id=>{assert(nodes.has(id),id);return nodes.get(id);},createElement:tag=>new Element(tag),addEventListener:(k,f)=>documentEvents.set(k,f),execCommand:()=>true};
class ImageDouble{set src(value){this.value=value;Object.assign(this,value.startsWith('blob:')?sourceDimensions:{width:600,height:600});queueMicrotask(()=>this.onload?.());}}
const geometry={analyze:group=>({items:group.items.map(i=>({id:i.id,at:i.x<50?null:i.x,total:600,hits:[],orderSensitive:i.y<50,reason:'synthetic metric'}))}),basePoints:()=>[],arrange:()=>true};
const scope={console,document,Image:ImageDouble,SirenCore:C,SirenIntersections:{prepare:()=>geometry},SirenStrip:{},SirenRecognition:{createRecognitionBoundary:()=>()=>true,workerSource:()=>''},SirenScan:{create:()=>({cancel(){cancels++;},async run(payload){lastPayload=payload;scanCalls++;return typeof scanReply==='function'?scanReply(payload):scanReply;}})},BabelianTextFormat:F,SirenFormat:require('../src/siren-format.js'),BabelianTranslation:{...T,createClient:()=>async()=>''},BabelianHost:{download:async(blob)=>downloads.push(blob)},confirm:()=>confirmReply,window:{addEventListener:(k,f)=>events.set(k,f)},navigator:{clipboard:{}},Blob,URL,DataView,Uint8Array,atob,setTimeout,clearTimeout};
vm.createContext(scope);vm.runInContext(fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8'),scope);
const el=id=>nodes.get('siren-'+id),click=id=>el(id).click(),snapshot=()=>JSON.stringify(ui.snapshot()),lastArc=()=>el('source-canvas').ctx.arcs.at(-1),approx=(a,b)=>assert(Math.abs(a-b)<1e-7,`${a} != ${b}`);
const ui=scope.SirenUI.mount({assets,path:[],wordData:'a b c',notify(){}});
const imageFile=()=>Object.assign(new Blob(['synthetic source'],{type:'image/png'}),{name:'synthetic.png'});
async function loadSource(){el('image-file').files=[imageFile()];await el('image-file').fire('change');}
async function loadDoc(value){el('work-file').files=[{size:100,text:async()=>JSON.stringify(value)}];await el('work-file').fire('change');}
function result(cx,cy,size=500,unknown=true){const glyph={letter:'A',x:cx-20,y:cy,size:size*.3,rotation:0,score:.9};return {base:{cx,cy,size,rotation:0},items:[{...glyph,letter:unknown?null:'A',candidates:[glyph]}]};}
async function roi(x,y,width,height){const r=el('source-canvas').getBoundingClientRect(),p=(a,b)=>({clientX:r.left+a*r.width/sourceDimensions.width,clientY:r.top+b*r.height/sourceDimensions.height});await el('source-canvas').fire('pointerdown',p(x,y));await el('source-canvas').fire('pointermove',p(x+width,y+height));await el('source-canvas').fire('pointerup',p(x+width,y+height));}
function dirty(){let yes=false;events.get('beforeunload')({preventDefault(){yes=true;}});return yes;}
(async()=>{
 await ui.ready;await click('mode-review');await loadSource();el('source-canvas').rect={left:20,top:30,width:800,height:400};
 scanReply=[result(400,400),result(1200,400)];await click('auto-scan');assert.equal(ui.snapshot().groups.length,2);assert.equal(ui.snapshot().groups[0].image,ui.snapshot().groups[1].image,'PNG identity is deliberately identical');
 assert.match(el('pending-status').textContent,/待复核 2 项/);await click('save');assert(!dirty());const initial=snapshot();
 await click('next-pending');assert.equal(snapshot(),initial);approx(lastArc()[0],380);approx(lastArc()[1],400);assert.equal(document.activeElement,el('stage'));assert.equal(el('stage').focusOptions.preventScroll,true);assert(!el('key-replace').disabled);
 await click('next-pending');approx(lastArc()[0],1180);await click('next-pending');approx(lastArc()[0],380);assert(!dirty(),'Navigation must not create an edit/history entry');
 // Reorder, delete and undo preserve independent source locations, even for identical PNGs.
 await click('group-next');approx(lastArc()[0],380);await click('next-pending');approx(lastArc()[0],1180);await click('delete-group');assert.equal(ui.snapshot().groups.length,1);await click('undo');await click('next-pending');approx(lastArc()[0],1180);await click('undo');assert.equal(snapshot(),initial);
 // Locked pending glyphs remain reachable without unlocking or changing a glyph.
 await click('next-pending');await click('position-lock');const locked=snapshot();await click('next-pending');await click('next-pending');assert.equal(snapshot(),locked);assert.equal(el('position-lock').textContent,'解锁位置');await click('undo');
 // Refit replaces IDs but preserves the logical screenshot-to-source transform.
 await el('groups').children[0].click();scanReply=[result(300,300,350)];await click('fit-group');await click('next-pending');approx(lastArc()[0],10+(280-20)*780/560);approx(lastArc()[1],400);await click('undo');assert.equal(snapshot(),initial);
 // Deep adoption also replaces IDs. Its selected token still maps through the
 // same source frame; undo restores the original group/region independently.
 await click('next-pending');const deepBefore=snapshot();await click('deep-toggle');await el('stage').fire('pointerdown',{clientX:250,clientY:25});await el('stage').fire('pointerup',{clientX:350,clientY:65});scanReply={candidates:[{letter:'B',x:300,y:45,size:150,rotation:0,score:.9,passesCoverage:true}]};await click('deep-run');await el('deep-candidates').children[0].click();await click('deep-apply');el('guides').checked=false;await click('next-pending');await click('next-pending');approx(lastArc()[0],400);approx(lastArc()[1],10+(45-20)*780/560);assert(el('stage').ctx.arcs.at(-1)[2]>=18,'Pending ring remains visible with guides off');await click('undo');el('guides').checked=true;assert.equal(snapshot(),deepBefore);
 // Existing edits and order survive the new append byte-for-byte. ROI uses source
 // pixels despite offset, CSS scaling, and later non-uniform display scaling.
 const beforeMissing=snapshot(),beforeGroups=JSON.stringify(ui.snapshot().groups);
 await click('missing-toggle');await roi(600,0,400,400);assert(!el('missing-run').disabled);scanReply=[result(200,200,200)];await click('missing-run');assert.equal(lastPayload.operation,'detect');assert.equal(lastPayload.limit,2);assert.equal(lastPayload.image.width,400);assert.equal(lastPayload.image.height,400);assert.equal(snapshot(),beforeMissing);assert(!el('missing-preview').hidden);assert(!el('missing-add').disabled);
 await click('missing-add');assert.equal(ui.snapshot().groups.length,3);const afterAppend=snapshot();await click('missing-add');assert.equal(snapshot(),afterAppend,'Repeated apply cannot duplicate an appended group');assert.equal(JSON.stringify(ui.snapshot().groups.slice(0,2)),beforeGroups);assert(el('missing-panel').hidden);await click('next-pending');approx(lastArc()[0],380);await click('next-pending');approx(lastArc()[0],1180);await click('next-pending');approx(lastArc()[0],780);approx(lastArc()[1],200);
 await click('undo');assert.equal(snapshot(),beforeMissing,'One undo removes only the appended group');
 // Duplicate candidates are rejected by source coordinates, without applying or history.
 await click('missing-toggle');await roi(0,0,800,800);scanReply=[result(400,400)];await click('missing-run');assert.match(el('missing-status').textContent,/已对应第 1 组/);assert(el('missing-add').disabled);assert.equal(snapshot(),beforeMissing);
 // Empty, ambiguous, worker failure, tiny selection and cancelled pointer are non-mutating.
 for(const [reply,message] of [[[],/未找到/],[[result(200,200,200),result(350,250,200)],/多个大螺旋/],[()=>Promise.reject(Error('检测到的大螺旋过多')),/多个大螺旋/]]){await roi(600,0,400,400);scanReply=reply;await click('missing-run');assert.match(el('missing-status').textContent,message);assert.equal(snapshot(),beforeMissing);assert(el('missing-add').disabled);}
 await roi(600,0,4,4);assert(el('missing-run').disabled);await el('source-canvas').fire('pointerdown',{clientX:320,clientY:30});await el('source-canvas').fire('pointermove',{clientX:520,clientY:230});await el('source-canvas').fire('pointercancel');assert(el('missing-run').disabled);assert.equal(snapshot(),beforeMissing);
 el('source-canvas').rect={left:55.3,top:80.2,width:400.7,height:399.3};await roi(600,0,400,400);scanReply=[result(200,200,200)];await click('missing-run');assert.equal(lastPayload.image.width,400);assert.equal(lastPayload.image.height,400);await click('missing-close');assert.equal(snapshot(),beforeMissing);
 // Scan cancel, panel close, source replacement, mode switch and concurrent edits
 // reject late responses. The worker double intentionally resolves after cancel.
 for(const action of ['scan-cancel','missing-close','escape-panel','replace-source','mode-switch','pause','revision']){
  await click('missing-toggle');await roi(600,0,400,400);let release;scanReply=new Promise(r=>release=r);const running=click('missing-run');const saved=snapshot();
  if(action==='pause'){ui.pause();ui.refresh();}else if(action==='escape-panel'){el('missing-run').focus();await el('missing-run').fire('keydown',{key:'Escape'});}else if(action==='replace-source')await loadSource();else if(action==='mode-switch'){await click('mode-generate');await click('mode-review');}else if(action==='revision')await click(el('group-next').disabled?'group-prev':'group-next');else await click(action);
  const afterAction=snapshot();release([result(200,200,200)]);await running;assert.equal(snapshot(),afterAction);if(action!=='revision')assert.equal(afterAction,saved);assert(el('missing-add').disabled);if(!el('missing-panel').hidden)await click('missing-close');if(action==='revision')await click('undo');
 }
 assert(cancels>0);
 // Work files have no full-source provenance. Require explicit duplicate review
 // before adding; refusal leaves preview/work unchanged and acceptance only appends.
 await loadDoc(ui.snapshot());await click('missing-toggle');await roi(600,0,400,400);scanReply=[result(200,200,200)];await click('missing-run');const beforeUnknown=snapshot();confirmReply=false;await click('missing-add');assert.equal(snapshot(),beforeUnknown);assert(!el('missing-preview').hidden);confirmReply=true;await click('missing-add');assert.equal(ui.snapshot().groups.length,3);await click('undo');assert.equal(snapshot(),beforeUnknown);
 // A candidate becomes invalid as soon as existing work is edited.
 await click('missing-toggle');await roi(600,0,400,400);await click('missing-run');await el('items').children[0].click();await click('position-lock');const afterLock=snapshot();await click('missing-add');assert.equal(snapshot(),afterLock);assert(el('missing-panel').hidden);await click('undo');
 // Pending navigation covers unknown, unplaced, sensitive and tie-generated [?],
 // deduplicates reasons, respects current group order and highlights old-work crops.
 const work=C.create('review'),a=C.addGroup(work),b=C.addGroup(work);a.image=b.image=png;
 C.add(a,null,{x:100,y:100}).positionLocked=true;C.add(a,'B',{x:10,y:100});C.add(a,'C',{x:200,y:10});C.add(b,'D',{x:300,y:100});C.add(b,'E',{x:300.5,y:100});await loadDoc(work);const pendingDoc=snapshot();assert.match(el('pending-status').textContent,/待复核 5 项/);assert(!el('next-pending').disabled);assert(!el('missing-toggle').disabled);
 const beforeImportFailure=snapshot();await loadDoc({format:'invalid'});assert.equal(snapshot(),beforeImportFailure);assert(!el('next-pending').disabled);assert(!el('missing-toggle').disabled);confirmReply=false;await loadDoc(work);confirmReply=true;assert.equal(snapshot(),beforeImportFailure);assert(!el('next-pending').disabled);assert(!el('missing-toggle').disabled);
 const reasons=['字母待确认','读序敏感','未定位','交点同序待确认','交点同序待确认'];for(let n=0;n<reasons.length;n++){await click('next-pending');assert.match(el('pending-status').textContent,new RegExp(reasons[n]));assert.match(el('pending-status').textContent,/无此项原图定位/);assert.equal(snapshot(),pendingDoc);assert.equal(el('stage').ctx.arcs.at(-1)[2]>=18,true);}await click('next-pending');assert.match(el('pending-status').textContent,/第 1 项/);
 const clean=C.create('review');const cleanGroup=C.addGroup(clean);cleanGroup.image=png;C.add(cleanGroup,'A',{x:100,y:100});await loadDoc(clean);assert(el('next-pending').disabled);assert.match(el('pending-status').textContent,/没有 \?/);
 const full=C.create('review');for(let n=0;n<50;n++)C.addGroup(full).image=png;await loadDoc(full);assert(el('missing-toggle').disabled);const limitBefore=scanCalls;await click('missing-toggle');assert(el('missing-panel').hidden);assert.equal(scanCalls,limitBefore);assert.equal(ui.snapshot().groups.length,50);
 console.log('PASS synthetic Siren review shortcuts: pending cycle/reasons/locks/no edits, exact source highlights with repeated PNGs, reorder/delete/undo, ROI CSS mapping, preview/append/single undo, duplicate/empty/multi/50 limit, cancel/stale source/revision/mode, old-work fallback and explicit duplicate review. No browser/visual or recognition accuracy claim.');
})().catch(error=>{console.error(error);process.exitCode=1;});
