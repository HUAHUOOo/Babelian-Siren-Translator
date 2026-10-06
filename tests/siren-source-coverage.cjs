/* Source coverage rendering state/coordinate tests, not browser QA. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/siren-ui.js'),'utf8');
const begin=source.indexOf('  function renderSource(){'),end=source.indexOf('  async function loadSourceFile',begin);
assert(begin>=0&&end>begin);
const boxes=[],labels=[];let draws=0;
const c={drawImage(){draws++;},save(){},restore(){},strokeRect(...args){boxes.push(args);},fillRect(){},fillText(...args){labels.push(args);},measureText:t=>({width:t.length*12})};
const canvas={getContext:()=>c,setAttribute(){}},status={textContent:''};
const scope={mode:'review',reviewFocus:null,missing:null,g:()=>null,item:()=>null,sourcePoint:()=>null,source:{width:1400,height:500},sourcePaintKey:null,docs:{review:{groups:[]}},sourceRegions:new Map(),$:id=>id==='siren-source-canvas'?canvas:status};
vm.createContext(scope);vm.runInContext(source.slice(begin,end)+';globalThis.paintSource=renderSource;',scope);
scope.paintSource();assert.equal(draws,1);assert.match(status.textContent,/识别后/);
scope.docs.review.groups=[{id:'cropA',image:'samePNG'},{id:'unrelated',image:'samePNG'},{id:'cropB',image:'samePNG'}];
scope.sourceRegions.set('cropA',{x:100,y:20,width:300,height:280});scope.sourceRegions.set('cropB',{x:900,y:25,width:290,height:275});
scope.paintSource();assert.equal(draws,2);assert.deepEqual(boxes,[[100,20,300,280],[900,25,290,275]]);assert.deepEqual(labels.map(x=>x[0]),['1','3']);assert.match(status.textContent,/已加入 2 组/);assert.match(status.textContent,/不是准确率/);
scope.paintSource();assert.equal(draws,2,'Unchanged render must not repaint large source pixels');
// Reorder/delete/undo reuse original-image positions and reflect current group order.
scope.docs.review.groups=[{id:'cropB',image:'samePNG'},{id:'cropA',image:'samePNG'}];scope.paintSource();assert.deepEqual(labels.slice(-2).map(x=>x[0]),['1','2']);assert.deepEqual(boxes.slice(-2),[[900,25,290,275],[100,20,300,280]]);
scope.docs.review.groups=[{id:'cropA',image:'samePNG'}];scope.paintSource();assert.match(status.textContent,/已加入 1 组/);
scope.docs.review.groups=JSON.parse(JSON.stringify([{id:'cropB',image:'samePNG'},{id:'cropA',image:'samePNG'}]));scope.paintSource();assert.match(status.textContent,/已加入 2 组/);
// A new source clears coverage; stale crops never acquire a box on a different source.
scope.source={width:300,height:100};scope.sourceRegions.clear();scope.sourcePaintKey=null;scope.paintSource();assert.equal(canvas.width,300);assert.match(status.textContent,/识别后/);
assert(source.includes('sourceRegions.clear();sourcePaintKey=null;renderSource()'));
assert(!source.includes('请在下方手动框选'),'Do not point users to removed whole-image crop controls');
console.log('PASS Siren source coverage: source-pixel boxes, group order/delete/undo, unknown provenance exclusion, cached draw and new-source reset.');

// Production source-frame math with an offset ROI and unequal rounded scale axes.
const frameBegin=source.indexOf('  function sourceRegion('),frameEnd=source.indexOf('  function duplicateSource(',frameBegin);
const mapRegion=vm.runInNewContext('('+source.slice(frameBegin,frameEnd).trim()+')',{source:{width:8000,height:4000}});
const mapped=mapRegion({base:{cx:300,cy:250,size:400}},{width:1201,height:721},{x:30,y:20,scale:.8,dx:10,dy:20},{x:4000,y:1000,width:3000,height:1800});
const approx=(a,b)=>assert(Math.abs(a-b)<1e-8);
approx(mapped.base.cx,4000+300*3000/1201);approx(mapped.base.cy,1000+250*1800/721);
approx(mapped.frame.x+((300-30)*.8+10)*mapped.frame.scaleX,mapped.base.cx);
approx(mapped.frame.y+((250-20)*.8+20)*mapped.frame.scaleY,mapped.base.cy);
assert(mapped.x>=0&&mapped.y>=0&&mapped.x+mapped.width<=8000&&mapped.y+mapped.height<=4000);
console.log('PASS source-frame ROI offsets, rounded asymmetric downscale axes and exact logical-to-source mapping.');
