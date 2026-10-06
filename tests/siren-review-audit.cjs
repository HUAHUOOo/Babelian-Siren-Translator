/* Independent source-coordinate and state-boundary audit. Synthetic data only.
 * These are production-function/DOM-spy checks, not browser or pixel-rendering QA. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../src/siren-core.js'),source=fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8');
const slice=(from,to)=>{const a=source.indexOf(from),b=source.indexOf(to,a);assert(a>=0&&b>a,`Missing production section ${from}`);return source.slice(a,b);};
const near=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} != ${b}`),clone=x=>JSON.parse(JSON.stringify(x));
const scope={C,Math,JSON,Number,Map,Set,console,source:{width:11000,height:2100},sourceRegions:new Map(),docs:{review:{groups:[]}},geometry:null,mode:'review',sourceTicket:17,revisions:{review:8},loadingImport:false,sourceLoading:false,missing:null};
scope.doc=()=>scope.docs.review;vm.createContext(scope);
vm.runInContext(slice('  function reviewEntries(){','  function renderPending(){')+slice('  function sourceRegion(','  function clearMissing(')+slice('  function missingCurrent(','  $(\'siren-missing-toggle\').addEventListener'),scope);

// Independent affine round trips: long/tall/full/downscaled and offset ROIs,
// unequal rounding on each axis, cropped edges, and logical letterbox padding.
let rounds=0;
for(const roi of [{x:0,y:0,width:11000,height:2100},{x:523,y:77,width:1023,height:701},{x:4000,y:1,width:53,height:1900},{x:17,y:1600,width:3600,height:331}]){
 const ratio=Math.min(1,3600/Math.max(roi.width,roi.height),Math.sqrt(12000000/(roi.width*roi.height)));
 const canvas={width:Math.round(roi.width*ratio),height:Math.round(roi.height*ratio)};
 for(let n=0;n<40;n++){
  const raw={x:canvas.width*(.04+.92*n/39),y:canvas.height*(.03+.92*((n*17)%40)/39)},frame={x:n*.6,y:n*.3,scale:.2+n*.019,dx:20+n*.4,dy:41-n*.1};
  const token={x:(raw.x-frame.x)*frame.scale+frame.dx,y:(raw.y-frame.y)*frame.scale+frame.dy};
  const result={base:{cx:raw.x,cy:raw.y,size:Math.min(canvas.width,canvas.height)*.25}},region=scope.sourceRegion(result,canvas,frame,roi),group={id:'affine-'+n};
  scope.sourceRegions.set(group.id,region);const point=scope.sourcePoint(group,token);
  assert(point);near(point.x,roi.x+raw.x*roi.width/canvas.width);near(point.y,roi.y+raw.y*roi.height/canvas.height);
  assert(region.x>=0&&region.y>=0&&region.x+region.width<=scope.source.width+1e-8&&region.y+region.height<=scope.source.height+1e-8);
  near(region.base.cx,point.x);near(region.base.cy,point.y);rounds++;
 }
}
assert.equal(scope.sourcePoint({id:'unknown'},{}),null,'An imported/unknown source frame must not be guessed');
scope.sourceRegions.set('outside',{frame:{x:-100,y:0,scaleX:1,scaleY:1}});
assert.equal(scope.sourcePoint({id:'outside'},{x:0,y:0}),null);
assert.equal(scope.sourcePoint({id:'outside'},{x:Infinity,y:0}),null);

// Deduplication follows retained source location, including after manual edits,
// removal and undo. Identical generated thumbnails at distant positions are distinct.
const first={id:'first',image:'same-thumbnail',cx:590,cy:590},second={id:'second',image:'same-thumbnail',cx:10,cy:10};
scope.docs.review.groups=[first,second];
scope.sourceRegions.set(first.id,{base:{cx:100,cy:300,sizeX:200,sizeY:170}});
scope.sourceRegions.set(second.id,{base:{cx:1000,cy:300,sizeX:200,sizeY:170}});
assert.equal(scope.duplicateSource({base:{cx:110,cy:301,sizeX:210,sizeY:175}}),first);
assert.equal(scope.duplicateSource({base:{cx:999,cy:301,sizeX:210,sizeY:175}}),second);
assert.equal(scope.duplicateSource({base:{cx:560,cy:300,sizeX:200,sizeY:170}}),undefined);
scope.docs.review.groups=[second];assert.equal(scope.duplicateSource({base:{cx:100,cy:300,sizeX:200,sizeY:170}}),undefined);
scope.docs.review.groups=clone([first,second]);assert.equal(scope.duplicateSource({base:{cx:100,cy:300,sizeX:200,sizeY:170}}).id,first.id);

// Every captured state component is independently material to accepting a preview.
const target=scope.docs.review,job={source:scope.source,sourceTicket:17,target,revision:8};scope.missing=job;
assert(scope.missingCurrent(job));
for(const [key,value] of [['missing',{}],['source',{}],['sourceTicket',18],['mode','generate'],['loadingImport',true],['sourceLoading',true]]){
 const old=scope[key];scope[key]=value;assert(!scope.missingCurrent(job),`Stale ${key} must reject preview`);scope[key]=old;
}
scope.revisions.review++;assert(!scope.missingCurrent(job));scope.revisions.review--;
scope.docs.review={groups:[]};assert(!scope.missingCurrent(job));scope.docs.review=target;

// Pending traversal uses geometric order and covers every unknown, unplaced,
// tied and order-sensitive glyph exactly once before wrapping. It never edits data.
scope.docs.review={groups:[
 {id:'g1',items:[{id:'late',letter:null},{id:'known',letter:'A'},{id:'lost',letter:'Z'}]},
 {id:'g2',items:[{id:'sensitive',letter:'B',positionLocked:false},{id:'tie1',letter:'C'},{id:'tie2',letter:'D'},{id:'locked',letter:null,positionLocked:true}]}
]};
const metrics={late:{at:8},known:{at:2},lost:{at:null},sensitive:{at:12,orderSensitive:true},tie1:{at:5},tie2:{at:5.5},locked:{at:20}};
scope.geometry={analyze:g=>({items:g.items.map(item=>({id:item.id,...metrics[item.id]}))})};
const events=new Map(),nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{children:[],scrollIntoView(){},focus(){},getBoundingClientRect:()=>({height:600}),clientHeight:200,addEventListener:(event,fn)=>events.set(id+':'+event,fn)});return nodes.get(id);};
scope.$=node;scope.stage=node('stage');scope.groupIndex=0;scope.itemId=null;scope.scanBusy=false;scope.drag=null;scope.reviewFocus=null;scope.centerMode=false;
scope.g=()=>scope.docs.review.groups[scope.groupIndex];scope.item=()=>scope.g().items.find(item=>item.id===scope.itemId);
scope.selectItem=id=>{scope.itemId=id;scope.reviewFocus=null;};scope.clearMissing=()=>{scope.missing=null;};scope.render=()=>{};scope.renderPending=()=>{};
vm.runInContext(slice("  $('siren-next-pending').addEventListener",'  function renderSource(){'),scope);
const before=JSON.stringify(scope.docs.review),next=events.get('siren-next-pending:click');
assert.equal(scope.pendingEntries().length,6);const ids=[];
for(let i=0;i<7;i++){next();ids.push(scope.itemId);assert.equal(scope.reviewFocus.itemId,scope.itemId);}
assert.deepEqual(ids,['late','lost','tie1','tie2','sensitive','locked','late']);
assert.equal(JSON.stringify(scope.docs.review),before);
for(const [key,value] of [['scanBusy',true],['drag',{}],['loadingImport',true],['mode','generate']]){const old=scope[key],selection=scope.itemId;scope[key]=value;next();assert.equal(scope.itemId,selection);scope[key]=old;}
console.log(`PASS independent Siren review audit: ${rounds} source-frame round trips, crop bounds, missing provenance, source-location dedup/delete/undo, stale preview guards, geometric pending traversal/wrap and nonmutation.`);
