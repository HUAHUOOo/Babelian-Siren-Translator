/* Synthetic alphabet overlays only. No screenshots, transcriptions or supplied boxes. */
const assert=require('node:assert/strict'),E=require('../src/siren-recognition.js'),Scan=require('../src/siren-scan.js');
const C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs'),PNG=require('./png.cjs');
const decode=a=>({...a,...PNG(Buffer.from(a.src.split(',')[1],'base64'))});
const templates={base:decode(F.assets.base),letters:Object.fromEntries(Object.entries(F.assets.letters).map(([k,a])=>[k,decode(a)])),path:F.path};
const engine=E.create(templates);
function sample(a,x,y){
 const w=a.width,h=a.height;if(x<0||y<0||x>w-1||y>h-1)return 0;
 const ix=x|0,iy=y|0,dx=x-ix,dy=y-iy,j=iy*w+ix,xx=ix<w-1?1:0,yy=iy<h-1?w:0;
 return (a.data[j*4+3]*(1-dx)*(1-dy)+a.data[(j+xx)*4+3]*dx*(1-dy)+a.data[(j+yy)*4+3]*(1-dx)*dy+a.data[(j+xx+yy)*4+3]*dx*dy)/255;
}
const glyphGroups=['ABCDEF','GHIJKL','MNOPQR','STUVWX'].map(text=>{const g=C.fromText(text).groups[0];F.geometry.arrange(g);return g;});
function strip(offset=0){
 const size=121,spacing=.82,height=127,width=Math.ceil(size*(3*spacing+1)+12+offset),ink=new Float32Array(width*height),centers=[];
 function draw(a,cx,cy,size,rotation){
  const angle=rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),scale=a.width/size,r=size*.8;
  for(let y=Math.max(0,Math.floor(cy-r));y<Math.min(height,Math.ceil(cy+r));y++)for(let x=Math.max(0,Math.floor(cx-r));x<Math.min(width,Math.ceil(cx+r));x++){
   const dx=x-cx,dy=y-cy;let v=0;
   // Four subpixel samples create a genuinely small antialiased source.
   for(const [sx,sy] of [[-.25,-.25],[.25,-.25],[-.25,.25],[.25,.25]])v+=sample(a,((dx+sx)*c+(dy+sy)*s)*scale+a.width*a.pivotX,(-(dx+sx)*s+(dy+sy)*c)*scale+a.height*a.pivotY)/4;
   ink[y*width+x]=Math.max(ink[y*width+x],v);
  }
 }
 for(let k=0;k<glyphGroups.length;k++){
  const g=glyphGroups[k],cx=size*.5+6+size*spacing*k+offset,cy=height*.48;centers.push({cx,cy,size});
  draw(templates.base,cx,cy,size,0);
  for(const i of g.items)draw(templates.letters[i.letter],cx+(i.x-g.cx)*size/g.baseSize,cy+(i.y-g.cy)*size/g.baseSize,i.size*size/g.baseSize,C.rotationFor(g,i));
 }
 return {width,height,ink,centers};
}
function rotate(b){
 const ink=new Float32Array(b.ink.length);
 for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)ink[x*b.height+b.height-1-y]=b.ink[y*b.width+x];
 return {width:b.height,height:b.width,ink,centers:b.centers.map(p=>({...p,cx:b.height-1-p.cy,cy:p.cx}))};
}
function rgba(bitmap,inverse=false){return {width:bitmap.width,height:bitmap.height,data:Uint8Array.from({length:bitmap.ink.length*4},(_,i)=>i%4===3?255:Math.round(255*(inverse?bitmap.ink[i>>2]:1-bitmap.ink[i>>2])))};}
function audit(found,bitmap){
 assert.equal(found.length,bitmap.centers.length,'Dense overlays must not hide, duplicate or invent bases');
 for(const p of bitmap.centers){
  const matches=found.filter(g=>Math.hypot(g.cx-p.cx,g.cy-p.cy)<2);
  assert.equal(matches.length,1,'Each rendered base must have exactly one source-coordinate result');
  assert(Math.abs(matches[0].size-p.size)<2,'Recovered size must fit source pixels');
 }
 for(const g of found){
  assert(g.score>=.81&&g.visible>.97,'Keep the ordinary base evidence thresholds');
  assert(g.bbox.x>=0&&g.bbox.y>=0);assert(g.bbox.x+g.bbox.width<=bitmap.width+.001);assert(g.bbox.y+g.bbox.height<=bitmap.height+.001);
 }
}
let workerInput,workerBitmap;
// The old five-pixel search grid missed the third base in the shifted row.
// Padding, quarter-turn rotation and inverse polarity must preserve all four.
for(const [offset,vertical,inverse] of [[0,false,false],[4,false,false],[4,true,false],[4,false,true]]){
 let bitmap=strip(offset);if(vertical)bitmap=rotate(bitmap);
 const image=rgba(bitmap,inverse),pixels=engine.binarize(image),before=pixels.ink.slice();
 audit(engine.detectGroups(pixels),bitmap);assert.deepEqual(pixels.ink,before,'Detection must not change source pixels');
 if(offset===4&&!vertical&&!inverse){workerInput=image;workerBitmap=bitmap;}
}
// Execute the actual worker/crop path. Empty letter templates keep this test
// focused on preserving every detected base through transport and fitting.
const messages=[],self={postMessage:message=>messages.push(message)};
new Function('self',Scan.workerSource(E.workerSource()))(self);
self.onmessage({data:{templates:{...templates,letters:{}},image:workerInput,operation:'detect',limit:20}});
const result=messages.at(-1);assert(!result.error,result.error);assert.equal(result.result.length,workerBitmap.centers.length);
for(const p of workerBitmap.centers)assert.equal(result.result.filter(g=>Math.hypot(g.base.cx-p.cx,g.base.cy-p.cy)<2).length,1);
assert(result.result.every(g=>g.items.length===0),'No text is inferred to recover bases');
console.log('PASS Siren base recall: dense synthetic overlays, shifted grid, quarter-turn, inverse polarity, one-to-one base conservation, immutable pixels and actual worker transport.');
