const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{create,createDraft,reflow}=require('../src/text-format.js');
const map={alpha:'a',beta:'B',word:'CustomWord',blank:''};
const tokens=[
 {id:'alpha',certain:false,manual:false,candidates:[{id:'alpha',score:.6}]},
 {id:null,certain:false,manual:false,candidates:[{id:'word',score:.5}]},
 {id:'beta',certain:false,manual:true,candidates:[{id:'alpha',score:.9}]},
 {id:null,certain:false,manual:false,candidates:[]},
 {id:'blank',certain:false,manual:false,candidates:[{id:'blank',score:.4}]}
];
const result={lines:[{tokens}]},snapshot=JSON.stringify(result),payload=OCR.toWriter(result,map);
assert.equal(OCR.transcribe(result,map),'aCustomWordB[?][未映射]');assert.equal(payload.text,OCR.transcribe(result,map));
assert.deepEqual(payload.spans.map(s=>s.glyph),['alpha','word','beta','blank']);
for(const s of payload.spans)assert.equal(s.text,payload.text.slice(s.start,s.end));
assert.equal(JSON.stringify(result),snapshot,'Candidate display must not confirm or mutate recognition');
const formatted=reflow(payload,'a Custom Word B [?] [未映射]');assert.deepEqual(formatted.spans.map(s=>s.glyph),payload.spans.map(s=>s.glyph));
const draft=createDraft(create('a custom word b')),options={punctuate:false};draft.update(payload,options);draft.edit('a Custom Word B [?] [未映射]');
tokens[0].manual=true;assert.deepEqual(OCR.toWriter(result,map),payload);assert(!draft.update(OCR.toWriter(result,map),options).stale);
map.word='Different';assert(draft.update(OCR.toWriter(result,map),options).stale);assert.equal(draft.state().value,'a Custom Word B [?] [未映射]');
assert.equal(OCR.tokenReading({id:null},map),'[?]');assert.equal(OCR.tokenReading({id:null,candidates:[{id:'missing'}]},map),'[未映射]');
console.log('PASS candidate-first text/spans, fallback candidate, manual override, genuinely missing/unmapped distinction, no confidence mutation, edited formatting preservation.');
