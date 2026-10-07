/* Synthetic DOM, canvas and recognition doubles only. This checks popup state
 * and retained control behavior; it is NOT browser, visual or OCR-accuracy QA. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/siren-core.js'),F=require('../src/text-format.js'),T=require('../src/translation.js'),assets=require('../src/siren-glyphs.json');
const markup=fs.readFileSync(require.resolve('../src/siren-panel.html'),'utf8');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M8AAAICAQB7CY0KAAAAAElFTkSuQmCC';
const nodes=new Map(),documentEvents=new Map(),windowEvents=new Map(),downloads=[];let document,scanReply=[],scanCalls=0;
function listen(map,type,fn){if(!map.has(type))map.set(type,[]);map.get(type).push(fn);}
class Element{
 constructor(tag='div'){
  this.tagName=tag.toUpperCase();this.children=[];this.parentNode=null;this.listeners=new Map();this.attributes={};this.style={};this.width=600;this.height=600;this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.className='';this.clientHeight=200;this.scrollTop=0;
  this.classList={contains:name=>this.className.split(/\s+/).includes(name),toggle:(name,force)=>{const names=new Set(this.className.split(/\s+/).filter(Boolean)),on=force??!names.has(name);if(on)names.add(name);else names.delete(name);this.className=[...names].join(' ');return on;},add:name=>this.classList.toggle(name,true),remove:name=>this.classList.toggle(name,false)};
  this.ctx=new Proxy({arcs:[],drawImage(){},arc(...a){this.arcs.push(a);},getImageData:(x,y,w,h)=>({width:w,height:h,data:new Uint8Array(w*h*4)}),measureText:t=>({width:t.length*10})},{get:(o,k)=>o[k]||(()=>{})});
 }
 addEventListener(k,f){listen(this.listeners,k,f);}setAttribute(k,v){this.attributes[k]=String(v);if(k==='class')this.className=String(v);}getAttribute(k){return this.attributes[k]??null;}
 append(...items){for(const item of items){item.parentNode=this;this.children.push(item);}}replaceChildren(...items){for(const item of this.children)item.parentNode=null;this.children=[];this.append(...items);}
 contains(target){return this===target||this.children.some(child=>child.contains(target));}
 matches(selector){return selector.split(',').some(part=>{part=part.trim();if(part==='[hidden]')return this.hidden;const attrs=[...part.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)];if(!attrs.every(([,k,v])=>v===undefined?this.getAttribute(k)!==null:this.getAttribute(k)===v))return false;part=part.replace(/\[[^\]]+\]/g,'');const id=part.match(/#([\w-]+)/),classes=[...part.matchAll(/\.([\w-]+)/g)];if(id&&this.id!==id[1]||!classes.every(([,name])=>this.classList.contains(name)))return false;const tag=part.match(/^[a-z][\w-]*/i);return !tag||this.tagName===tag[0].toUpperCase();});}
 closest(selector){for(let n=this;n;n=n.parentNode)if(n.matches(selector))return n;return null;}
 querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 getContext(){return this.ctx;}getBoundingClientRect(){return {left:0,top:0,width:600,height:600};}setPointerCapture(){}focus(options){document.activeElement=this;this.focusOptions=options;}blur(){document.activeElement=null;}scrollIntoView(){}select(){}
 async fire(type,extra={}){const event={type,target:this,button:0,pointerId:1,defaultPrevented:false,cancelBubble:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.cancelBubble=true;},...extra};for(let node=this;node;node=node.parentNode){for(const fn of node.listeners.get(type)||[])await fn(event);if(event.cancelBubble)return event;}for(const fn of documentEvents.get(type)||[])await fn(event);return event;}
 click(){if(this.disabled)return;this.focus();return this.fire('click');}toDataURL(){return png;}toBlob(fn){fn(new Blob([''],{type:'image/png'}));}
}
const body=new Element('body'),stack=[body],voids=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for(const part of markup.matchAll(/<!--[\s\S]*?-->|<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi)){
 if(part[0].startsWith('<!--'))continue;const tag=part[1].toLowerCase();if(part[0].startsWith('</')){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName===tag.toUpperCase()){stack.length=i;break;}continue;}
 const node=new Element(tag);for(const attr of part[2].matchAll(/([\w:-]+)(?:="([^"]*)")?/g)){const name=attr[1],value=attr[2]??'';node.setAttribute(name,value);if(['id','min','max','step','value','type'].includes(name))node[name]=value;if(['hidden','disabled','checked','readonly'].includes(name))node[name==='readonly'?'readOnly':name]=true;}
 if(node.id){assert(!nodes.has(node.id),'No duplicate element IDs');nodes.set(node.id,node);}stack.at(-1).append(node);if(!voids.has(tag))stack.push(node);
}
document={body,activeElement:null,getElementById:id=>{assert(nodes.has(id),'Missing '+id);return nodes.get(id);},createElement:tag=>new Element(tag),addEventListener:(k,f)=>listen(documentEvents,k,f),execCommand:()=>true};
class ImageDouble{set src(value){this.value=value;this.width=this.height=600;queueMicrotask(()=>this.onload?.());}}
const geometry={analyze:group=>({items:group.items.map(i=>({id:i.id,at:i.x,total:600,hits:[],orderSensitive:false,reason:'synthetic metric'}))}),basePoints:()=>[{x:300,y:300},{x:310,y:300}],arrange:()=>true};
const scope={console,document,Image:ImageDouble,SirenCore:C,SirenIntersections:{prepare:()=>geometry},SirenStrip:{},SirenRecognition:{createRecognitionBoundary:()=>()=>true,workerSource:()=>''},SirenScan:{create:()=>({cancel(){},async run(payload){scanCalls++;return typeof scanReply==='function'?scanReply(payload):scanReply;}})},BabelianTextFormat:F,SirenFormat:require('../src/siren-format.js'),BabelianTranslation:{...T,createClient:()=>async()=>''},BabelianHost:{download:async(blob)=>downloads.push(blob)},confirm:()=>true,window:{addEventListener:(k,f)=>listen(windowEvents,k,f)},navigator:{clipboard:{}},Blob,URL,DataView,Uint8Array,atob,setTimeout,clearTimeout};
vm.createContext(scope);vm.runInContext(fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8'),scope);
const el=id=>nodes.get('siren-'+id),click=id=>el(id).click(),snapshot=()=>JSON.stringify(ui.snapshot());
const ui=scope.SirenUI.mount({assets,path:[],wordData:'a b c',notify(){}});
async function loadDoc(value){el('work-file').files=[{size:100,text:async()=>JSON.stringify(value)}];await el('work-file').fire('change');}
async function loadSource(){el('image-file').files=[Object.assign(new Blob(['synthetic source'],{type:'image/png'}),{name:'synthetic.png'})];await el('image-file').fire('change');}
function dirty(){let yes=false;for(const fn of windowEvents.get('beforeunload')||[])fn({preventDefault(){yes=true;}});return yes;}
function assertOpen(open){assert.equal(el('precision-panel').hidden,!open);assert.equal(el('precision-toggle').getAttribute('aria-expanded'),String(open));}
async function open(){if(el('precision-panel').hidden)await click('precision-toggle');assertOpen(true);}
async function edit(name,value,type='change'){el(name).value=String(value);await el(name).fire(type);}
function fixture(mode='generate'){
 const work=C.create(mode);work.groups=[];const a=C.addGroup(work),b=C.addGroup(work);a.image=b.image=mode==='review'?png:null;
 for(const [letter,x,y] of [['A',200,300],['B',380,320]]){const token=C.add(a,letter,{x,y});if(mode==='review'){token.fit={score:.9,rotation:token.rotation,candidates:[{letter,score:.9,x,y,size:token.size,rotation:token.rotation},{letter:letter==='A'?'D':'E',score:.8,x:x+5,y,size:token.size,rotation:token.rotation}]};C.rememberPose(a,token,true);}}
 C.add(b,'C',{x:420,y:400});return work;
}
(async()=>{
 await ui.ready;nodes.get('panel-siren').hidden=false;
 // Scope is the screenshot's existing control set, with one live DOM instance.
 const popup=el('precision-panel');assert.equal(popup.getAttribute('role'),'dialog');assert.notEqual(popup.getAttribute('aria-modal'),'true');assert(popup.getAttribute('aria-labelledby'));assert.match(markup,/>精确调节<\/button>/);
 for(const id of ['radius','radius-slider','angle','angle-slider','rotation','rotation-slider','rotation-mode','base-size','base-size-slider','guides','path','overlay','contact','stage-hint','match-review','match-status','match-candidates','position-lock','reset-position'])assert(popup.contains(el(id)),id+' must be in popup');
 for(const id of ['items','precision-toggle','delete-recognized','open-add'])assert(!popup.contains(el(id)),id+' must remain in editor');
 for(const id of ['center','open-replace'])assert(!nodes.has('siren-'+id),id+' must be removed');
 assert(!/centerMode|siren-center|siren-open-replace/.test(fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8')),'Removed controls have no orphan state or handlers');
 assertOpen(false);const empty=snapshot();await open();assert(el('radius').disabled);assert(!el('base-size').disabled);await click('precision-close');assertOpen(false);assert.equal(document.activeElement,el('precision-toggle'));assert.equal(snapshot(),empty);assert(!dirty());
 await loadDoc(fixture());await el('items').children[0].click();await click('save');const initial=snapshot();assert(!dirty());
 for(let i=0;i<12;i++){await open();assert.equal(el('radius').value,'100');await click(i%2?'precision-close':'precision-toggle');assertOpen(false);}assert.equal(snapshot(),initial);assert(!dirty(),'Popup toggles cannot create work edits');
 await open();await el('stage').fire('keydown',{key:'Escape'});assertOpen(false);assert.equal(el('radius').value,'100','Stage Escape must close without dropping selection');assert.equal(snapshot(),initial);assert(!dirty());
 await open();await el('radius').fire('keydown',{key:'Escape'});assertOpen(false);assert.equal(document.activeElement,el('precision-toggle'));assert.equal(snapshot(),initial);
 await open();await popup.fire('click');assertOpen(true);await el('stage').fire('click');assertOpen(true);await el('radius').fire('click');assertOpen(true);await body.fire('click');assertOpen(false);assert.equal(snapshot(),initial);assert(!dirty());
 // Changing item/group updates the same open controls, without changing work.
 await open();await el('items').children[1].click();assertOpen(true);assert.equal(el('radius').value,'82.5');await el('groups').children[1].click();assertOpen(true);assert(el('radius').disabled);await el('items').children[0].click();assert.equal(el('radius').value,'156.2');assert.equal(snapshot(),initial);
 await el('groups').children[0].click();await el('items').children[0].click();await edit('radius',120);assertOpen(true);assert.equal(el('radius-slider').value,120);await click('precision-close');await open();assert.equal(el('radius').value,'120');assert.equal(ui.snapshot().groups[0].items[0].x,180);
 await edit('angle',90);assert.equal(ui.snapshot().groups[0].items[0].y,420);await click('rotation-mode');assert(!el('rotation').readOnly);await edit('rotation-slider',30,'input');await edit('rotation-slider',45,'input');await el('rotation-slider').fire('change');assert.equal(el('rotation').value,'45');
 await click('undo');assertOpen(true);assert.equal(ui.snapshot().groups[0].items[0].rotation,0,'One undo restores a whole slider gesture');await el('items').children[0].click();await click('rotation-mode');assert(el('rotation').readOnly);
 await edit('base-size',600);assert(ui.snapshot().groups[0].items.every(i=>i.size===228));await click('save');const edited=snapshot(),saved=JSON.parse(await downloads.at(-1).text());assert.equal(JSON.stringify(saved),edited);assert(!dirty());await click('precision-close');await open();assert.equal(snapshot(),edited);assert(!dirty());
 for(const id of ['guides','path']){el(id).checked=!el(id).checked;await el(id).fire('change');const value=el(id).checked;await click('precision-close');await open();assert.equal(el(id).checked,value);}assert.equal(snapshot(),edited);assert(!dirty());
 // Import/mode lifecycle closes, then keeps the imported review values and locks.
 await loadDoc(fixture('review'));assertOpen(false);await el('items').children[0].click();await open();assert(!el('contact').hidden);assert(!el('overlay-label').hidden);await edit('angle',90);assert(!ui.snapshot().groups[0].items[0].fit);await click('reset-position');assertOpen(true);assert.equal(ui.snapshot().groups[0].items[0].x,200);assert(ui.snapshot().groups[0].items[0].fit);
 await click('position-lock');assertOpen(true);for(const id of ['radius','angle','rotation','radius-slider','rotation-slider','rotation-mode','base-size','base-size-slider','contact'])assert(el(id).disabled,id+' locked');const locked=snapshot();await edit('radius',140);await edit('angle-slider',10,'input');await click('precision-close');await open();assert.equal(snapshot(),locked);assert(el('radius').disabled);assert.equal(el('radius').value,'100');await click('position-lock');assert(!el('radius').disabled);
 // Moved candidates follow the current selection, retain scores, apply and undo.
 await el('items').children[1].click();assertOpen(true);assert.match(el('match-status').textContent,/^B/);assert.match(el('match-candidates').children[1].getAttribute('aria-label'),/候选 E/);
 await el('items').children[0].click();assert.match(el('match-status').textContent,/^A/);assert.equal(el('match-candidates').children.length,2);assert.match(el('match-candidates').children[1].getAttribute('aria-label'),/候选 D/);
 const candidateBefore=snapshot();await el('match-candidates').children[1].click();assertOpen(true);assert.equal(ui.snapshot().groups[0].items[0].letter,'D');assert.equal(ui.snapshot().groups[0].items[0].x,205);assert.match(el('match-status').textContent,/^D/);await click('undo');assert.equal(snapshot(),candidateBefore);assert(el('match-review').hidden,'Undo clears the old selection');await el('items').children[0].click();
 await click('position-lock');const candidateLocked=snapshot();assert(el('match-candidates').children.every(button=>button.disabled));assert(el('reset-position').disabled);await el('match-candidates').children[1].click();assert.equal(snapshot(),candidateLocked);await el('stage').fire('keydown',{key:'Z'});assert.equal(snapshot(),candidateLocked,'Locked items reject direct keyboard replacement');await click('precision-close');await open();assert.equal(el('position-lock').getAttribute('aria-pressed'),'true');await click('position-lock');
 // Existing direct A-Z replacement and the add keyboard remain available.
 const manualBefore=snapshot();for(const flag of ['ctrlKey','metaKey','altKey','isComposing']){await el('stage').fire('keydown',{key:'Z',[flag]:true});assert.equal(snapshot(),manualBefore,flag+' must not edit');}await el('stage').fire('keydown',{key:'Z'});assertOpen(true);assert.equal(ui.snapshot().groups[0].items[0].letter,'Z');assert.match(el('match-status').textContent,/^Z/);await click('reset-position');assert.equal(ui.snapshot().groups[0].items[0].letter,'Z','Reset preserves a manually chosen letter');await click('undo');await click('undo');assert.equal(snapshot(),manualBefore);await el('items').children[0].click();
 await click('open-add');assert(!el('keyboard-panel').hidden);assert(el('match-review').hidden);await click('keyboard-close');const noSelection=snapshot();await el('stage').fire('keydown',{key:'Z'});assert.equal(snapshot(),noSelection,'A hidden keyboard must not add without a selection');await el('items').children[0].click();assert(!el('match-review').hidden);
 // Closing explicitly cancels hidden calibration actions, and never changes work.
 for(const action of ['contact']){await open();await click(action);const before=snapshot();assert.match(el(action).textContent,/请点击/);await click('precision-close');assertOpen(false);assert.equal(snapshot(),before);await el('stage').fire('pointerdown',{clientX:10,clientY:10});await el('stage').fire('pointerup',{clientX:10,clientY:10});assert.equal(snapshot(),before,'Closed '+action+' must not consume the next canvas click');await el('items').children[0].click();}
 await open();const baseBefore=ui.snapshot().groups[0];await el('stage').fire('pointerdown',{clientX:315,clientY:310});await el('stage').fire('pointerup',{clientX:315,clientY:310});assertOpen(true);assert.equal(ui.snapshot().groups[0].cx,baseBefore.cx);assert.equal(ui.snapshot().groups[0].cy,baseBefore.cy,'Canvas cannot enter a removed center-edit mode');
 await open();await click('mode-generate');assertOpen(false);await open();assert(el('contact').hidden);assert(el('overlay-label').hidden);await click('mode-review');assertOpen(false);
 await open();await loadSource();assertOpen(false);await open();ui.pause();assertOpen(false);ui.refresh();assertOpen(false);
 await open();await click('deep-toggle');assertOpen(false);await click('deep-close');await open();await click('missing-toggle');assertOpen(false);await click('missing-close');
 // Starting a recognition closes promptly; failure/cancel cannot mutate work.
 await open();let release;scanReply=()=>new Promise(r=>release=r);const beforeRun=snapshot(),running=click('auto-scan');await new Promise(r=>setTimeout(r,0));assertOpen(false);await click('scan-cancel');release([]);await running;assert.equal(snapshot(),beforeRun);assert(scanCalls>0);
 await open();scanReply=[];await click('auto-scan');assertOpen(false);assert.equal(snapshot(),beforeRun);await open();await loadDoc({format:'invalid'});assertOpen(false);assert.equal(snapshot(),beforeRun);
 console.log('PASS synthetic precision window: exact relocated control scope/single IDs, repeated toggle/close/Escape/focus, selection/group synchronization, edits/sliders/undo/save, display options, relocated candidates/apply/undo, locks/reset, direct A-Z replacement, removed center mode, contact cancellation and live canvas, mode/source/import/pause/deep/missing/scan lifecycle. No browser/visual or OCR-accuracy claim.');
})().catch(error=>{console.error(error);process.exitCode=1;});
