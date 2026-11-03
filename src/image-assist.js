/* Bounded image-only selection advice. Never edits pixels or recognizes text. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BabelianImageAssist=api;})(globalThis,function(){
 'use strict';
 const median=a=>a.length?a.slice().sort((a,b)=>a-b)[a.length>>1]:0;
 function downsample(image){
  const scale=Math.min(1,960/image.width,Math.sqrt(700000/(image.width*image.height)));
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale)),data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const src=(Math.min(image.height-1,Math.floor((y+.5)*image.height/height))*image.width+Math.min(image.width-1,Math.floor((x+.5)*image.width/width)))*4;
   for(let c=0;c<4;c++)data[(y*width+x)*4+c]=image.data[src+c];
  }
  return {width,height,data};
 }
 function quality(image,region,heights=[]){
  const b=region||{x:0,y:0,width:image.width,height:image.height},values=[],step=Math.max(1,Math.ceil(Math.sqrt(b.width*b.height/100000)));
  for(let y=b.y;y<b.y+b.height;y+=step)for(let x=b.x;x<b.x+b.width;x+=step){const i=(y*image.width+x)*4,a=image.data[i+3]/255;values.push(Math.round((image.data[i]*.299+image.data[i+1]*.587+image.data[i+2]*.114)*a+255*(1-a)));}
  values.sort((a,b)=>a-b);const lo=values[Math.floor(values.length*.03)]??255,hi=values[Math.floor(values.length*.97)]??255,warnings=[];
  if(heights.length&&median(heights)<16)warnings.push('字形偏小，建议使用原尺寸截图，避免继续缩小。');
  if(hi-lo<55)warnings.push('所选区域对比度偏低，建议换用光线均匀、字迹更清楚的图片。');
  if(hi-lo>=55){const soft=values.filter(v=>v>lo+(hi-lo)*.2&&v<lo+(hi-lo)*.8).length/Math.max(1,values.filter(v=>v<hi-(hi-lo)*.05).length);if(soft>.6)warnings.push('区域内灰阶过渡较多，可能有模糊、反光或底纹，请检查笔画边缘。');}
  return warnings;
 }
 function analyze(image,templateMasks,OCR){
  if(!image||image.width<8||image.height<8||image.width*image.height>6000000)throw Error('Image advice input out of bounds');
  const small=downsample(image),prepared=OCR.prepareTemplates(templateMasks,{detail:false}),clusters=[];let probes=0;
  for(const polarity of ['dark','light']){
  const mask=OCR.binarize(small,{polarity});
  // Peripheral card/app ornaments can bridge otherwise separate text rows.
  // Use the central projection only to find Y bands, then recover full X ink.
  const profile={...mask,data:mask.data.slice()},inset=Math.floor(mask.width*.14);
  for(let y=0;y<mask.height;y++){profile.data.fill(0,y*mask.width,y*mask.width+inset);profile.data.fill(0,(y+1)*mask.width-inset,(y+1)*mask.width);}
  let bands;try{bands=OCR.rowBands(profile).map(b=>OCR.bounds(mask,0,b.y,mask.width,b.y+b.height)).filter(b=>b&&b.height>=8&&b.height<=100&&b.width>b.height*2.5);}catch(_){continue;}
  // Excessive texture/lines is not a reason to guess a partial text region.
  if(bands.length>48)continue;
  const strong=[];
  for(const b of bands){
   const columns=Array(b.width).fill(0);for(let x=0;x<b.width;x++)for(let y=b.y;y<b.y+b.height;y++)columns[x]+=mask.data[y*mask.width+b.x+x];
   const starts=[],ends=[];
   for(let x=0;x<columns.length;x++){if(columns[x]&&!columns[x-1])starts.push(b.x+x);if(columns[x]&&!columns[x+1])ends.push(b.x+x+1);}
   const hits=[];const stride=Math.max(1,Math.ceil(starts.length/24));
   for(let n=0;n<starts.length;n+=stride){const x=starts[n],rights=ends.filter(e=>e-x>=b.height*.2&&e-x<=b.height*3.2).slice(0,9);let best=null;
    for(const right of rights){if(++probes>2400)break;const box=OCR.bounds(mask,x,b.y,right,b.y+b.height);if(!box||box.height<b.height*.8)continue;
     const score=OCR.matchDescriptor(OCR.describe(mask,box,false),prepared)[0]?.score||0;
     if(score>=.82&&(!best||score>best.score))best={...box,score};
    }
    if(best)hits.push(best);if(probes>2400)break;
   }
   const distinct=[];for(const hit of hits.sort((a,b)=>b.score-a.score))if(!distinct.some(p=>Math.min(p.x+p.width,hit.x+hit.width)-Math.max(p.x,hit.x)>Math.min(p.width,hit.width)*.3))distinct.push(hit);
   const coverage=distinct.reduce((s,h)=>s+h.width,0)/b.width;
   const average=distinct.reduce((s,h)=>s+h.score,0)/Math.max(1,distinct.length),anchor=distinct.length>=3&&coverage>=.20&&average>=.85;
   // Peripheral ornaments may dilute one row's coverage. Keep a supported
   // neighbour with the block, but never let weak rows start a selection alone.
   if(anchor||distinct.length>=2&&coverage>=.07&&average>=.85){
    const sections=[];let from=0,gap=0;
    for(let x=0;x<=columns.length;x++){if(!columns[x])gap++;else gap=0;if(gap>=Math.max(3,b.height*.4)||x===columns.length){if(x-gap+1>from)sections.push({left:b.x+from,right:b.x+x-gap+1});from=x+1;}}
    const supported=sections.filter(s=>distinct.some(h=>h.x>=s.left-1&&h.x+h.width<=s.right+1));
    const left=supported.length?Math.min(...supported.map(s=>s.left)):b.x,right=supported.length?Math.max(...supported.map(s=>s.right)):b.x+b.width;
    strong.push({...b,x:left,width:right-left,hits:distinct.length,anchor});
   }
   if(probes>2400)break;
  }
  if(probes>2400)return {crop:null,rows:0,probes,warnings:quality(image)};
  const local=[];
  for(const row of strong){const last=local.at(-1),prev=last?.at(-1),overlap=prev&&Math.min(prev.x+prev.width,row.x+row.width)-Math.max(prev.x,row.x);
   if(prev&&row.y-prev.y-prev.height<=Math.max(prev.height,row.height)*1.5&&overlap>Math.min(prev.width,row.width)*.25)last.push(row);else local.push([row]);}
  clusters.push(...local.filter(c=>c.some(r=>r.anchor)));
  }
  clusters.sort((a,b)=>b.reduce((s,r)=>s+r.hits,0)-a.reduce((s,r)=>s+r.hits,0));const chosen=clusters[0];
  const ambiguous=chosen&&clusters.slice(1).some(c=>c.reduce((s,r)=>s+r.hits,0)>=chosen.reduce((s,r)=>s+r.hits,0)*.45);
  let crop=null,rows=0,warnings=[];
  if(chosen&&!ambiguous){
   const pad=Math.ceil(median(chosen.map(r=>r.height))*.4),sx=image.width/small.width,sy=image.height/small.height;
   const left=Math.max(0,Math.floor((Math.min(...chosen.map(r=>r.x))-pad)*sx)),top=Math.max(0,Math.floor((chosen[0].y-pad)*sy));
   const right=Math.min(image.width,Math.ceil((Math.max(...chosen.map(r=>r.x+r.width))+pad)*sx)),bottom=Math.min(image.height,Math.ceil((chosen.at(-1).y+chosen.at(-1).height+pad)*sy));
   crop={x:left,y:top,width:right-left,height:bottom-top};rows=chosen.length;
   warnings=quality(image,crop,chosen.map(r=>r.height*sy));
   if(chosen.some(r=>r.x<2||r.x+r.width>small.width-2||r.y<2||r.y+r.height>small.height-2))warnings.push('文字接近图片边缘，请确认没有缺笔或截断。');
  }else warnings=quality(image);
  return {crop,rows,probes,warnings,ambiguous:!!ambiguous};
 }
 return {analyze,quality};
});
