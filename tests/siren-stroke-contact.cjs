/* Pixel geometry only. Anonymous synthetic masks, no private poses or text. */
const assert=require('node:assert/strict'),I=require('../src/siren-intersections.js'),C=require('../src/siren-core.js');
const glyph={width:20,height:20,pivotX:0,pivotY:0},a=new Uint8Array(400),b=new Uint8Array(400),base=new Uint8Array(400);
for(let y=0;y<20;y++){for(let x=15;x<=16;x++)a[y*20+x]=255;for(let x=9;x<=10;x++)b[y*20+x]=255;}
for(let y=7;y<=9;y++)for(let x=2;x<=5;x++)a[y*20+x]=255;
for(let x=0;x<20;x++)for(let y=9;y<=10;y++)base[y*20+x]=255;
const args={base:glyph,letters:{A:glyph,B:glyph},path:{points:[[0,9.6],[19,9.6]]},masks:{base:{width:20,height:20,alpha:base},A:{width:20,height:20,alpha:a},B:{width:20,height:20,alpha:b}}};
const geometry=I.prepare(args),legacy=I.prepare({...args,masks:{A:args.masks.A,B:args.masks.B}});
function group(scale=1,rotation=0){return {cx:100,cy:100,baseSize:20*scale,baseRotation:rotation,items:['A','B'].map((letter,n)=>({id:String(n),letter,x:100,y:100,size:20*scale,rotation,fit:{rotation,candidates:[{letter}]}}))};}
let cases=0;
for(const scale of [1,5,10,20])for(const angle of [0,47,90,-90,179]){
 const g=group(scale,angle),before=JSON.stringify(g),old=legacy.analyze(g,true),next=geometry.analyze(g,true);assert.equal(C.read({mode:'review',groups:[g]},()=>old).text,'BA');assert.equal(C.read({mode:'review',groups:[g]},()=>next).text,'AB');
 assert(next.items[0].contactRecovered);assert(next.items[0].orderSensitive);assert.equal(next.items[0].first.method,'stroke-width');assert.deepEqual(next.items[0].hits.slice(1),old.items[0].hits);assert.deepEqual(next.items[1],old.items[1]);assert.equal(JSON.stringify(g),before);assert.equal(geometry.analyze(g,true),next);cases++;
}
const g=group(),old=legacy.analyze(g,true),noBaseInk=I.prepare({...args,masks:{...args.masks,base:{...args.masks.base,alpha:new Uint8Array(400)}}});assert.deepEqual(noBaseInk.analyze(g,true),old,'No base ink means no recovery, even if the letter is close');
const short=a.slice();for(let y=7;y<=9;y++)for(let x=3;x<=5;x++)short[y*20+x]=0;const shortGeometry=I.prepare({...args,masks:{...args.masks,A:{...args.masks.A,alpha:short}}});assert(!shortGeometry.analyze(group(),true).items[0].contactRecovered,'Isolated tiny contact cannot reorder');
for(const change of [p=>{p.contact={x:108,y:109.6};},p=>{delete p.fit;}]){const g=group();change(g.items[0]);const before=JSON.stringify(g),next=geometry.analyze(g,true);assert(!next.items[0].contactRecovered);assert.equal(JSON.stringify(g),before);}
for(const change of [p=>{p.positionLocked=true;},p=>{delete p.fit;p.rotationMode='manual';p.rotation=0;}]){const g=group();change(g.items[0]);const before=JSON.stringify(g),next=geometry.analyze(g,true);assert(next.items[0].contactRecovered);assert(!next.items[0].orderSensitive);assert.equal(C.read({mode:'review',groups:[g]},()=>next).text,'AB');assert.equal(JSON.stringify(g),before);}
const generation=group();assert.deepEqual(geometry.analyze(generation,false),legacy.analyze(generation,false),'Generation keeps the exact centreline reading');
const pending=group();pending.items[0].letter=null;const result=geometry.analyze(pending,true);assert(result.items[0].contactRecovered);assert.equal(pending.items[0].letter,null);assert.equal(C.read({mode:'review',groups:[pending]},()=>result).text,'[?]B');
const unplaced=a.slice();for(let y=0;y<20;y++)for(let x=15;x<=16;x++)unplaced[y*20+x]=0;const unplacedGeometry=I.prepare({...args,masks:{...args.masks,A:{...args.masks.A,alpha:unplaced}}});assert.equal(unplacedGeometry.analyze(group(),true).items[0].at,null,'No nominal placement must not acquire a guessed contact');
console.log('PASS stroke-width contact recovery: '+cases+' rotated/scaled near-miss cases; actual base-ink gate, stable metrics, tiny-contact rejection, explicit contact priority, lock/manual-pose invariance, unchanged generation, candidate remains unresolved and immutable inputs.');
