const assert=require('node:assert/strict'),{thresholdConsensus}=require('../src/ocr-engine.js');
const token=(id,x,width,extra={})=>({id,box:{x,y:0,width,height:50},score:.9,segmentationMargin:.01,certain:true,...extra});
const pass=(threshold,tokens)=>({threshold,lines:[{box:{x:0,y:0,width:100,height:50},tokens}]});
const chosen=pass(185,[token('shape-1',0,30),token('shape-2',30,30),token('stable',60,40,{segmentationMargin:.1})]);
const first=pass(171,[token('other-1',0,20),token('other-2',20,40),chosen.lines[0].tokens[2]]);
const third=pass(199,first.lines[0].tokens.map(t=>({...t,score:.91})));
const frozen=JSON.stringify([chosen,first,third]);
const result=thresholdConsensus(chosen,[first,chosen,third]);
assert.deepEqual(result.lines[0].tokens.map(t=>t.id),['other-1','other-2','stable']);
assert(result.lines[0].tokens.slice(0,2).every(t=>!t.certain&&t.thresholdConsensus.support===2));
assert.equal(result.lines[0].tokens[2],chosen.lines[0].tokens[2]);
assert.equal(JSON.stringify([chosen,first,third]),frozen);
const ids=p=>({...p,lines:p.lines.map(l=>({...l,tokens:l.tokens.map(t=>({...t,id:'renamed-'+t.id}))}))});
assert.deepEqual(thresholdConsensus(ids(chosen),[first,chosen,third].map(ids)).lines[0].tokens.map(t=>t.id),result.lines[0].tokens.map(t=>'renamed-'+t.id));
assert.equal(thresholdConsensus(chosen,[first,chosen]),chosen);
assert.deepEqual(thresholdConsensus(chosen,[first,chosen,pass(199,[token('third-1',0,30),token('third-2',30,30)])]).lines,chosen.lines);
for(const extra of [{score:.6},{score:.8},{box:{x:-10,y:0,width:10,height:50}}]){
 const weak=pass(199,first.lines[0].tokens.map((t,i)=>i===0?{...t,...extra}:t));
 // A low score, worse fit or different region cannot win a local vote.
 assert.deepEqual(thresholdConsensus(chosen,[chosen,{...weak,threshold:171},weak]).lines,chosen.lines);
}
assert.equal(thresholdConsensus(chosen,[chosen,first,first]),chosen);
assert.deepEqual(thresholdConsensus(chosen,[chosen,first,third,pass(210,[token('v1',0,30),token('v2',30,30)]),pass(220,[token('w1',0,30),token('w2',30,30)])]).lines,chosen.lines);
const long=pass(185,Array.from({length:7},(_,i)=>token('long-'+i,i*10,10)));
const alternate=pass(171,long.lines[0].tokens.map(t=>({...t,id:'alternative-'+t.id})));
assert.deepEqual(thresholdConsensus(long,[alternate,long,{...alternate,threshold:199}]).lines,long.lines);
const confident=pass(185,chosen.lines[0].tokens.map(t=>({...t,segmentationMargin:.1})));
assert.deepEqual(thresholdConsensus(confident,[first,confident,third]).lines,confident.lines);
console.log('PASS threshold consensus: strict majority, opaque IDs, bounded uncertain groups, region/quality gates, unchanged inputs and certain neighbors.');
