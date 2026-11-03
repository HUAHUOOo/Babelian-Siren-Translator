/* Coarse early-out proof checks plus full public-image equivalence. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const E=require('../src/siren-recognition.js'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs'),decodePNG=require('./png.cjs');
const source=fs.readFileSync(require.resolve('../src/siren-recognition.js'),'utf8');
const start=source.indexOf(' function support('),end=source.indexOf(' function insertTop(',start);
assert(start>=0&&end>start);
const score=vm.runInNewContext(source.slice(start,end)+';support',{Math,rad:n=>n*Math.PI/180});
let seed=32621,pruned=0,passing=0;
const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
for(let k=0;k<10000;k++){
 const width=48,height=48,n=1+k%96;
 const ink=Float32Array.from({length:width*height},()=>[1,.8,.69,.6900001,.6899999,rand()][k%6]);
 const mask=Float32Array.from({length:width*height},()=>rand()<.3?1:0);
 const pts=Float32Array.from({length:n*2},()=>rand()-.5),fit={cx:rand()*width,cy:rand()*height,size:8+rand()*64,rotation:rand()*360-180};
 const bitmap={width,height,ink},baseMask=k%7?{ink:mask}:null,negative=k%9?null:pts;
 const full=score(bitmap,pts,fit,baseMask,negative),fast=score(bitmap,pts,fit,baseMask,negative,.69);
 const valid=full.score>.69&&full.uniqueFraction>.35&&full.visible>.95;
 if(fast===null){assert(!valid,'Early bound removed a passing candidate');pruned++;}
 else{assert.equal(JSON.stringify(fast),JSON.stringify(full),'Surviving score changed');if(valid)passing++;}
}
assert(pruned>1000);assert(passing>100);
// Transparent/empty, perfect, at-gate and obscured points, including one/two
// samples past each checkpoint and scores arbitrarily close to the gate.
for(const n of [1,15,16,17,31,32,33,63,64,65,96])for(const value of [0,.69-1e-13,.69,.69+1e-13,1]){
 const ink=Array(16*16).fill(value),pts=new Float32Array(n*2),fit={cx:8,cy:8,size:8,rotation:0};
 for(const base of [null,{ink:Array(256).fill(0)},{ink:Array(256).fill(1)}]){
  const full=score({width:16,height:16,ink},pts,fit,base),fast=score({width:16,height:16,ink},pts,fit,base,null,.69);
  if(fast===null)assert(!(full.score>.69&&full.uniqueFraction>.35&&full.visible>.95));
  else assert.equal(JSON.stringify(fast),JSON.stringify(full));
 }
}
assert(source.includes('options.coarsePruning===false||target.ink.some(v=>!Number.isFinite(v)||v<0||v>1)?null:.69'),'Custom input range guard and opt-out must remain');
const decode=a=>({...a,...decodePNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([id,a])=>[id,decode(a)])),path:F.path};
// Reuse only the deterministic public raster generator, not its test runner.
const fixtureSource=fs.readFileSync(require.resolve('./siren-recognition.cjs'),'utf8');
const synthetic=new Function('C','F','templates',fixtureSource.slice(fixtureSource.indexOf('function sample(bitmap'),fixtureSource.indexOf('function reading(result)'))+';return synthetic;')(C,F,templates);
const engine=E.create(templates),hint={cx:300,cy:300,size:500,rotation:0};
for(const text of ['A','AAAAAA','MNOPQR']){
 const bitmap=synthetic(text),original=bitmap.ink.slice(),options={letterCoarseSide:160,fitSide:320};
 const full=engine.fitGroup(bitmap,hint,{...options,coarsePruning:false}),fast=engine.fitGroup(bitmap,hint,options);
 assert.deepEqual(fast,full,'Full poses, candidate order, scores and certainty must match: '+text);
 assert.deepEqual(bitmap.ink,original,'Recognition mutated the source image');
}
console.log('PASS Siren coarse bounds: 10000 deterministic cases, gate/checkpoint boundaries, complete fit equality, original source retained; no timing assertion.');
