/* Fixed-pose diagnostics only: no inference, confidence or geometry mutations. */
const assert=require('node:assert/strict'),E=require('../src/siren-recognition.js'),F=require('./siren-fixture.cjs'),PNG=require('./png.cjs');
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))}),templates={base:decode(F.assets.base),letters:{A:decode(F.assets.letters.A)},path:F.path},engine=E.create(templates);
const empty={width:160,height:160,ink:new Float32Array(25600)},base={cx:80,cy:80,size:130,rotation:12},items=[{letter:'A',x:75,y:95,size:49.4,rotation:-30}],poses=JSON.stringify([base,items]);
const built=engine.reconstruct(empty,base,items),original={width:160,height:160,ink:built.ink.slice()},snapshot=original.ink.slice(),perfect=engine.reconstruct(original,base,items);
assert(perfect.unexplained.every(v=>v===0));assert(perfect.extra.every(v=>v===0));assert(built.extra.some(v=>v>.9));assert(built.unexplained.every(v=>v===0));
const missing=engine.reconstruct(original,base,[]);assert(missing.unexplained.some(v=>v>.5));assert(missing.extra.every(v=>v===0));
const moved=engine.reconstruct(original,base,[{...items[0],x:items[0].x+20}]);assert(moved.extra.some(v=>v>.5));assert(moved.unexplained.some(v=>v>.5));
const doubled=engine.reconstruct(original,base,[...items,...items]);assert.deepEqual(doubled.ink,built.ink,'Union is max ink, not additive darkening');
const unknown=engine.reconstruct(original,base,[...items,{...items[0],letter:null}]);assert.equal(unknown.omitted,1);assert.deepEqual(unknown.ink,built.ink);
assert.deepEqual(original.ink,snapshot);assert.equal(JSON.stringify([base,items]),poses);
assert.throws(()=>engine.reconstruct(empty,{...base,size:NaN},items),/位置/);assert.throws(()=>engine.reconstruct({width:2000,height:2000,ink:[]},base,items),/尺寸/);
console.log('PASS fixed-pose whole-group difference: identical reconstruction is zero, missing/moved/unknown glyphs, max-union overlap, bounded dimensions and immutable source/poses.');
