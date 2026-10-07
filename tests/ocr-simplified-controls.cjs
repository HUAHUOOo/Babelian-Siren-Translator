/* Real BabelianOCRUI.mount with DOM nodes parsed from the real panel markup.
 * Unknown ID lookups fail instead of manufacturing nodes. Image/worker/canvas
 * I/O is deterministic; rendering, native pointer behavior and OCR accuracy are
 * deliberately left to the browser/engine suites. No user screenshots. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engine=require('../src/ocr-engine.js'),correction=require('../src/ocr-correction.js');
const Work=require('../src/ocr-work.js'),TextFormat=require('../src/text-format.js'),Translation=require('../src/translation.js');
const html=fs.readFileSync(require.resolve('../src/ocr-panel.html'),'utf8'),source=fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const removed=['ocr-full','ocr-rotate','ocr-forget','ocr-crop-x','ocr-crop-y','ocr-crop-width','ocr-crop-height','ocr-crop-apply','ocr-polarity','ocr-single','ocr-detail','ocr-auto','ocr-threshold','ocr-threshold-value','ocr-summary','ocr-work-save','ocr-work-load','ocr-work-file','ocr-work-status','ocr-undo','ocr-redo','ocr-review-undo','ocr-review-redo','ocr-history-status','ocr-pending-prev','ocr-pending-next','ocr-review-prev','ocr-review-next','ocr-review-keyboard-help','ocr-add-sample','ocr-samples'];
for(const id of removed){assert(!html.includes(`id="${id}"`),`removed markup: ${id}`);assert(!source.includes(`'${id}'`),`removed handler/access: ${id}`);}
assert(!/Work\.(history|encode|parse)|restoreCorrection|beforeCorrection|recordCorrection|GlyphSamplesUI|samples\.add/.test(source),'removed exclusive handlers must not remain');
const fixture={width:500,height:160,threshold:127,polarity:'dark',lines:[{box:{x:10,y:20,width:240,height:40},tokens:[[10,40,'h'],[65,101,'f'],[190,60,'h']].map(([x,width,id])=>({box:{x,y:20,width,height:40},id,score:.8,certain:false,manual:false,candidates:[{id,score:.8},{id:id==='h'?'f':'h',score:.7}]}))}]};
function harness(useWorker){
 const nodes=new Map(),lookups=[],documentEvents={},windowEvents={},recognitions=[],preparations=[],notifications=[],appended=[],edited=[];
 let document,matchCount=0,failAt=0;
 class CanvasContext{
  constructor(){this.calls=[];this.dash=[];this.stack=[];}
  clearRect(){this.calls=[];}drawImage(){}putImageData(){}fillRect(){}
  getImageData(x,y,width,height){const data=new Uint8ClampedArray(width*height*4);data.fill(255);return {width,height,data};}
  save(){this.stack.push({dash:this.dash,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});}restore(){Object.assign(this,this.stack.pop());}
  setLineDash(dash){this.dash=[...dash];}strokeRect(x,y,width,height){this.calls.push({x,y,width,height,color:this.strokeStyle,dash:[...this.dash]});}
 }
 class Element{
  constructor(tag='div'){this.tagName=tag.toUpperCase();this.attrs={};this.children=[];this.parentElement=null;this.events={};this.dataset={};this.className='';this.hidden=false;this.disabled=false;this.checked=false;this.value='';this.textContent='';this.scrollTop=0;this.clientWidth=500;this.ctx=new CanvasContext();
   this.classList={contains:name=>this.className.split(/\s+/).includes(name),add:name=>{if(!this.classList.contains(name))this.className+=' '+name;},remove:name=>{this.className=this.className.split(/\s+/).filter(n=>n!==name).join(' ');},toggle:(name,on)=>{if(on===undefined)on=!this.classList.contains(name);on?this.classList.add(name):this.classList.remove(name);return on;}};
  }
  set width(value){this._width=value;this.ctx.clearRect();}get width(){return this._width||1;}set height(value){this._height=value;this.ctx.clearRect();}get height(){return this._height||1;}
  setAttribute(key,value){this.attrs[key]=String(value);if(key==='id')this.id=value;if(key==='class')this.className=value;if(['value','type'].includes(key))this[key]=String(value);if(['hidden','disabled','checked'].includes(key))this[key]=true;if(['width','height'].includes(key))this[key]=+value;}
  getAttribute(key){return this.attrs[key]??null;}removeAttribute(key){delete this.attrs[key];if(key==='hidden')this.hidden=false;}
  addEventListener(type,fn){(this.events[type]??=[]).push(fn);}async emit(type,event={}){const e={target:this,button:0,pointerId:1,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...event};for(const fn of this.events[type]||[])await fn(e);return e;}
  click(){return this.emit('click');}append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}}replaceChildren(...children){this.children=[];this.append(...children);}
  matches(selector){return selector.split(',').some(s=>{s=s.trim();if(s==='[hidden]')return this.hidden;if(s.startsWith('#'))return this.id===s.slice(1);if(s.startsWith('.'))return this.classList.contains(s.slice(1));if(s.startsWith('[')){return [...s.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,key,value])=>{const actual=key.startsWith('data-')?this.dataset[key.slice(5)]:this.getAttribute(key);return value===undefined?actual!=null:String(actual)===value;});}return this.tagName.toLowerCase()===s;});}
  querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}contains(target){for(let node=target;node;node=node.parentElement)if(node===this)return true;return false;}
  focus(){document.activeElement=this;}select(){}scrollIntoView(){}setPointerCapture(){}getContext(){return this.ctx;}
  getBoundingClientRect(){if(this.id==='ocr-preview')return {left:0,top:0,right:this.width,bottom:this.height,width:this.width,height:this.height};const left=+(this.dataset.token||0)*70,top=+(this.dataset.line||0)*50;return {left,top,right:left+60,bottom:top+40,width:60,height:40};}
 }
 const body=new Element('body'),stack=[body];
 for(const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
  const [,closing,tag,attrs]=match;if(closing){assert.equal(stack.pop().tagName.toLowerCase(),tag);continue;}
  const node=new Element(tag);for(const attr of attrs.matchAll(/([\w:-]+)(?:="([^"]*)")?/g))node.setAttribute(attr[1],attr[2]??'');
  stack.at(-1).append(node);if(node.id){assert(!nodes.has(node.id));nodes.set(node.id,node);}if(!['input','img','br','hr','meta','link'].includes(tag))stack.push(node);
 }
 assert.equal(stack.length,1);
 document={body,activeElement:body,getElementById(id){lookups.push(id);assert(nodes.has(id),`UI accessed missing markup node: ${id}`);return nodes.get(id);},createElement:tag=>new Element(tag),addEventListener(type,fn){(documentEvents[type]??=[]).push(fn);},execCommand(){return true;}};
 const $=id=>{assert(nodes.has(id),id);return nodes.get(id);};$('panel-decode').hidden=false;
 const Image=class{constructor(){this.naturalWidth=600;this.naturalHeight=240;}set src(url){if(!url.startsWith('blob:')){this.naturalWidth=20;this.naturalHeight=30;}queueMicrotask(()=>this.onload?.());}};
 const OCR={...engine,prepareTemplates(templates,options){preparations.push(clone(options));return templates;},workerSource(){return 'test worker';},async recognize(image,templates,options){recognitions.push(clone(options));return clone(fixture);},binarize(image){return {width:image.width,height:image.height,data:new Uint8Array(image.width*image.height)};},bounds(mask,x,y,right,bottom){return {x,y,width:right-x,height:bottom-y};},describe(){return {};},matchDescriptor(){if(++matchCount===failAt)throw Error('synthetic matching failure');return [{id:'h',score:.8}];}};
 const context={console,document,Image,URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},Blob,Uint8Array,Uint8ClampedArray,setTimeout,clearTimeout,queueMicrotask,TextEncoder,AbortController,confirm:()=>true,navigator:{},matchMedia:()=>({matches:false}),BabelianOCR:OCR,BabelianOCRWork:Work,BabelianOCRCorrection:correction,BabelianTextFormat:TextFormat,BabelianTranslation:Translation,BabelianDeep:{deep:()=>({uniqueMasks:1,candidates:[{id:'h',score:.8,support:1,variantCount:1}]})}};
 context.window={addEventListener(type,fn){(windowEvents[type]??=[]).push(fn);},scrollBy(){}};
 if(useWorker)context.Worker=class{postMessage({options}){recognitions.push(clone(options));queueMicrotask(()=>this.onmessage({data:{result:clone(fixture)}}));}terminate(){}};
 vm.createContext(context);vm.runInContext(source,context);
 const app=context.BabelianOCRUI.mount({glyphs:{h:{src:'data:h'},f:{src:'data:f'}},wordData:'the of and he her for',getMapping:()=>({h:'h',f:'f'}),editMapping:id=>edited.push(id),append:value=>appended.push(clone(value)),notify:value=>notifications.push(value)});
 const emitDocument=async(type,event={})=>{const e={target:document.activeElement,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},...event};for(const fn of documentEvents[type]||[])await fn(e);return e;};
 return {$,nodes,lookups,document,app,recognitions,preparations,appended,edited,emitDocument,failAfter:n=>{failAt=matchCount+n;},async pointer(start,end=start){await $('ocr-preview').emit('pointerdown',{clientX:start[0],clientY:start[1]});await $('ocr-preview').emit('pointerup',{clientX:end[0],clientY:end[1]});}};
}
(async()=>{
 for(const useWorker of [true,false]){
  const h=harness(useWorker),{$,app}=h;
  const fire=(id,type='click')=>$(id).emit(type),snapshot=()=>clone(app.snapshot()),first=()=>$('ocr-tokens').querySelector('.ocr-token');
  await fire('ocr-upload');assert.equal($('ocr-file').events.change.length,1);
  await $('ocr-file').emit('change',{target:{files:[{name:'fixture.png',type:'image/png',size:100}]}});
  assert(!$('ocr-run').disabled&&!$('ocr-image-area').hidden);assert.deepEqual(snapshot().crop,{x:0,y:0,width:600,height:240});
  await h.pointer([50,30],[550,190]);assert.deepEqual(snapshot().crop,{x:50,y:30,width:500,height:160});
  await fire('ocr-run');assert.match($('ocr-status').textContent,/识别完成/);assert.deepEqual(snapshot().result,fixture);assert.equal($('ocr-output').value,'hfh');assert($('ocr-tokens').hidden&&$('ocr-review').hidden);
  const defaults={polarity:'auto',threshold:null,oneLine:false,detail:true};assert.deepEqual(h.preparations,[defaults]);assert.deepEqual(h.recognitions,[defaults]);
  await h.pointer([80,70]);assert.deepEqual(snapshot().selected,{line:0,token:0});assert(!$('ocr-review').hidden&&!$('ocr-tokens').hidden);
  const original=snapshot();await $('ocr-candidates').children[1].click();assert.equal($('ocr-choice').value,'f');assert.deepEqual(snapshot(),original,'candidate preview cannot mutate recognition');
  $('ocr-choice').value='h';await fire('ocr-confirm-next');assert(snapshot().result.lines[0].tokens[0].manual);assert.deepEqual(snapshot().selected,{line:0,token:1});
  await h.emitDocument('keydown',{key:'ArrowRight'});assert.deepEqual(snapshot().selected,{line:0,token:2});await h.emitDocument('keydown',{key:'ArrowLeft'});assert.deepEqual(snapshot().selected,{line:0,token:1});
  const beforeHistory=snapshot();for(const modifiers of [{ctrlKey:true},{ctrlKey:true,shiftKey:true},{metaKey:true}])assert(!(await h.emitDocument('keydown',{key:'z',...modifiers})).defaultPrevented);assert.deepEqual(snapshot(),beforeHistory,'Ctrl/Cmd-Z must not replay removed correction history');
  $('ocr-pending-only').checked=true;await fire('ocr-pending-only','change');assert.equal($('ocr-tokens').querySelectorAll('.ocr-token').length,2);assert.match($('ocr-pending-status').textContent,/2/);
  await fire('ocr-segmentation-toggle');$('ocr-split-at').value='70';const beforeSplit=snapshot();await fire('ocr-split-at','input');assert.deepEqual(snapshot(),beforeSplit);assert.equal($('ocr-preview').ctx.calls.at(-1).x,115,'crop offset remains in source pixels');
  h.failAfter(2);await fire('ocr-split');assert.deepEqual(snapshot(),beforeSplit,'second-half match failure must not partially split');assert.match($('ocr-status').textContent,/未应用拆分/);
  await fire('ocr-split');assert.equal(snapshot().result.lines[0].tokens.length,4);assert.deepEqual(snapshot().result.lines[0].tokens.slice(1,3).map(t=>t.box.width),[71,30]);assert.equal($('ocr-split-at').value,'50');
  await fire('ocr-merge');assert.equal(snapshot().result.lines[0].tokens.length,3);
  await fire('ocr-rebox');assert($('ocr-review').hidden&&$('ocr-pending-only').disabled&&$('ocr-split').disabled);await h.pointer([118,52],[210,88]);const beforeRebox=snapshot();h.failAfter(1);await fire('ocr-rebox-apply');assert.deepEqual(snapshot(),beforeRebox,'failed rebox matching must retain result and selection');assert.match($('ocr-rebox-status').textContent,/synthetic matching failure/);
  await fire('ocr-rebox-apply');assert.deepEqual(snapshot().result.lines[0].tokens[1].box,{x:68,y:22,width:92,height:36});assert($('ocr-rebox-bar').hidden&&!$('ocr-review').hidden&&!$('ocr-pending-only').disabled);
  await fire('ocr-rebox');const beforeCancel=snapshot();await h.emitDocument('keydown',{key:'Escape'});assert.deepEqual(snapshot(),beforeCancel);assert($('ocr-rebox-bar').hidden);
  await fire('ocr-review-close');$('ocr-pending-only').checked=false;await fire('ocr-pending-only','change');await first().click();await fire('ocr-confirm');assert($('ocr-review').hidden);
  $('ocr-punctuate').checked=false;await fire('ocr-punctuate','change');$('ocr-formatted').value=$('ocr-output').value+'!';await fire('ocr-formatted','input');assert(!$('ocr-formatted-copy').disabled);await fire('ocr-formatted-append');assert.equal(h.appended.at(-1).text,$('ocr-formatted').value);
  await first().click();$('ocr-choice').value='f';await fire('ocr-confirm');assert($('ocr-formatted-copy').disabled,'letter changes invalidate preserved edited formatting');assert($('ocr-formatted').value.endsWith('!'));
  await fire('ocr-format-run');assert(!$('ocr-formatted-copy').disabled);await fire('ocr-append');assert.equal(h.appended.at(-1).text,$('ocr-output').value);
  await first().click();await fire('ocr-edit-map');assert.equal(h.edited.at(-1),'f');
  const beforeDeep=snapshot();await fire('ocr-deep');assert.equal($('ocr-deep-candidates').children.length,1);await $('ocr-deep-candidates').children[0].click();assert.deepEqual(snapshot(),beforeDeep,'deep suggestion remains a preview');
  await fire('ocr-translate-toggle');assert(!$('ocr-translate-panel').hidden);assert($('ocr-translate-run').disabled,'translation still requires explicit consent');await fire('ocr-translate-toggle');
  app.refresh();app.pause();assert.equal($('panel-decode').getAttribute('aria-busy'),'false');
  assert(h.lookups.every(id=>!removed.includes(id)));
 }
 console.log('PASS simplified Babelian controls: full real mount against markup-grounded DOM; upload/pointer crop; worker + fallback fixed defaults; candidate/confirm/filter/arrows; no history interception; atomic split/rebox failures, successful corrections and cancellation; formatting/append/deep preview; removed nodes/handlers absent (DOM/canvas spies, not browser QA).');
})().catch(error=>{console.error(error);process.exitCode=1;});
