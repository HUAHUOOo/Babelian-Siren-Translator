/* Weak synthetic ink may yield a review slot, never a confirmed guess. */
const assert=require('node:assert/strict'),E=require('../src/siren-recognition.js'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs'),PNG=require('./png.cjs');
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))}),templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path},engine=E.create(templates),width=360,height=360;
function sample(a,x,y){if(x<0||y<0||x>a.width-1||y>a.height-1)return 0;const ix=x|0,iy=y|0,dx=x-ix,dy=y-iy,j=iy*a.width+ix,xx=ix<a.width-1?1:0,yy=iy<a.height-1?a.width:0;return (a.data[j*4+3]*(1-dx)*(1-dy)+a.data[(j+xx)*4+3]*dx*(1-dy)+a.data[(j+yy)*4+3]*(1-dx)*dy+a.data[(j+xx+yy)*4+3]*dx*dy)/255;}
function draw(ink,a,p,opacity=1){const rad=p.rotation*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad),scale=a.width/p.size;for(let y=0;y<height;y++)for(let x=0;x<width;x++){const dx=x-p.x,dy=y-p.y,v=sample(a,(dx*c+dy*s)*scale+a.width*a.pivotX,(-dx*s+dy*c)*scale+a.height*a.pivotY)*opacity;ink[y*width+x]=Math.max(ink[y*width+x],v);}}
const g=C.fromText('N').groups[0];F.geometry.arrange(g);const scale=.6,base={cx:g.cx*scale,cy:g.cy*scale,size:g.baseSize*scale,rotation:g.baseRotation};
for(const opacity of [1,.9,.5]){const ink=new Float32Array(width*height);draw(ink,templates.base,{x:base.cx,y:base.cy,size:base.size,rotation:base.rotation});for(const i of g.items)draw(ink,templates.letters[i.letter],{x:i.x*scale,y:i.y*scale,size:i.size*scale,rotation:C.rotationFor(g,i)},opacity);const before=ink.slice(),r=engine.fitGroup({width,height,ink},base);assert.deepEqual(ink,before);
 if(opacity===.5){assert.equal(r.items.length,0,'Very weak ink is not enough to create a slot');continue;}
 assert.equal(r.items.length,1,'Retain exactly one pixel-supported source location');
 const item=r.items[0];assert.equal(item.candidates[0].letter,'N');assert(item.candidates.length<=3);
 assert(E.createRecognitionBoundary(templates.base,templates.path)(r.base,item));
 if(opacity===1){assert.equal(item.letter,'N');assert(item.score>=.86);assert(item.uniqueSupport>=.78);}
 else {assert.equal(item.letter,null,'Weak retained candidates must remain unresolved');assert(item.score>=.78&&item.score<.86);assert(item.uniqueSupport>=.70);}
}

console.log('PASS Siren review candidates: strong glyph confirmed, weaker pixel-supported slot retained unresolved, insufficient ink rejected, no duplicates or source mutations.');
