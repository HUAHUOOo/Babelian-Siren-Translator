/* Exact-kernel regressions using public sprites and generated data only. */
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),F=require('./siren-fixture.cjs'),PNG=require('./png.cjs');
const source=fs.readFileSync(require.resolve('../src/siren-recognition.js'),'utf8');
const extract=(a,b)=>{const i=source.indexOf(a),j=source.indexOf(b,i);assert(i>=0&&j>i);return source.slice(i,j);};
const context={Math,Number,Object,Map,Float32Array,Uint32Array,rad:a=>a*Math.PI/180};
const kernel=vm.runInNewContext(extract(' function sample(',' function scaled(')+extract(' function asset(',' function support(')+extract(' function seedSupport(',' function insertTop(')+';({asset,placedMask,seedSupport,baseSeedSupport})',context);
function sample(bitmap,x,y){const {width:w,height:h,ink:a}=bitmap;if(x<0||y<0||x>w-1||y>h-1)return 0;const ix=x|0,iy=y|0,dx=x-ix,dy=y-iy,j=iy*w+ix,xx=ix<w-1?1:0,yy=iy<h-1?w:0;return a[j]*(1-dx)*(1-dy)+a[j+xx]*dx*(1-dy)+a[j+yy]*(1-dx)*dy+a[j+xx+yy]*dx*dy;}
function referenceMask(template,fit,bitmap){
 const w=bitmap.width,h=bitmap.height,ink=new Float32Array(w*h),c=Math.cos(fit.rotation*Math.PI/180),s=Math.sin(fit.rotation*Math.PI/180),scale=template.width/fit.size,reach=fit.size*.8;
 for(let y=Math.max(0,Math.floor(fit.cy-reach));y<=Math.min(h-1,Math.ceil(fit.cy+reach));y++)for(let x=Math.max(0,Math.floor(fit.cx-reach));x<=Math.min(w-1,Math.ceil(fit.cx+reach));x++){const dx=x-fit.cx,dy=y-fit.cy;ink[y*w+x]=sample(template,(dx*c+dy*s)*scale+template.width*template.pivotX,(-dx*s+dy*c)*scale+template.height*template.pivotY);}return ink;
}
function referenceScore(bitmap,pts,fit,base,negativePts=null){
 const c=Math.cos(fit.rotation*Math.PI/180)*fit.size,s=Math.sin(fit.rotation*Math.PI/180)*fit.size,w=bitmap.width,h=bitmap.height,a=bitmap.ink,b=base?.ink;let sum=0,unique=0,un=0,visible=0;
 for(let i=0;i<pts.length;i+=2){const x=Math.round(fit.cx+pts[i]*c-pts[i+1]*s),y=Math.round(fit.cy+pts[i]*s+pts[i+1]*c);if(x<0||x>=w||y<0||y>=h)continue;const j=y*w+x,v=a[j];visible++;sum+=v;if(!b||b[j]<.25){unique+=v;un++;}}
 const count=pts.length/2,full=sum/count,uniqueFraction=un/count,uniqueScore=un?unique/un:0;let score=base?(full*.25+uniqueScore*.75)*Math.min(1,uniqueFraction/.40):full,negativeInk=0;
 if(negativePts?.length&&full>.5){for(let i=0;i<negativePts.length;i+=2){const x=Math.round(fit.cx+negativePts[i]*c-negativePts[i+1]*s),y=Math.round(fit.cy+negativePts[i]*s+negativePts[i+1]*c);if(x>=0&&x<w&&y>=0&&y<h)negativeInk+=a[y*w+x];}negativeInk/=negativePts.length/2;score-=Math.max(0,negativeInk-.38)*.85;}
 return {score,support:full,uniqueSupport:uniqueScore,uniqueFraction,visible:visible/count,negativeInk};
}
function referencePoints(t,limit,negative){
 const ids=[];let left=t.width,right=0,top=t.height,bottom=0;for(let y=0;y<t.height;y++)for(let x=0;x<t.width;x++)if(t.ink[y*t.width+x]>.7){ids.push(y*t.width+x);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
 const indices=negative?[]:ids;if(negative)for(let y=top;y<=bottom;y++)for(let x=left;x<=right;x++)if(t.ink[y*t.width+x]<.1)indices.push(y*t.width+x);
 const n=Math.min(limit,indices.length),p=new Float32Array(n*2);for(let i=0;i<n;i++){const q=indices[Math.floor((i+.5)*indices.length/n)];p[i*2]=(q%t.width)/t.width-t.pivotX;p[i*2+1]=Math.floor(q/t.width)/t.width-t.height/t.width*t.pivotY;}return p;
}
const equal=(a,b)=>assert.deepEqual(Buffer.from(a.buffer),Buffer.from(b.buffer));
let state=124784,maskChecks=0,accepted=0;const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
for(const a of [F.assets.base,...Object.values(F.assets.letters)]){
 const t=kernel.asset({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))},true);
 for(const n of [16,32,64,96,150,180,240,420,480,1000]){equal(t.points(n),referencePoints(t,n,false));equal(t.negativePoints(n),referencePoints(t,n,true));assert.equal(t.points(n),t.points(n));}
 for(let i=0;i<55;i++){const p={cx:-40+random()*210,cy:-40+random()*210,size:4+random()*290,rotation:i<12?i*90+1e-10:random()*720-360};equal(kernel.placedMask(t,p,{width:128,height:128}).ink,referenceMask(t,p,{width:128,height:128}));maskChecks++;}
 for(const rotation of [NaN,Infinity]){const p={cx:40,cy:40,size:50,rotation};equal(kernel.placedMask(t,p,{width:80,height:80}).ink,referenceMask(t,p,{width:80,height:80}));}
}
for(const pivot of [-.2,0,.5,1,1.3]){const data=new Uint8Array(64*48*4);for(let y=2;y<8;y++)for(let x=3;x<10;x++)data[(y*64+x)*4+3]=x%2?255:1;const t=kernel.asset({width:64,height:48,pivotX:pivot,pivotY:1-pivot,data});for(let k=0;k<50;k++){const p={cx:random()*100,cy:random()*100,size:10+random()*180,rotation:random()*360};equal(kernel.placedMask(t,p,{width:100,height:100}).ink,referenceMask(t,p,{width:100,height:100}));maskChecks++;}}
const alpha=new Float32Array(32*32);alpha.fill(1,32*12,32*14);const borrowed=kernel.asset({width:32,height:32,alpha});assert(!borrowed.inkBox);alpha[0]=1;const p={cx:40,cy:40,size:60,rotation:30};equal(kernel.placedMask(borrowed,p,{width:80,height:80}).ink,referenceMask(borrowed,p,{width:80,height:80}));
for(let k=0;k<10000;k++){
 const width=48,height=48,count=1+k%96,ink=Float32Array.from({length:width*height},()=>k%4===0?1:k%4===1?.9:random()),base={ink:Float32Array.from({length:ink.length},()=>random()<.35?1:0)},bitmap={width,height,ink},pts=Float32Array.from({length:count*2},()=>random()-.5),p={cx:random()*48,cy:random()*48,size:8+random()*64,rotation:random()*360-180},minimum=k%5===0?.69:.69+random()*.3,basis={c:Math.cos(p.rotation*Math.PI/180),s:Math.sin(p.rotation*Math.PI/180)};
 const full=referenceScore(bitmap,pts,p,base),fast=kernel.seedSupport(bitmap,pts,p.cx,p.cy,p.size,base,basis,minimum),passes=full.score>minimum&&full.uniqueFraction>.35&&full.visible>.95;assert.equal(!!fast,passes);if(fast){assert.equal(JSON.stringify(fast),JSON.stringify(full));accepted++;}
}
assert(accepted>100);
for(let k=0;k<10000;k++){
 const width=48,height=48,ink=Float32Array.from({length:width*height},()=>k%4===0?1:k%4===1?.8:random()),bitmap={width,height,ink},pts=Float32Array.from({length:(1+k%128)*2},()=>random()-.5),negative=k%3?Float32Array.from({length:128},()=>random()-.5):null,p={cx:random()*48,cy:random()*48,size:8+random()*70,rotation:random()*360},minimum=k%5===0?.52:.52+random()*.47;
 const full=referenceScore(bitmap,pts,p,null,negative),fast=kernel.baseSeedSupport(bitmap,pts,negative,p.cx,p.cy,Math.cos(p.rotation*Math.PI/180)*p.size,Math.sin(p.rotation*Math.PI/180)*p.size,minimum);assert.equal(!!fast,full.score>minimum&&full.visible>.92);if(fast)assert.equal(JSON.stringify(fast),JSON.stringify(full));
}
const E=require('../src/siren-recognition.js'),decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))}),templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([id,a])=>[id,decode(a)])),path:F.path},engine=E.create(templates),base=engine.binarize(templates.base);
assert.deepEqual(engine.detectGroups(base,{coarseSide:96,noSplit:true}),engine.detectGroups(base,{coarseSide:96,noSplit:true,coarsePruning:false}),'Complete base outputs must match exhaustive scoring');
console.log('PASS Siren speed kernels: '+maskChecks+' exact raster bytes, cached samples, invalid/mutable-alpha fallback, 20000 dynamic bounds including background penalties and exact full base results; no timing assertion.');
