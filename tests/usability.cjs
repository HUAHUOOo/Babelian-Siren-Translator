const assert=require('node:assert/strict');
const A=require('../src/image-assist.js'),L=require('../src/text-locator.js'),G=require('../src/siren-reading-guide.js'),OCR=require('../src/ocr-engine.js'),T=require('../src/text-format.js'),C=require('../src/siren-core.js');
const {masks,draw}=require('./ocr.cjs');
function embed(src,x,y,width,height){const data=new Uint8ClampedArray(width*height*4).fill(255);for(let row=0;row<src.height;row++)data.set(src.data.subarray(row*src.width*4,(row+1)*src.width*4),((row+y)*width+x)*4);return {width,height,data};}
for(const light of [false,true]){
 const text=draw(['hereisthepalace','thereforewater'].map(t=>[...t]),{height:38,gap:1,light}),image=embed(text,80,180,text.width+160,text.height+380),original=image.data.slice();
 const r=A.analyze(image,masks,OCR);assert(r.crop,'No selection for public generated glyphs');assert(r.crop.y>100&&r.crop.y<200);assert(r.crop.y+r.crop.height>=180+text.height-15);assert(r.crop.x<100);assert(r.probes<=2400);assert.deepEqual(image.data,original);
}
const blank={width:200,height:200,data:new Uint8ClampedArray(160000).fill(255)};assert.equal(A.analyze(blank,masks,OCR).crop,null);assert(A.quality(blank).length>0);
const small=draw([Array(12).fill('h')],{height:12});assert(A.quality(small,null,[12]).some(s=>s.includes('偏小')));
// Two disconnected and similarly strong regions: never silently pick one.
const text=draw(['thereforewater'].map(t=>[...t]),{height:30}),multiple=embed(text,50,60,text.width+100,420);
for(let y=0;y<text.height;y++)multiple.data.set(text.data.subarray(y*text.width*4,(y+1)*text.width*4),((y+280)*multiple.width+50)*4);
const multi=A.analyze(multiple,masks,OCR);assert.equal(multi.crop,null);assert(multi.ambiguous);
const result={lines:[{tokens:[{id:'a'},{id:'word'},{id:null,candidates:[{id:'b'}]}]},{tokens:[{id:'c'},{id:null,candidates:[]}]}]},map={a:'a',word:'THE',b:'b',c:'c'};
const raw=L.payload(result,map,OCR);assert.equal(raw.text,OCR.toWriter(result,map).text);const projected=T.reflow(raw,'a THE b c [?]');
assert.deepEqual(L.locate(projected,3),[{line:0,token:1}]);assert.deepEqual(L.locate(projected,10),[{line:1,token:1}]);
assert.deepEqual(L.locate(projected,6,9),[{line:0,token:2},{line:1,token:0}]);assert.deepEqual(L.locate(projected,1),[]);
assert.throws(()=>T.reflow(raw,'a THE x c [?]'));
const cross=T.reflow(raw,'aTHEbc[?]');assert.equal(L.locate(cross,4).length,4,'One cross-line word may cover multiple source rows');
const group={items:[{id:'a',letter:'A',x:1,y:2},{id:'b',letter:null,fit:{candidates:[{letter:'B'}]},x:3,y:4},{id:'c',letter:'C'}]},metrics={items:[{id:'a',at:20,first:{x:7,y:8},orderSensitive:true},{id:'b',at:10},{id:'c',at:null}],points:[]};
const before=JSON.stringify([group,metrics]),plan=G.plan(group,metrics);assert.deepEqual(plan.entries.map(e=>e.id),C.ordered(group,metrics).filter(e=>e.at!==null).map(e=>e.item.id));assert.equal(plan.missing,1);assert(plan.entries[0].unconfirmed);assert(plan.entries[1].sensitive);assert.equal(JSON.stringify([group,metrics]),before);assert.deepEqual(G.plan(null).entries,[]);
console.log('PASS usability helpers: bounded dual-polarity selection/fallback, immutable pixels, quality notices, exact edited-text/source links and cross-line/word glyphs, read-only Siren order.');
