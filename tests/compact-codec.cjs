/* Compact synchronous RFC 1951 inflate and packed profile tests. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const Compact=require('../src/compact-codec.js'),OCR=require('../src/ocr-engine.js');
const root=path.resolve(__dirname,'..'),apk=require('../scripts/apk-resources.cjs').load(root);

// 1. Exercise stored (level 0), fixed Huffman, and dynamic Huffman DEFLATE blocks.
const payloads=[
  Buffer.alloc(0),
  Buffer.from('hello world'),
  Buffer.from('A'.repeat(4096)+'B'.repeat(4096)+'ABC'.repeat(500)),
  Buffer.from('永世侵入：奥德赛 — Babelian & Siren UTF-8 round-trip 1234567890!'),
  Buffer.from(Array.from({length:65536},(_,i)=>(i*131+(i>>4))&255))
];
for(const level of [0,1,6,9]){
  for(const raw of payloads){
    const deflated=zlib.deflateRawSync(raw,{level});
    const inflated=Compact.inflateRaw(deflated);
    assert.deepEqual(Buffer.from(inflated),raw,`inflateRaw mismatch at level ${level}, len ${raw.length}`);
  }
}
for(const bad of [new Uint8Array([0xff]),new Uint8Array([0x06]),new Uint8Array([0x00,0x05,0x00,0x00,0x00])]){
  assert.throws(()=>Compact.inflateRaw(bad));
}

// 2. Full dictionary + domain-terms UTF-8 inflateText round-trip.
const wordRaw=zlib.gunzipSync(fs.readFileSync(path.join(root,'src/english-words.txt.gz'))).toString('utf8');
const wordB64=zlib.deflateRawSync(Buffer.from(wordRaw,'utf8'),{level:9}).toString('base64');
assert.equal(Compact.inflateText(wordB64),wordRaw,'Full word dictionary round-trip');

// 3. Packed BabelianVectorTemplateProfile round-trip + OCR worker execution.
const rawRows=Buffer.alloc(apk.recognition.variants.length*640);let off=0;
const entries=apk.recognition.variants.map(v=>{
  for(const w of v.rows){rawRows.writeUInt32LE(w>>>0,off);off+=4;}
  for(const w of v.fine.rows){rawRows.writeUInt32LE(w>>>0,off);off+=4;}
  return [v.id,v.targetHeight,v.ratio];
});
const packed={version:1,encoding:'deflate-rows-v1',entries,data:zlib.deflateRawSync(rawRows,{level:9}).toString('base64')};
assert.deepEqual(Compact.unpackVectorProfile(packed,{asArrays:true}),apk.recognition,'Packed vector profile must unpack bit-for-bit identically');
const ids=Object.keys(require('../src/glyphs.json'));
const preparedRaw=OCR.prepareVectorProfile(apk.recognition,ids);
const preparedPacked=OCR.prepareVectorProfile(packed,ids);
assert.deepEqual(preparedPacked,preparedRaw,'Prepared Map from packed profile matches raw profile');
for(const invalid of [{version:2,encoding:'deflate-rows-v1',entries,data:packed.data},{version:1,encoding:'deflate-rows-v1',entries:entries.slice(1),data:packed.data},{version:1,encoding:'deflate-rows-v1',entries:[['a',10]],data:packed.data}]){
  assert.throws(()=>Compact.unpackVectorProfile(invalid),/矢量辅助模板/);
}

// 4. Verify OCR.workerSource() self-contains BabelianCompact and accepts packed profiles.
const {masks,draw}=require('./ocr.cjs');
const img=draw([['A','B']],{height:48,gap:4}),msgs=[];
const ctx={setTimeout,postMessage:m=>msgs.push(m)};
vm.createContext(ctx);vm.runInContext(OCR.workerSource(),ctx);
(async()=>{
  await ctx.onmessage({data:{image:img,templates:masks,options:{vectorProfile:packed}}});
  const last=msgs.at(-1);assert(!last.error,last.error);
  assert.equal(last.result.lines[0].tokens.map(t=>t.id).join(''),'AB');
  // 5. Verify built single-file and ATO pages are slimmed and parse cleanly.
  const standalone=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const ato=fs.readFileSync(path.join(root,'dist/ato/babelian/index.html'),'utf8');
  const standaloneBytes=fs.statSync(path.join(root,'index.html')).size;
  const atoBytes=fs.statSync(path.join(root,'dist/ato/babelian/index.html')).size;
  assert(standaloneBytes<3600000,`Standalone bundle should be slimmed (<3.6MB), got ${standaloneBytes}`);
  assert(atoBytes<1900000,`ATO bundle should be slimmed (<1.9MB), got ${atoBytes}`);
  for(const html of [standalone,ato])for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  console.log(`PASS compact codec & slim bundle: DEFLATE stored/fixed/dynamic, full dictionary, 580 packed vector variants + worker, standalone ${(standaloneBytes/1048576).toFixed(2)} MiB (${standaloneBytes} B), ATO ${(atoBytes/1048576).toFixed(2)} MiB (${atoBytes} B).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
