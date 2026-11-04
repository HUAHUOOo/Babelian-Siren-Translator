/* Memory/packaging/shared-formatter equivalence; no recognition substitutions. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../src/siren-memory.js'),C=require('../src/siren-core.js'),B=require('../src/text-format.js'),S=require('../src/siren-format.js');
(async()=>{
 const history=M.createHistory({maxEntries:3,maxBytes:600});
 for(let n=0;n<8;n++){const d=C.create('review');d.groups=[{id:'g'+n,image:'x'.repeat(55),items:[]}];history.push(d);d.groups[0].image='changed';assert(history.stats().entries<=3);assert(history.stats().bytes<=600||history.stats().entries===1);assert.equal(history.peek().groups[0].image,'x'.repeat(55));}
 const latest=history.peek();latest.groups=[];assert(history.peek().groups.length);history.pop();assert(history.length>=0);
 const count=M.createHistory({maxEntries:3,maxBytes:1e6});for(let n=0;n<7;n++)count.push({groups:[{id:'g'+n,items:[]}]});assert.deepEqual(count.groupIds(),['g4','g5','g6']);
 const huge=M.createHistory({maxBytes:40});huge.push({groups:[{id:'old'}]});huge.push({groups:[{id:'new',image:'x'.repeat(100)}]});assert.equal(huge.length,1);assert(huge.stats().oversized);assert.equal(huge.peek().groups[0].id,'new');huge.pop();assert.equal(huge.stats().bytes,0);
 let calls=0,settled=0,release;const cache=M.createImageCache(async src=>{calls++;if(src==='slow')await new Promise(r=>release=r);if(src==='bad')throw Error('decode failure');return {src};},()=>settled++);
 const hold=cache.pin(['same','same']);const p=cache.load('same');assert.equal(p,cache.load('same'));await p;assert.equal(calls,1);cache.prune([]);assert(cache.has('same'));hold();hold();cache.prune([]);assert(!cache.has('same'));
 const slow=cache.load('slow');await Promise.resolve();cache.prune([]);release();await slow;cache.prune([]);assert(!cache.has('slow'));await assert.rejects(cache.load('bad'));assert.equal(cache.stats().pending,0);assert.equal(settled,3);
 await cache.load('current');const old=cache.get('current');cache.prune(['current']);assert.equal(cache.get('current'),old);assert.equal(cache.stats().decoded,1);
 const words='a i all the mind eye is burning water fifty seven five zero hello world';const shared=B.create(words),freshB=B.createDraft(B.create(words)),sharedB=B.createDraft(shared),freshS=S.createDraft(B.create(words),B),sharedS=S.createDraft(shared,B);
 for(const text of ['HELLOWORLD','FIFTYSEVEN','THEMINDISBURNING','FIVE[?]ZERO']){
  const payload={text,spans:[]},saved=JSON.stringify(payload);assert.deepEqual(sharedB.generate(payload,{punctuate:true}),freshB.generate(payload,{punctuate:true}));assert.deepEqual(sharedS.generate(payload,{punctuate:true}),freshS.generate(payload,{punctuate:true}));assert.equal(JSON.stringify(payload),saved);
 }
 sharedB.generate({text:'HELLOWORLD'},{});sharedB.edit('HELLO, WORLD!');const b=sharedB.state();sharedS.generate({text:'FIFTYSEVEN'},{});assert.deepEqual(sharedB.state(),b);sharedS.edit('57!');const s=sharedS.state();sharedB.generate({text:'WATER'},{});assert.deepEqual(sharedS.state(),s);
 const Legacy=require('../src/ocr-work.js'),Context=require('../src/ocr-context.js');assert.equal(Legacy.context,Context.context);assert.equal(typeof Legacy.encode,'function');assert.equal(typeof Legacy.parse,'function');
 const html=fs.readFileSync(require.resolve('../index.html'),'utf8');assert(!html.includes('globalThis.GlyphSamplesUI='));assert(!html.includes('MAX_ITEMS=100'));assert(!html.includes("const FORMAT='ato-babelian-recognition-work'"));assert(html.includes('root.BabelianOCRWork=api'));
 const scope={};vm.runInNewContext(fs.readFileSync(require.resolve('../src/ocr-context.js'),'utf8'),scope);assert.equal(typeof scope.BabelianOCRWork.context,'function');assert.equal(scope.BabelianOCRWork.encode,undefined);
 const css=fs.readFileSync(require.resolve('../src/siren.css'),'utf8');assert(!css.includes('glyph-sample'));assert.equal((css.match(/^\s*#siren-stage\s*\{/gm)||[]).length,1);assert.equal((css.match(/^\s*#siren-pending-tools\s*\{/gm)||[]).length,1);
 console.log('PASS cleanup: byte/count-bounded immutable undo with newest-large fallback, image leases/dedup/failure/prune, shared formatter output and draft isolation, context compatibility, source-only legacy modules and consolidated CSS.');
})().catch(e=>{console.error(e);process.exitCode=1;});
