/* Synthetic geometry + execution of the real UI handlers with canvas/DOM spies.
 * Browser layout, pointer hit testing and native range behavior are covered by
 * ocr-split-browser.cjs, not by this state-level test. No private inputs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const correction=require('../src/ocr-correction.js'),Work=require('../src/ocr-work.js');
const source=fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>=0&&b>a);return source.slice(a,b);};
const copy=x=>JSON.parse(JSON.stringify(x));
const original={x:57,y:31,width:101,height:40},before=copy(original);
for(const width of [4,5,7,11,101,5000])for(let percent=10;percent<=90;percent++){
 const box={...original,width},[left,right]=correction.splitBoxes(box,percent);
 assert(left.width>=2&&right.width>=2);assert.equal(left.width+right.width,width);
 assert.equal(left.x,box.x);assert.equal(right.x,left.x+left.width);assert.equal(right.x+right.width,box.x+width);
 for(const b of [left,right]){assert.equal(b.y,box.y);assert.equal(b.height,box.height);assert(Number.isInteger(b.width));}
}
assert.deepEqual(original,before);assert.deepEqual(correction.splitBoxes(original,50).map(b=>b.width),[51,50]);
for(const width of [0,1,2,3,3.5])assert.throws(()=>correction.splitBoxes({...original,width},50),/2像素/);
for(const value of [NaN,Infinity,'50',9,91])assert.throws(()=>correction.splitBoxes(original,value),/10%/);
const html=fs.readFileSync(require.resolve('../src/ocr-panel.html'),'utf8');
assert.match(html,/<input id="ocr-split-at" type="range" min="10" max="90" step="1" value="50" aria-describedby="ocr-split-help">/);
assert.match(html,/<label[^>]*for="ocr-split-at"/);assert.match(html,/<output id="ocr-split-value" for="ocr-split-at"/);
assert(html.indexOf('id="ocr-split-preview"')<html.indexOf('id="ocr-split-at"'));

class CanvasContext{
 constructor(){this.calls=[];this.dash=[];this.stack=[];}
 clearRect(){this.calls=[];}drawImage(){}fillRect(){}
 save(){this.stack.push({dash:this.dash,strokeStyle:this.strokeStyle,lineWidth:this.lineWidth});}
 restore(){Object.assign(this,this.stack.pop());}setLineDash(dash){this.dash=[...dash];}
 strokeRect(x,y,width,height){this.calls.push({x,y,width,height,color:this.strokeStyle,dash:[...this.dash]});}
}
class Element{
 constructor(id){this.id=id;this.events={};this.attributes={};this.hidden=false;this.disabled=false;this.value='50';this.clientWidth=320;this.ctx=new CanvasContext();this.classList={toggle(){},remove(){}};}
 set width(v){this._width=v;this.ctx.clearRect();}get width(){return this._width||1;}set height(v){this._height=v;this.ctx.clearRect();}get height(){return this._height||1;}
 addEventListener(type,fn){this.events[type]=fn;}setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}getContext(){return this.ctx;}
 querySelector(){return {scrollTop:0,focus(){}};}querySelectorAll(){return [];}replaceChildren(){}focus(){}scrollIntoView(){}
}
const nodes=new Map(),$=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
const token=(x,width,id='h')=>({box:{x,y:20,width,height:40},id,score:.9,manual:false,certain:false,candidates:[{id,score:.9}]});
const fixture={width:500,height:160,threshold:127,polarity:'dark',lines:[{box:{x:10,y:20,width:305,height:40},tokens:[token(10,40),token(65,101),token(180,3),token(220,90)]}]};
const context={console,Map,Set,Uint8Array,Blob,Error,Number,Math,JSON,BabelianOCRCorrection:correction,Work,$,seed:copy(fixture)};
vm.createContext(context);
vm.runInContext(`
 let source={width:1000,height:400},crop={x:73,y:41,width:500,height:160},result=seed,selected={line:0,token:1},rebox=null,drag=null,busy=false,deepSuggestion=null,splitToken=null,reviewContext=null,revision=0;
 const preview=$('ocr-preview'),ctx=preview.getContext('2d'),panel=$('panel-decode'),history=Work.history(),prepared=[];
 preview.clientWidth=500;const resultImage={width:500,height:160};let matches=0,failMatch=0;
 const OCR={binarize:()=>({width:500,height:160,data:new Uint8Array(500*160)}),bounds:(_mask,x,y,right,bottom)=>({x:x+1,y:y+1,width:Math.max(1,right-x-2),height:bottom-y-2}),describe:()=>({}),matchDescriptor:()=>{if(++matches===failMatch)throw Error('synthetic matching failure');return [{id:'h',score:.8}];}};
 function touchWork(){revision++;}function message(text){$('ocr-status').textContent=text;}
 function syncReviewControls(){syncSplitControls();}function endRebox(){rebox=null;}function focusSelected(){}function revealSelected(){}
 function setEditorVisible(open){$('ocr-review').hidden=!open;}function setReviewOpen(open){$('ocr-tokens').hidden=!open;}
 function renderResults(){setEditorVisible(!!selected);const token=active();reviewContext=token?{...Work.context(result,selected),token,image:{}}:null;syncSplitControls();drawReviewContext();}
 ${slice('  const historySnapshot=', '  function imageElement(')}
 ${slice('  function draw(){','  function point(')}
 ${slice('  function select(line,token){','  function revealSelected(')}
 ${slice('  function setSegmentationOpen(open){',"  $('ocr-review-toggle').addEventListener")}
 ${slice('  function active(){','  function renderReview(){')}
 ${slice('  function imageMask(',"  $('ocr-merge').addEventListener")}
 $('ocr-segmentation').hidden=true;renderResults();draw();
 globalThis.h={snapshot:()=>JSON.parse(JSON.stringify({result,selected,revision,history:history.state()})),select,closeReview,open:setSegmentationOpen,restore:restoreCorrection,refresh:renderResults,resize:()=>{draw();drawReviewContext();},failAfter:n=>{failMatch=matches+n;},rebox:v=>{rebox=v;syncReviewControls();},resetSplitPreview};
`,context);
const h=context.h,fire=(id,type='click')=>$(id).events[type](),set=percent=>{$('ocr-split-at').value=String(percent);fire('ocr-split-at','input');};
const unchanged=h.snapshot();h.open(true);assert.equal($('ocr-split-at').value,'50');
for(const percent of [10,30,70,90]){
 set(percent);assert.deepEqual(h.snapshot(),unchanged,'live preview must not change result, selection, revision or history');
 const [left,right]=correction.splitBoxes(fixture.lines[0].tokens[1].box,percent);
 const area=Work.context(fixture,{line:0,token:1}).box;
 for(const id of ['ocr-context','ocr-split-preview']){
  const calls=$(id).ctx.calls;assert.equal(calls.length,2);assert.deepEqual(calls.at(-1),{x:left.x-area.x,y:left.y-area.y,width:left.width,height:left.height,color:'#1768dc',dash:[]});assert.equal(calls[0].width,right.width);assert(calls[0].dash.length);
 }
 assert.deepEqual($('ocr-preview').ctx.calls.at(-1),{x:73+left.x,y:41+left.y,width:left.width,height:left.height,color:'#1768dc',dash:[]});
 assert.match($('ocr-split-at').attributes['aria-valuetext'],new RegExp('左侧 '+left.width+' 像素'));
}
$('ocr-preview').clientWidth=200;h.resize();assert.equal($('ocr-preview').ctx.calls.at(-1).x,73+65,'zoom changes presentation, never source coordinates');
h.open(false);assert.equal($('ocr-split-at').value,'50');assert.equal($('ocr-context').ctx.calls.length,1);assert.equal($('ocr-context').ctx.calls[0].width,101);h.open(true);
set(70);h.select(0,0);assert.equal($('ocr-split-at').value,'50');h.select(0,1);assert.equal($('ocr-split-at').value,'50');
set(30);h.closeReview();assert.deepEqual(h.snapshot().result,fixture);h.select(0,1);assert.equal($('ocr-split-at').value,'50');
h.select(0,2);assert($('ocr-split-at').disabled&&$('ocr-split').disabled);assert.equal($('ocr-context').ctx.calls.length,1);h.select(0,1);
set(70);h.failAfter(2);const atomic=h.snapshot();fire('ocr-split');assert.deepEqual(h.snapshot(),atomic);assert.match($('ocr-status').textContent,/未应用拆分/);
fire('ocr-split');const split=h.snapshot(),boxes=correction.splitBoxes(fixture.lines[0].tokens[1].box,70);
assert.equal(split.result.lines[0].tokens.length,5);assert.deepEqual(split.result.lines[0].tokens.slice(1,3).map(t=>t.box),boxes,'applied boxes match preview even when ink is narrower');
assert.equal(split.history.undo,1);assert.equal(split.revision,1);assert.equal($('ocr-split-at').value,'50');
for(const t of split.result.lines[0].tokens.slice(1,3))assert(!t.manual&&!t.certain);
assert.deepEqual(split.result.lines[0].tokens[0],fixture.lines[0].tokens[0]);assert.deepEqual(split.result.lines[0].tokens[3],fixture.lines[0].tokens[2]);
h.restore(-1);assert.deepEqual(h.snapshot().result,fixture);assert.equal($('ocr-split-at').value,'50');h.restore(1);assert.deepEqual(h.snapshot().result,split.result);
fire('ocr-split');assert.equal(h.snapshot().result.lines[0].tokens.length,6);assert.equal(h.snapshot().history.undo,2);h.restore(-1);assert.deepEqual(h.snapshot().result,split.result);
h.rebox({});assert($('ocr-split-at').disabled&&$('ocr-split').disabled);const locked=h.snapshot();fire('ocr-split');assert.deepEqual(h.snapshot(),locked);h.rebox(null);
console.log('PASS split slider: source-pixel geometry, min widths, range markup, live blue canvas overlays, crop/zoom offsets, preview immutability, cancellation/selection reset, atomic failure, exact applied bounds, repeated split, undo/redo and rebox lock (DOM/canvas spies; not browser rendering).');
