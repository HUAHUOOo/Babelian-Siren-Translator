/* Offline synthetic geometry only. No screenshots or language-dependent decisions. */
const assert=require('node:assert/strict'),I=require('../src/siren-intersections.js'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs');
const glyph={width:20,height:20,pivotX:0,pivotY:0},a=new Uint8Array(400),b=new Uint8Array(400);
for(let y=0;y<20;y++){for(let x=15;x<=16;x++)a[y*20+x]=255;for(let x=9;x<=10;x++)b[y*20+x]=255;}
for(let y=7;y<=9;y++)for(let x=2;x<=5;x++)a[y*20+x]=255;
const args={base:glyph,letters:{A:glyph,B:glyph},path:{points:[[0,9.6],[19,9.6]]},masks:{A:{width:20,height:20,alpha:a},B:{width:20,height:20,alpha:b}}};
const geometry=I.prepare(args);
function group(scale=1){return {cx:0,cy:0,baseSize:20*scale,baseRotation:0,items:[{id:'a',letter:'A',x:0,y:0,size:20*scale,rotation:0,fit:{rotation:0,candidates:[{letter:'A'}]}},{id:'b',letter:'B',x:0,y:0,size:20*scale,rotation:0,fit:{rotation:0,candidates:[{letter:'B'}]}}]};}
let checks=0;const test=v=>{assert(v);checks++};
// Barely missed early ink contact jumps past a second glyph, even though nominal contacts are far apart.
let g=group(),before=JSON.stringify(g),result=geometry.analyze(g,true);test(result.items[0].orderSensitive);test(!result.items[1].orderSensitive);test(result.items[0].at-result.items[1].at>1);test(JSON.stringify(g)===before);
for(const [index,metric] of result.items.entries()){assert.deepEqual(metric.hits,geometry.crossings(result.points,{...g.items[index],rotation:g.items[index].fit.rotation}));checks++;}
const doc={mode:'review',groups:[g]};test(!C.read(doc,q=>geometry.analyze(q,true)).ambiguous);
// Warning does not rewrite or re-sort the chosen reading.
test(C.read(doc,q=>geometry.analyze(q,true)).text==='BA');
const reading=C.read(doc,q=>geometry.analyze(q,true));assert.equal(reading.orderSensitive,1);assert.deepEqual(reading.orderSensitiveGroups,[{index:0,count:1}]);assert.equal(reading.unknown,0);assert.equal(reading.unplaced,0);
// Cache returns an identical result for unchanged geometry, and invalidates on a lock edit.
test(geometry.analyze(g,true)===result);g.items[0].positionLocked=true;test(!geometry.analyze(g,true).items[0].orderSensitive);g.items[0].positionLocked=false;test(geometry.analyze(g,true).items[0].orderSensitive);
// Base-relative probe behaves the same at a different rendering scale.
test(geometry.analyze(group(10),true).items[0].orderSensitive);
// No warnings for generation, explicit manual contacts, locked poses, or unfitted/manual poses.
test(geometry.analyze(group(),false).items.every(i=>!i.orderSensitive));
for(const change of [i=>{i.contact={x:9,y:9.6}},i=>{i.positionLocked=true},i=>{delete i.fit;i.rotationMode='manual';i.rotation=0},i=>{delete i.fit}]){g=group();change(g.items[0]);test(!geometry.analyze(g,true).items[0].orderSensitive);}
// Ordinary within-stroke first-hit drift never triggers the large-jump warning.
g=group();g.items[0].letter='B';g.items[0].fit.candidates[0].letter='B';test(!geometry.analyze(g,true).items[0].orderSensitive);
// A fitted unselected top candidate follows the existing crossing convention, without selecting it.
g=group();g.items[0].letter=null;test(geometry.analyze(g,true).items[0].orderSensitive);test(g.items[0].letter===null);
// Nonintersecting glyph is already unplaced; do not invent a warning or contact.
g=group();g.items[0].y=30;test(geometry.analyze(g,true).items[0].at===null);test(!geometry.analyze(g,true).items[0].orderSensitive);
// Official generated assets retain exact readings and their input is untouched.
const real=I.prepare({base:F.assets.base,letters:F.assets.letters,path:F.path,masks:F.masks});for(const text of ['ABCDEF','ZZZZZZ','MNOPQR','BDAEFC','ABCDEFGHIJKLMNOPQRSTUVWXYZ']){const d=C.fromText(text);for(const g of d.groups){test(F.geometry.arrange(g));}const saved=JSON.stringify(d);test(C.read(d,g=>real.analyze(g,false)).text===text);test(JSON.stringify(d)===saved);test(d.groups.every(g=>real.analyze(g,false).items.every(i=>!i.orderSensitive)));}
console.log(`PASS ${checks} synthetic warning checks: missed early contact, stable drift, unchanged order/ambiguity, cache, scale, manual/locked/generation exclusions, null candidate and no mutation.`);
