/* Image-only recognition. IDs are opaque: no alphabet, dictionary or language model. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BabelianOCR=api;
  api.workerSource=()=>`const OCR=(${factory.toString()})();onmessage=async e=>{try{const r=await OCR.recognize(e.data.image,e.data.templates,e.data.options,p=>postMessage({progress:p}));postMessage({result:r});}catch(e){postMessage({error:e.message});}};`;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const SIZE=32;
  function pop(n){n-=(n>>>1)&0x55555555;n=(n&0x33333333)+((n>>>2)&0x33333333);return (((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
  function bounds(m,x0=0,y0=0,x1=m.width,y1=m.height){
    let left=x1,top=y1,right=-1,bottom=-1;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(m.data[y*m.width+x]){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
    return right<left?null:{x:left,y:top,width:right-left+1,height:bottom-top+1};
  }
  function grayImage(image){
    const {width,height,data}=image;
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>12000000||data.length!==width*height*4)throw Error('图像尺寸不支持，请裁剪后重试（最多1200万像素）。');
    const gray=new Uint8Array(width*height),hist=new Uint32Array(256);
    for(let i=0;i<gray.length;i++){
      const a=data[i*4+3]/255;
      gray[i]=Math.round((data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114)*a+255*(1-a));hist[gray[i]]++;
    }
    return {gray,hist};
  }
  function otsu(hist,total){
    let sum=0;for(let i=0;i<256;i++)sum+=hist[i]*i;
    let weight=0,partial=0,max=-1,threshold=127;
    for(let i=0;i<255;i++){
      weight+=hist[i];partial+=hist[i]*i;if(!weight||weight===total)continue;
      const delta=partial/weight-(sum-partial)/(total-weight),variance=weight*(total-weight)*delta*delta;
      if(variance>max){max=variance;threshold=i;}
    }
    return threshold;
  }
  function binarize(image,options={}){
    const {gray,hist}=grayImage(image),{width,height}=image;
    const threshold=options.threshold==null?otsu(hist,gray.length):Math.max(0,Math.min(254,Number(options.threshold)));
    let polarity=options.polarity||'auto';
    if(polarity==='auto'){
      let light=0,total=0;
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(x<2||y<2||x>=width-2||y>=height-2){total++;light+=gray[y*width+x]>threshold;}
      polarity=light>=total/2?'dark':'light';
    }
    const data=new Uint8Array(gray.length);let count=0;
    for(let i=0;i<data.length;i++){data[i]=Number(polarity==='light'?gray[i]>threshold:gray[i]<=threshold);count+=data[i];}
    if(count===data.length||count===0)return {width,height,data:new Uint8Array(data.length),threshold,polarity};
    return {width,height,data,threshold,polarity};
  }
  function fineDescriptor(mask,box){
    const size=64,rows=new Uint32Array(size*2),wide=new Uint32Array(size*2);let count=0;
    for(let y=0;y<size;y++)for(let x=0;x<size;x++){
      let ink=0;
      for(const dy of [.25,.75])for(const dx of [.25,.75]){
        const sx=Math.min(mask.width-1,Math.floor(box.x+(x+dx)*box.width/size));
        const sy=Math.min(mask.height-1,Math.floor(box.y+(y+dy)*box.height/size));ink+=mask.data[sy*mask.width+sx];
      }
      if(ink>=2){rows[y*2+(x>>>5)]|=1<<(x&31);count++;}
    }
    for(let y=0;y<size;y++){
      const left=rows[y*2]|(rows[(y-1)*2]||0)|(rows[(y+1)*2]||0),right=rows[y*2+1]|(rows[(y-1)*2+1]||0)|(rows[(y+1)*2+1]||0);
      wide[y*2]=left|(left<<1)|(left>>>1)|(right<<31);
      wide[y*2+1]=right|(right<<1)|(right>>>1)|(left>>>31);
    }
    return {rows,wide,count};
  }
  function fineScore(a,b){
    let overlap=0,near1=0,near2=0;
    for(let i=0;i<a.rows.length;i++){overlap+=pop(a.rows[i]&b.rows[i]);near1+=pop(a.rows[i]&b.wide[i]);near2+=pop(b.rows[i]&a.wide[i]);}
    const total=a.count+b.count;
    return total ? .64*(2*overlap/total)+.36*((near1+near2)/total) : 0;
  }
  function describe(mask,box=bounds(mask),detail=true){
    if(!box)return null;
    const rows=new Uint32Array(SIZE),wide=new Uint32Array(SIZE);let count=0;
    // Multiple samples retain thin wedges after normalizing the candidate rectangle.
    for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++){
      let ink=0;
      for(const dy of [.25,.75])for(const dx of [.25,.75]){
        const sx=Math.min(mask.width-1,Math.floor(box.x+(x+dx)*box.width/SIZE));
        const sy=Math.min(mask.height-1,Math.floor(box.y+(y+dy)*box.height/SIZE));ink+=mask.data[sy*mask.width+sx];
      }
      if(ink>=2){rows[y]|=(1<<x);count++;}
    }
    for(let y=0;y<SIZE;y++){
      let r=rows[y]|(rows[y-1]||0)|(rows[y+1]||0);wide[y]=r|(r<<1)|(r>>>1);
    }
    return {rows,wide,count,ratio:box.width/box.height,...(detail?{fine:fineDescriptor(mask,box)}:{})};
  }
  function prepareTemplates(items,options={}){
    return items.map(item=>({id:item.id,...describe(item,undefined,options.detail!==false)}));
  }
  function matchDescriptor(candidate,templates){
    const ranked=[];
    for(const t of templates){
      if(!t.count||!candidate?.count)continue;
      const aspect=Math.abs(Math.log(candidate.ratio/t.ratio));if(aspect>.38)continue;
      let overlap=0,near1=0,near2=0;
      for(let i=0;i<SIZE;i++){overlap+=pop(candidate.rows[i]&t.rows[i]);near1+=pop(candidate.rows[i]&t.wide[i]);near2+=pop(t.rows[i]&candidate.wide[i]);}
      const total=candidate.count+t.count;
      const coarse=.64*(2*overlap/total)+.36*((near1+near2)/total);
      // Fine wedges add detail, coarse shape stays dominant for noisy scans.
      const fine=candidate.fine&&t.fine?fineScore(candidate.fine,t.fine):coarse;
      const score=Math.max(0,.7*coarse+.3*fine-.38*aspect);
      ranked.push({id:t.id,score});
    }
    return ranked.sort((a,b)=>b.score-a.score).slice(0,5);
  }
  function rowBands(mask,oneLine=false,templates=[]){
    const box=bounds(mask);if(!box)return [];
    if(oneLine)return [box];
    // Small screenshots may have just one blank pixel between full text rows.
    // Keep those separators, then test disconnected strokes as a whole glyph;
    // a fixed three-pixel gap incorrectly merged neighbouring text rows.
    const raw=[];let start=-1;
    for(let y=box.y;y<=box.y+box.height;y++){
      let ink=0;if(y<box.y+box.height)for(let x=box.x;x<box.x+box.width;x++)ink+=mask.data[y*mask.width+x];
      if(ink){if(start<0)start=y;}
      else if(start>=0){raw.push(bounds(mask,box.x,start,box.x+box.width,y));start=-1;}
    }
    if(raw.length>800)throw Error('内容超过100行，请分段框选。');
    const scores=raw.map(b=>matchDescriptor(describe(mask,b),templates)[0]?.score||0),out=[];
    for(let i=0;i<raw.length;){
      let best=null,bestEnd=i,bestScore=0;
      for(let j=i+1;j<Math.min(raw.length,i+8);j++){
        const bottom=raw[j].y+raw[j].height,combined=bounds(mask,box.x,raw[i].y,box.x+box.width,bottom);
        if(combined.width>combined.height*1.9)continue;
        const gap=Math.max(...raw.slice(i+1,j+1).map((b,k)=>b.y-(raw[i+k].y+raw[i+k].height)));
        if(gap>=combined.height*.4)break;
        const score=matchDescriptor(describe(mask,combined),templates)[0]?.score||0;
        // No named letters or words: recombine only when the full pixel shape
        // has strong support, better than any fragment taken on its own.
        if(score>=.90&&score>=Math.max(...scores.slice(i,j+1))+.06&&score>bestScore){best=combined;bestEnd=j;bestScore=score;}
      }
      out.push(best||raw[i]);i=bestEnd+1;
    }
    return out.filter(b=>b.height>=5);
  }
  function atomsFor(mask,box,touching=false){
    const cols=[];
    for(let x=box.x;x<box.x+box.width;x++){let n=0;for(let y=box.y;y<box.y+box.height;y++)n+=mask.data[y*mask.width+x];cols.push(n);}
    const atoms=[];let start=-1;
    for(let i=0;i<=cols.length;i++){
      if(cols[i]){if(start<0)start=i;}
      else if(start>=0){atoms.push({start:box.x+start,end:box.x+i});start=-1;}
    }
    // A scan may have touching glyphs. Weak column valleys provide extra cut sites.
    const split=[];
    for(const a of atoms){
      let from=a.start;
      const inset=touching?1:3;
      for(let x=a.start+inset;x<a.end-inset;x++){
        const i=x-box.x,n=cols[i];
        if(x-from>=box.height*(touching?.06:.18)&&n<=Math.max(1,box.height*(touching?.25:.055))&&n<cols[i-1]&&n<=cols[i+1]){
          split.push({start:from,end:x});from=x;
        }
      }
      split.push({start:from,end:a.end});
    }
    return split;
  }
  function recognizeLine(mask,box,templates,touching=false){
    const atoms=atomsFor(mask,box,touching),n=atoms.length;
    if(n>1400)throw Error('单行内容过多，请分段框选。');
    const costs=new Float64Array(n+1).fill(Infinity),back=Array(n+1),edges=[];costs[0]=0;
    for(let i=0;i<n;i++){
      if(!Number.isFinite(costs[i]))continue;
      for(let j=i;j<Math.min(n,i+14);j++){
        if(j>i&&atoms[j].start-atoms[j-1].end>box.height*.4)break;
        const x=atoms[i].start,width=atoms[j].end-x;
        if(width>box.height*1.9){
          // An isolated wide fragment is not a legal glyph, but must still
          // have an unknown edge. Otherwise one bad fragment aborts the line.
          if(j===i){
            const candidateBox=bounds(mask,x,box.y,x+width,box.y+box.height),unknown=costs[i]+.65*width/box.height+.04;
            edges.push({from:i,to:i+1,cost:unknown-costs[i]});
            if(unknown<costs[i+1]){costs[i+1]=unknown;back[i+1]={previous:i,token:{box:candidateBox,candidates:[],id:null,score:0,certain:false,manual:false}};}
          }
          break;
        }
        const candidateBox=bounds(mask,x,box.y,x+width,box.y+box.height);
        if(!candidateBox)continue;
        const heightRatio=candidateBox.height/box.height;
        let candidates=heightRatio>=.62?matchDescriptor(describe(mask,candidateBox),templates):[];
        const best=candidates[0],score=best?.score||0;
        const weight=width/box.height;
        const cost=costs[i]+(1-score)*weight+.025;
        if(best)edges.push({from:i,to:j+1,cost:cost-costs[i]});
        if(best&&cost<costs[j+1]){
          costs[j+1]=cost;
          back[j+1]={previous:i,token:{box:candidateBox,candidates,id:best.id,score,
            certain:candidateBox.height>=30&&score>=.84&&score-(candidates[1]?.score||0)>=.035,manual:false}};
        }
        // Never drop unrecognized ink. At least one unknown item covers each atom.
        if(j===i){
          const unknown=costs[i]+.65*weight+.04;
          edges.push({from:i,to:i+1,cost:unknown-costs[i]});
          if(unknown<costs[i+1]){costs[i+1]=unknown;back[i+1]={previous:i,token:{box:candidateBox,candidates,id:null,score:0,certain:false,manual:false}};}
        }
      }
    }
    const suffix=new Float64Array(n+1).fill(Infinity);suffix[n]=0;
    for(let i=n-1;i>=0;i--)for(const e of edges)if(e.from===i)suffix[i]=Math.min(suffix[i],e.cost+suffix[e.to]);
    const tokens=[];
    for(let at=n;at>0;){
      const step=back[at];if(!step)throw Error('无法切分这一行，请缩小框选区域。');
      // Nearly equivalent segmentation paths are uncertain even if one cropped
      // rectangle resembles a template. A character's boundary is evidence too.
      const rival=edges.filter(e=>e.from<at&&e.to>step.previous&&(e.from!==step.previous||e.to!==at));
      const margin=Math.min(Infinity,...rival.map(e=>costs[e.from]+e.cost+suffix[e.to]-costs[n]));
      step.token.segmentationMargin=margin;step.token.certain=step.token.certain&&margin>=.045;
      tokens.push(step.token);at=step.previous;
    }
    return tokens.reverse();
  }
  async function recognizeMask(mask,templates,options,progress,bands=rowBands(mask,options.oneLine,templates)){
    if(bands.length>100)throw Error('内容超过100行，请分段框选。');
    const lines=[];let count=0;
    for(let i=0;i<bands.length;i++){
      if(options.cancelled?.())throw Error('已取消识别。');
      let tokens=recognizeLine(mask,bands[i],templates),segmentation;
      const box=bands[i],baseline={box,tokens};
      // Printed glyphs can touch through several dark pixels rather than
      // a one-pixel bridge. Offer additional local projection valleys, then
      // compare the complete row using the same image-only objective. Do not
      // force the new cuts, infer letters from words, or raise confidence.
      // Source height alone does not distinguish a clean glyph from a larger
      // scan with connected strokes. Gate on row evidence at every usable size.
      if(options.detail!==false&&box.height>=16&&imageEvidence({lines:[baseline]})<.86){
        if(options.cancelled?.())throw Error('已取消识别。');
        try{
          const refined=recognizeLine(mask,box,templates,true);
          if(imageEvidence({lines:[{box,tokens:refined}]})>imageEvidence({lines:[baseline]})+.008){
            tokens=refined;
            for(const token of tokens){
              const peer=baseline.tokens.find(t=>t.id===token.id&&overlap(t.box,token.box)>=.85);
              token.certain=token.certain&&Boolean(peer?.certain);
            }
            segmentation={method:'touching-valleys',sourceHeight:box.height};
          }
        }catch(error){
          if(!/^(单行内容过多|无法切分这一行)/.test(error.message))throw error;
        }
      }
      count+=tokens.length;
      if(count>1500)throw Error('内容超过1500个字形，请分段识别。');
      lines.push({box:bands[i],tokens,...(segmentation?{segmentation}:{})});progress({done:i+1,total:bands.length});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(options.cancelled?.())throw Error('已取消识别。');
    return {lines,threshold:mask.threshold,polarity:mask.polarity,width:mask.width,height:mask.height,detail:options.detail!==false};
  }
  function overlap(a,b){
    const area=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y));
    return area/(a.width*a.height+b.width*b.height-area||1);
  }
  function imageEvidence(result){
    let sum=0,weight=0;
    for(const line of result.lines)for(const token of line.tokens){
      const w=token.box.width/line.box.height;sum+=token.score*w-.025;weight+=w;
    }
    return weight?sum/weight:0;
  }
  function hasSoftEdges(gray,width,box,threshold,polarity){
    const hist=new Uint32Array(256),split=polarity==='light'?254-threshold:threshold;
    for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
      const value=gray[y*width+x];hist[polarity==='light'?255-value:value]++;
    }
    let foreground=0,background=Math.min(255,split+1);
    for(let i=0;i<=split;i++)if(hist[i]>hist[foreground])foreground=i;
    for(let i=split+1;i<256;i++)if(hist[i]>hist[background])background=i;
    const contrast=background-foreground;if(contrast<40)return false;
    let ink=0,soft=0;
    for(let i=0;i<background-contrast*.05;i++){
      ink+=hist[i];if(i>foreground+contrast*.2&&i<background-contrast*.2)soft+=hist[i];
    }
    // Resampling already sharp binary edges invents intermediate shades and
    // may favor the wrong partition. Only use it with measured soft edges.
    return ink>0&&soft/ink>=.2;
  }
  function subpixelMask(gray,image,box,threshold,polarity){
    const scale=3,width=box.width*scale,height=box.height*scale,data=new Uint8Array(width*height);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const sx=box.x+(x+.5)/scale-.5,sy=box.y+(y+.5)/scale-.5,ix=Math.floor(sx),iy=Math.floor(sy),dx=sx-ix,dy=sy-iy;
      let value=0;
      for(let j=0;j<2;j++)for(let i=0;i<2;i++)value+=gray[Math.max(0,Math.min(image.height-1,iy+j))*image.width+Math.max(0,Math.min(image.width-1,ix+i))]*(i?dx:1-dx)*(j?dy:1-dy);
      value=Math.round(value);data[y*width+x]=Number(polarity==='light'?value>threshold:value<=threshold);
    }
    return {width,height,data,threshold,polarity};
  }
  async function refineSmallRows(image,gray,baseline,templates,thresholds,options,progress){
    const lines=[];let refined=0,count=0;
    for(let row=0;row<baseline.lines.length;row++){
      if(options.cancelled?.())throw Error('已取消识别。');
      const original=baseline.lines[row],b=original.box;
      // Interpolation adds no information: it only provides fractional cut
      // sites for small, antialiased strokes. Keep very tiny rows unchanged.
      const x=Math.max(0,b.x-2),y=Math.max(0,b.y-2),region={x,y,width:Math.min(image.width,b.x+b.width+2)-x,height:Math.min(image.height,b.y+b.height+2)-y};
      let chosen=original,quality=imageEvidence({lines:[original]}),selectedThreshold=baseline.threshold;
      const passes=[original];
      if(b.height>=30&&b.height<40&&region.width*region.height*9<=1200000&&hasSoftEdges(gray,image.width,b,baseline.threshold,baseline.polarity)){
        for(const threshold of [baseline.threshold,...thresholds]){
          if(options.cancelled?.())throw Error('已取消识别。');
          const mask=subpixelMask(gray,image,region,threshold,baseline.polarity),bands=rowBands(mask,false,templates);
          if(bands.length!==1)continue;
          const mapBox=box=>{
            const left=Math.max(0,Math.floor(box.x/3+x)),top=Math.max(0,Math.floor(box.y/3+y));
            return {x:left,y:top,width:Math.min(image.width,Math.ceil((box.x+box.width)/3+x))-left,height:Math.min(image.height,Math.ceil((box.y+box.height)/3+y))-top};
          };
          if(overlap(mapBox(bands[0]),b)<.8)continue;
          let tokens;
          try{tokens=recognizeLine(mask,bands[0],templates);}
          catch(error){
            if(/^(单行内容过多|无法切分这一行)/.test(error.message))continue;
            throw error;
          }
          const pass={box:bands[0],tokens};
          const evidence=imageEvidence({lines:[pass]});
          // Evaluate before rounding to source-pixel boxes. Rounding must not
          // become extra evidence for a wider or more fragmented candidate.
          pass.box=mapBox(pass.box);pass.tokens=tokens.map(t=>({...t,certain:t.certain&&t.box.height/3>=30,box:mapBox(t.box)}));passes.push(pass);
          if(evidence>quality+.008){chosen=pass;quality=evidence;selectedThreshold=threshold;}
          progress({done:row+1,total:baseline.lines.length,pass:2});
          await new Promise(resolve=>setTimeout(resolve,0));
        }
      }
      if(chosen!==original){
        refined++;
        for(const token of chosen.tokens){
          const peers=passes.filter(p=>p!==chosen).flatMap(p=>p.tokens).filter(t=>overlap(t.box,token.box)>=.7);
          token.samplingStable=peers.some(t=>t.id===token.id&&t.score>=.7&&(t.candidates[0]?.score||0)-(t.candidates[1]?.score||0)>=.035);
          // The original resolution gate still applies, never the enlarged
          // sampling grid. A new choice also needs another pass's support.
          token.certain=token.certain&&b.height>=30&&token.samplingStable;
        }
        chosen={...chosen,sampling:{scale:3,threshold:selectedThreshold,sourceHeight:b.height}};
      }
      lines.push(chosen);count+=chosen.tokens.length;
      if(count>1500)throw Error('内容超过1500个字形，请分段识别。');
    }
    if(options.cancelled?.())throw Error('已取消识别。');
    return {...baseline,lines,samplingRefinement:{rows:refined,scale:3}};
  }
  async function recognize(image,templateMasks,options={},progress=()=>{}){
    const mask=binarize(image,options),templates=prepareTemplates(templateMasks,options);
    const baseline=await recognizeMask(mask,templates,options,p=>progress({...p,pass:1}));
    // A manual threshold is authoritative. Keep the coarse comparison as an
    // explicit single-pass fallback; only automatic fine comparison sweeps.
    if(options.threshold!=null||options.detail===false||!baseline.lines.length)return baseline;
    const {gray,hist}=grayImage(image),dark=mask.polarity==='dark';
    let background=mask.threshold;
    for(let v=dark?mask.threshold+1:0;v<(dark?256:mask.threshold);v++)if(hist[v]>hist[background])background=v;
    // Search only part of the gap toward the background peak: recovering faint
    // tips must not flood paper texture or join adjacent rows. No image IDs,
    // letters, word counts or expected text participate in this decision.
    const thresholds=[...new Set([1/6,1/3].map(f=>Math.max(0,Math.min(254,Math.round(mask.threshold+(background-mask.threshold)*f)))))].filter(t=>Math.abs(t-mask.threshold)>=4);
    if(baseline.lines.some(l=>l.box.height<40))return refineSmallRows(image,gray,baseline,templates,thresholds,options,progress);
    const passes=[baseline];let previousMask=mask;
    for(const threshold of thresholds){
      if(options.cancelled?.())throw Error('已取消识别。');
      const variant=binarize(image,{threshold,polarity:mask.polarity});
      if(variant.data.every((v,i)=>v===previousMask.data[i]))continue;
      previousMask=variant;
      let result;
      try{
        const bands=rowBands(variant,options.oneLine,templates);
        if(bands.length!==baseline.lines.length||bands.some((b,i)=>overlap(b,baseline.lines[i].box)<.8))continue;
        result=await recognizeMask(variant,templates,options,p=>progress({...p,pass:passes.length+1}),bands);
      }
      catch(error){
        if(options.cancelled?.())throw error;
        // A more permissive threshold can expose paper texture. Keep the
        // successful baseline instead of failing a previously readable page.
        if(/^(内容超过|单行内容过多|无法切分这一行)/.test(error.message))continue;
        throw error;
      }
      // Avoid taking a high average score caused by missing or merged rows.
      if(result.lines.length===baseline.lines.length&&result.lines.every((l,i)=>overlap(l.box,baseline.lines[i].box)>=.8))passes.push(result);
    }
    let chosen=baseline,quality=imageEvidence(baseline);
    for(const pass of passes.slice(1)){
      const score=imageEvidence(pass);
      if(score>quality+.008){chosen=pass;quality=score;}
    }
    if(chosen!==baseline){
      for(let row=0;row<chosen.lines.length;row++)for(const token of chosen.lines[row].tokens){
        const peers=passes.filter(p=>p!==chosen).flatMap(p=>p.lines[row].tokens).filter(t=>overlap(t.box,token.box)>=.7);
        // New automatic output needs independent threshold support, in addition
        // to unchanged pixel/runner-up/boundary/resolution confidence gates.
        token.thresholdStable=peers.some(t=>t.id===token.id&&t.score>=.7&&(t.candidates[0]?.score||0)-(t.candidates[1]?.score||0)>=.035);
        token.certain=token.certain&&token.thresholdStable;
      }
    }
    return {...chosen,thresholdSearch:{baseline:baseline.threshold,selected:chosen.threshold,passes:passes.map(p=>({threshold:p.threshold,evidence:imageEvidence(p)}))}};
  }
  function tokenGlyph(token){return token.id||token.candidates?.[0]?.id||null;}
  function tokenReading(token,mapping){
    const id=tokenGlyph(token);if(!id)return '[?]';
    const value=typeof mapping[id]==='string'?mapping[id]:'';
    return value||'[未映射]';
  }
  function transcribe(result,mapping,{joinLines=false,separate=false}={}){
    return result.lines.map(line=>line.tokens.map(t=>tokenReading(t,mapping)).join(separate?' · ':'')).join(joinLines?'':'\n');
  }
  function toWriter(result,mapping,{joinLines=false}={}){
    let text='';const spans=[];
    result.lines.forEach((line,index)=>{
      if(index&&!joinLines)text+='\n';
      for(const token of line.tokens){
        const value=tokenReading(token,mapping),start=text.length;text+=value;
        const id=tokenGlyph(token);
        if(id)spans.push({glyph:id,start,end:text.length,text:value});
      }
    });
    return {text,spans};
  }
  return {binarize,bounds,describe,prepareTemplates,matchDescriptor,rowBands,recognizeLine,recognize,tokenGlyph,tokenReading,transcribe,toWriter};
});
