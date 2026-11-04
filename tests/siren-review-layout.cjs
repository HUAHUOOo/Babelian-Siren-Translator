/* Synthetic tracing/viewport checks. No private answers and no OCR-accuracy claim. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const R=require('../src/siren-review.js'),S=require('../src/siren-format.js'),C=require('../src/siren-core.js');
const doc=C.fromText('HELLOWORLD');doc.mode='review';
const analyze=g=>({items:g.items.map((t,i)=>({id:t.id,at:i*10}))});
const before=JSON.stringify(doc),raw=R.source(doc,analyze,C);
assert.equal(raw.text,'HELLOW ORLD');assert.equal(raw.text,C.read(doc,analyze).text);
const formatted=R.project(raw,'HELLO WORLD','Hello, world!',S.numbers);assert(formatted);
const refs=R.locate(formatted,8);assert.equal(refs.length,5);assert.equal(new Set(refs.map(v=>v.groupId)).size,2);
assert.equal(R.locate(raw,7,7,false)[0].itemId,doc.groups[1].items[0].id);
assert.equal(R.ranges(formatted,[refs[0]])[0].start,7);
assert.equal(R.project(raw,'HELLO WORLD','Hello, word!',S.numbers),null);
assert.equal(R.project(raw,'HELLO WORD','Hello, word!',S.numbers),null);
const source={text:'SEVENTYFIVE[?]ZERO',spans:[...'SEVENTYFIVE'].map((_,i)=>({start:i,end:i+1,groupId:'g',itemId:'i'+i})).concat([{start:11,end:14,groupId:'g2',itemId:'unknown'}],[...'ZERO'].map((_,i)=>({start:i+14,end:i+15,groupId:'g3',itemId:'z'+i})))};
const p=R.project(source,'seventy five [?] zero','75 [?] 0.',S.numbers);assert(p);assert.equal(R.locate(p,0).length,11);assert.equal(R.locate(p,1).length,11);assert.equal(R.locate(p,4)[0].itemId,'unknown');assert.equal(R.locate(p,7).length,4);
assert.equal(R.project(source,'seventy five [?] zero','76 [?] 0',S.numbers),null);
for(const text of ['fifty forty eight','zero five','five and six','one hundred and five','fifty, forty eight']){const trace=[],result=S.numbers(text,trace);assert.equal(result,S.numbers(text));assert.equal(trace.map(p=>result.slice(p.start,p.end)).join(''),result);for(const t of trace)assert(t.end>t.start&&t.sourceEnd>=t.sourceStart);}
const tied=C.fromText('ABC');tied.mode='review';const metrics=g=>({items:g.items.map((t,i)=>({id:t.id,at:i<2?10:null}))});
const unknown=R.source(tied,metrics,C);assert.equal(unknown.text,'[?][?]');assert.equal(R.locate(unknown,0,0,false).length,1);assert.equal(R.locate(unknown,3,3,false).length,1);
for(const rect of [{left:10,top:20,width:300,height:300},{left:-430,top:-210,width:1200,height:1200}]){const p=R.point({clientX:rect.left+rect.width*.23,clientY:rect.top+rect.height*.71},rect);assert(Math.abs(p.x-138)<1e-7);assert(Math.abs(p.y-426)<1e-7);}
for(const p of [{x:0,y:0},{x:600,y:600},{x:15,y:590},{x:300,y:300}]){const f=R.lensFrame(p,90);assert(f.x>=0&&f.y>=0&&f.x+f.size<=600&&f.y+f.size<=600);assert(p.x>=f.x&&p.x<=f.x+f.size&&p.y>=f.y&&p.y<=f.y+f.size);}
assert.equal(JSON.stringify(doc),before);
const html=fs.readFileSync(require.resolve('../src/siren-panel.html'),'utf8'),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length);
assert(html.indexOf('id="siren-results"')<html.indexOf('id="siren-review-workspace"'));assert(!/<details[^>]*id="siren-raw-details"[^>]*\sopen/.test(html));
for(const id of ['siren-review-toggle','siren-view-mode','siren-edit-mode','siren-zoom-fit','siren-zoom-2','siren-zoom-4','siren-contact-lens','siren-location-review','siren-item-prev','siren-item-next'])assert(ids.includes(id));
console.log('PASS source tracing: cross-group words, cardinal/zero/unknown many-to-one mapping, punctuation edits, changed-text refusal, tied/unplaced items, zoom/pan coordinates, edge lens bounds, immutable inputs, result-first markup and unique controls.');
