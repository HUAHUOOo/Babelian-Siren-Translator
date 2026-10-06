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
      const nativeScore=Math.max(0,.7*coarse+.3*fine-.38*aspect);
      let score=nativeScore;
      if(t.references&&nativeScore>=.65){
        const local=matchDescriptor(candidate,t.references);
        if(local.length>=2)score=Math.max(score,Math.min(nativeScore+.06,(local[0].score+local[1].score)/2));
      }
      ranked.push({id:t.id,score,...(t.references?{nativeScore}:{})});
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
    // A bounded reference-cluster pass can test cuts absent from component
    // edges. Blank columns stay blank and every original ink column is covered.
    if(touching==='reference-grid'){
      const step=box.height>48?2:1,grid=[];
      for(let i=0;i<cols.length;i+=step){
        let first=i,last=Math.min(cols.length,i+step)-1;
        while(first<=last&&!cols[first])first++;while(last>=first&&!cols[last])last--;
        if(first<=last)grid.push({start:box.x+first,end:box.x+last+1});
      }
      return grid;
    }
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
        const valley=touching==='dense'?.5:touching?.25:.055;
        if(x-from>=box.height*(touching?.06:.18)&&n<=Math.max(1,box.height*valley)&&n<cols[i-1]&&n<=cols[i+1]){
          split.push({start:from,end:x});from=x;
        }
      }
      split.push({start:from,end:a.end});
    }
    if(touching!=='components')return split;
    // Slanted, disconnected wedges can overlap in their horizontal projection.
    // Component edges offer cuts even when no blank column or valley exists.
    // They only add competing boundaries; every foreground pixel stays present.
    const cuts=componentCuts(mask,box),out=[];
    for(const atom of split){
      const points=[atom.start,...cuts.filter(x=>x>atom.start&&x<atom.end),atom.end];
      for(let i=1;i<points.length;i++)out.push({start:points[i-1],end:points[i]});
    }
    return out;
  }
  function componentCuts(mask,box){
    const {width,height}=box,seen=new Uint8Array(width*height),queue=new Int32Array(width*height),cuts=new Set();
    const ink=i=>mask.data[(box.y+Math.floor(i/width))*mask.width+box.x+i%width];
    for(let start=0;start<seen.length;start++){
      if(seen[start]||!ink(start))continue;
      let head=0,tail=1,left=width,right=-1,top=height,bottom=-1;queue[0]=start;seen[start]=1;
      while(head<tail){
        const i=queue[head++],x=i%width,y=Math.floor(i/width);
        left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
        for(let yy=Math.max(0,y-1);yy<=Math.min(height-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(width-1,x+1);xx++){
          const next=yy*width+xx;
          if(!seen[next]&&ink(next)){seen[next]=1;queue[tail++]=next;}
        }
      }
      if(tail>=3&&bottom-top+1>=Math.max(3,height*.12)){cuts.add(box.x+left);cuts.add(box.x+right+1);}
    }
    return [...cuts].sort((a,b)=>a-b);
  }
  function recognizeLine(mask,box,templates,touching=false){
    const atoms=atomsFor(mask,box,touching),n=atoms.length;
    if(n>1400)throw Error('单行内容过多，请分段框选。');
    const costs=new Float64Array(n+1).fill(Infinity),back=Array(n+1),edges=[];costs[0]=0;
    for(let i=0;i<n;i++){
      if(!Number.isFinite(costs[i]))continue;
      for(let j=i;j<Math.min(n,i+(touching==='reference-grid'?Math.ceil(box.height*1.9/(box.height>48?2:1)):touching==='components'?28:14));j++){
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
      // Wider foreground bridges can hide the actual boundary from the weak-
      // valley pass. Offer stronger valleys only for a still-poor, native-size
      // row, and retain them only when the full image objective improves.
      // These are alternative cuts, not extra ink, words or forced labels.
      if(options.detail!==false&&box.height>=40&&imageEvidence({lines:[{box,tokens}]})<.86){
        if(options.cancelled?.())throw Error('已取消识别。');
        try{
          const refined=recognizeLine(mask,box,templates,'dense');
          if(imageEvidence({lines:[{box,tokens:refined}]})>imageEvidence({lines:[{box,tokens}]})+.008){
            tokens=refined;
            for(const token of tokens){
              const peer=baseline.tokens.find(t=>t.id===token.id&&overlap(t.box,token.box)>=.85);
              token.certain=token.certain&&Boolean(peer?.certain);
            }
            segmentation={method:'dense-valleys',sourceHeight:box.height};
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
  function thinningThreshold(gray,width,box,threshold,polarity){
    const hist=new Uint32Array(256),split=polarity==='light'?254-threshold:threshold;
    for(let y=box.y;y<box.y+box.height;y++)for(let x=box.x;x<box.x+box.width;x++){
      const value=gray[y*width+x];hist[polarity==='light'?255-value:value]++;
    }
    // A printed background stripe may dominate the darkest histogram mode.
    // Use the dark foreground decile so that texture is not treated as ink.
    let total=0;for(let i=0;i<=split;i++)total+=hist[i];
    let foreground=0,cumulative=hist[0];while(foreground<split&&cumulative<total*.1)cumulative+=hist[++foreground];
    const value=Math.max(0,Math.round(split-(split-foreground)/12));
    return polarity==='light'?254-value:value;
  }
  async function refineSmallRows(image,gray,baseline,templates,thresholds,options,progress){
    const lines=[];let refined=0,count=0,cutRows=0,cutPixels=0;
    for(let row=0;row<baseline.lines.length;row++){
      if(options.cancelled?.())throw Error('已取消识别。');
      const original=baseline.lines[row],b=original.box;
      // Interpolation adds no information: it only provides fractional cut
      // sites for small, antialiased strokes. Keep very tiny rows unchanged.
      const x=Math.max(0,b.x-2),y=Math.max(0,b.y-2),region={x,y,width:Math.min(image.width,b.x+b.width+2)-x,height:Math.min(image.height,b.y+b.height+2)-y};
      let chosen=original,quality=imageEvidence({lines:[original]}),selectedThreshold=baseline.threshold;
      const passes=[original];
      const small=b.height>=30&&b.height<40&&region.width*region.height*9<=1200000;
      const thin=small?thinningThreshold(gray,image.width,b,baseline.threshold,baseline.polarity):baseline.threshold;
      const extra=small&&quality<.86&&cutRows<12&&
        cutPixels+region.width*region.height*9*(thresholds.length+2)<=6000000&&
        (hasSoftEdges(gray,image.width,b,baseline.threshold,baseline.polarity)||hasSoftEdges(gray,image.width,b,thin,baseline.polarity));
      // Soft small print can hide cuts even on the fractional sampling grid.
      // Compare bounded valley/component alternatives and a slightly thinner
      // threshold; sharp inputs and already-strong rows keep the old path.
      // Scores alone choose the row. No labels, words or supplied answers enter.
      if(extra){cutRows++;cutPixels+=region.width*region.height*9*(thresholds.length+2);}
      if(small&&(extra||hasSoftEdges(gray,image.width,b,baseline.threshold,baseline.polarity))){
        for(const threshold of [...new Set([baseline.threshold,...thresholds,...(extra&&Math.abs(thin-baseline.threshold)>=4?[thin]:[])])]){
          if(options.cancelled?.())throw Error('已取消识别。');
          const mask=subpixelMask(gray,image,region,threshold,baseline.polarity),bands=rowBands(mask,false,templates);
          if(bands.length!==1)continue;
          const mapBox=box=>{
            const left=Math.max(0,Math.floor(box.x/3+x)),top=Math.max(0,Math.floor(box.y/3+y));
            return {x:left,y:top,width:Math.min(image.width,Math.ceil((box.x+box.width)/3+x))-left,height:Math.min(image.height,Math.ceil((box.y+box.height)/3+y))-top};
          };
          if(overlap(mapBox(bands[0]),b)<.8)continue;
          let tokens,cutSearch=false;
          try{
            tokens=recognizeLine(mask,bands[0],templates);
            if(extra&&imageEvidence({lines:[{box:bands[0],tokens}]})<.86){
              let best=imageEvidence({lines:[{box:bands[0],tokens}]});
              for(const mode of [true,'dense','components']){
                if(options.cancelled?.())throw Error('已取消识别。');
                const alternative=recognizeLine(mask,bands[0],templates,mode),score=imageEvidence({lines:[{box:bands[0],tokens:alternative}]});
                if(score>best){tokens=alternative;best=score;cutSearch=true;}
              }
            }
          }
          catch(error){
            if(/^(单行内容过多|无法切分这一行)/.test(error.message))continue;
            throw error;
          }
          const pass={box:bands[0],tokens,...(cutSearch?{smallCutSearch:true}:{})};
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
          if(chosen.smallCutSearch)token.certain=token.certain&&original.tokens.some(t=>t.certain&&t.id===token.id&&overlap(t.box,token.box)>=.85);
        }
        chosen={...chosen,sampling:{scale:3,threshold:selectedThreshold,sourceHeight:b.height}};
      }
      lines.push(chosen);count+=chosen.tokens.length;
      if(count>1500)throw Error('内容超过1500个字形，请分段识别。');
    }
    if(options.cancelled?.())throw Error('已取消识别。');
    return {...baseline,lines,samplingRefinement:{rows:refined,scale:3}};
  }
  function thresholdConsensus(chosen,passes){
    passes=passes.filter((p,i)=>Number.isFinite(p.threshold)&&passes.findIndex(q=>q.threshold===p.threshold)===i);
    if(passes.length<3)return chosen;
    const enclosing=items=>{
      const x=Math.min(...items.map(t=>t.box.x)),y=Math.min(...items.map(t=>t.box.y));
      return {x,y,width:Math.max(...items.map(t=>t.box.x+t.box.width))-x,height:Math.max(...items.map(t=>t.box.y+t.box.height))-y};
    };
    const signature=items=>JSON.stringify(items.map(t=>t.id));
    const quality=items=>items.reduce((s,t)=>s+t.score*t.box.width,0)/items.reduce((s,t)=>s+t.box.width,0);
    const lines=chosen.lines.map((line,row)=>{
      const tokens=[];let changes=0;
      for(let i=0;i<line.tokens.length;){
        let end=i;
        while(end<line.tokens.length&&line.tokens[end].segmentationMargin<.045)end++;
        if(end-i<2){tokens.push(line.tokens[i++]);continue;}
        if(end-i>6){tokens.push(...line.tokens.slice(i,end));i=end;continue;}
        const group=line.tokens.slice(i,end),box=enclosing(group),votes=new Map();
        for(const pass of passes){
          const items=(pass.lines[row]?.tokens||[]).filter(t=>t.box.x+t.box.width/2>=box.x&&t.box.x+t.box.width/2<box.x+box.width);
          if(!items.length||items.length>6||items.some(t=>!t.id||t.score<.7)||overlap(enclosing(items),box)<.9)continue;
          const key=signature(items);
          if(!votes.has(key))votes.set(key,[]);
          votes.get(key).push({items,threshold:pass.threshold});
        }
        const ordered=[...votes].sort((a,b)=>b[1].length-a[1].length),best=ordered[0],current=signature(group);
        // Similar strokes can admit competing cuts. Only a strict majority of
        // independently binarized images may replace an ambiguous small group.
        // IDs are opaque: no letters, words or expected passage are consulted.
        if(best&&best[0]!==current&&best[1].length>passes.length/2&&best[1].length>(votes.get(current)?.length||0)&&best[1].length>(ordered[1]?.[1].length||0)){
          const picked=best[1].reduce((a,b)=>quality(a.items)>quality(b.items)?a:b);
          if(quality(picked.items)>=quality(group)-.025){
            tokens.push(...picked.items.map(t=>({...t,certain:false,thresholdConsensus:{support:best[1].length,passes:passes.length,threshold:picked.threshold}})));
            changes++;i=end;continue;
          }
        }
        tokens.push(...group);i=end;
      }
      return changes?{...line,tokens,thresholdConsensus:{groups:changes}}:line;
    });
    // Mixing locally supported cuts must not bypass the document-size limit.
    return lines.reduce((n,l)=>n+l.tokens.length,0)<=1500?{...chosen,lines}:chosen;
  }
  function supportedPageChanges(original,tokens,box){
    // Compare connected horizontal regions, not an average across the page.
    // A better match elsewhere must not authorize an unrelated new partition
    // with no repeated-shape evidence of its own.
    const entries=[...original.map(token=>({token,side:'before'})),...tokens.map(token=>({token,side:'after'}))]
      .sort((a,b)=>a.token.box.x-b.token.box.x),groups=[];
    for(const entry of entries){
      let group=groups[groups.length-1];
      if(!group||entry.token.box.x>=group.end){group={end:0,before:[],after:[]};groups.push(group);}
      group.end=Math.max(group.end,entry.token.box.x+entry.token.box.width);group[entry.side].push(entry.token);
    }
    return groups.every(group=>{
      const before=group.before.sort((a,b)=>a.box.x-b.box.x),after=group.after.sort((a,b)=>a.box.x-b.box.x);
      if(before.length===after.length&&before.every((token,i)=>token.id===after[i].id))return true;
      if(!before.length||!after.length)return false;
      const width=after.reduce((sum,token)=>sum+token.box.width,0);
      const benefit=after.reduce((sum,token)=>{
        const native=token.candidates?.find(candidate=>candidate.id===token.id)?.nativeScore;
        return sum+(Number.isFinite(native)?Math.max(0,token.score-native):0)*token.box.width;
      },0);
      const qualityGain=imageEvidence({lines:[{box,tokens:after}]})-imageEvidence({lines:[{box,tokens:before}]});
      // A short, already-pending close partition can be resolved by independent
      // references when every replacement also has strong native-template
      // evidence. Confident old labels and ordinary changes keep the .008 gate.
      // nativeScore exists only for IDs with held-out cross-row references.
      const pendingPartition=before.length>=2&&before.length<=6&&after.length>=2&&after.length<=6&&
        before.every(token=>!token.certain&&Number.isFinite(token.segmentationMargin)&&token.segmentationMargin>=0&&token.segmentationMargin<.045);
      const nativeLabels=after.every(token=>{
          const first=token.candidates?.[0];
          return first?.id===token.id&&Number.isFinite(first.nativeScore)&&first.nativeScore>=.84&&first.score-(token.candidates?.[1]?.score||0)>=.035;
        });
      const nativeTie=pendingPartition&&nativeLabels&&before.every(token=>token.segmentationMargin<.01);
      // Strong held-out support may settle other still-pending partitions, but
      // never excuse a worse local image objective or a confirmed old boundary.
      const strongTie=pendingPartition&&nativeLabels&&benefit/width>.02&&qualityGain>0;
      return benefit/width>.005&&(qualityGain>.008||nativeTie&&qualityGain>.002||strongTie);
    });
  }
  function referenceGridSupported(before,native,after,adapted,box){
    if(box.height<40||box.height>96||box.width>160||before.length<2||before.length>6||after.length<2||after.length>6||
      before.some(t=>!t.id||t.manual||t.box.height<30||adapted.find(a=>a.id===t.id)?.references))return false;
    // The finer native search must reproduce the original reading while proving
    // its boundaries are near a rival. Old confidence based on missing cut sites
    // is not sufficient to mark the recovered reading as confirmed.
    if(native.length!==before.length||native.some((t,i)=>t.id!==before[i].id||overlap(t.box,before[i].box)<.85||
      !Number.isFinite(t.segmentationMargin)||t.segmentationMargin<0||t.segmentationMargin>=.01))return false;
    if(after.length===before.length&&after.every((t,i)=>t.id===before[i].id))return false;
    if(after.some(t=>{
      const first=t.candidates?.[0],nativeScore=first?.nativeScore??first?.score;
      return first?.id!==t.id||!Number.isFinite(nativeScore)||nativeScore<.84||first.score-(t.candidates?.[1]?.score||0)<.035;
    }))return false;
    const supported=new Set(after.filter(t=>adapted.find(a=>a.id===t.id)?.references).map(t=>t.id));
    if(supported.size<2||!after.some(t=>Number.isFinite(t.candidates[0].nativeScore)&&t.score-t.candidates[0].nativeScore>=.015))return false;
    return imageEvidence({lines:[{box,tokens:after}]})>imageEvidence({lines:[{box,tokens:before}]});
  }
  function refineReferenceClusters(mask,line,adapted,templates,options,budget){
    let tokens=line.tokens,regions=0;
    if(line.box.height<40||line.box.height>96||!budget.remaining)return {tokens,regions};
    const runs=[];
    for(let i=0;i<tokens.length;){
      if(adapted.find(t=>t.id===tokens[i].id)?.references){i++;continue;}
      const from=i;while(i<tokens.length&&!adapted.find(t=>t.id===tokens[i].id)?.references)i++;
      if(i-from>=2&&i-from<=6)runs.push({from,to:i});
    }
    for(const {from,to}of runs.reverse()){
      if(options.cancelled?.())throw Error('已取消识别。');
      if(!budget.remaining)break;
      const before=tokens.slice(from,to),x=before[0].box.x,end=before.at(-1).box.x+before.at(-1).box.width;
      if(end-x>160||before.some(t=>!t.id||t.manual||t.box.height<30))continue;
      const box={x,y:line.box.y,width:end-x,height:line.box.height};budget.remaining--;
      const native=recognizeLine(mask,box,templates,'reference-grid');
      if(native.length!==before.length||native.some((t,i)=>t.id!==before[i].id||overlap(t.box,before[i].box)<.85||
        !Number.isFinite(t.segmentationMargin)||t.segmentationMargin<0||t.segmentationMargin>=.01))continue;
      const after=recognizeLine(mask,box,adapted,'reference-grid');
      const rescored=before.map(t=>({...t,score:matchDescriptor(describe(mask,t.box),adapted.filter(a=>a.id===t.id))[0]?.score||0}));
      if(!referenceGridSupported(rescored,native,after,adapted,box))continue;
      for(const token of after)token.certain=false;
      tokens=[...tokens.slice(0,from),...after,...tokens.slice(to)];regions++;
    }
    return {tokens,regions};
  }
  async function refineRepeatedGlyphs(image,baseline,templates,options,progress){
    if(baseline.lines.length<3)return baseline;
    const mask=binarize(image,{threshold:baseline.threshold,polarity:baseline.polarity}),byId=new Map();
    const median=values=>{const a=values.sort((a,b)=>a-b),n=a.length;return n%2?a[(n-1)/2]:(a[n/2-1]+a[n/2])/2;};
    // References are frozen before this pass. Only independently confident,
    // size-consistent repetitions may support another row; no iterative learning.
    baseline.lines.forEach((line,row)=>{if(options.cancelled?.())throw Error('已取消识别。');line.tokens.forEach(token=>{
      if(!token.certain||token.score<.84||token.box.height<30)return;
      const descriptor=describe(mask,token.box),ranked=matchDescriptor(descriptor,templates);
      if(ranked[0]?.id!==token.id||ranked[0].score<.84||ranked[0].score-(ranked[1]?.score||0)<.035)return;
      if(!byId.has(token.id))byId.set(token.id,[]);
      byId.get(token.id).push({row,box:token.box,score:ranked[0].score,descriptor});
    });});
    if([...byId.values()].filter(items=>items.length>=3).length<3)return baseline;
    const lines=[],gridBudget={remaining:8};let changed=0,count=0;
    for(let row=0;row<baseline.lines.length;row++){
      if(options.cancelled?.())throw Error('已取消识别。');
      const line=baseline.lines[row];let selected=line;
      // Small print still has useful independently confirmed repetitions.
      // Use the original 30-pixel confidence floor, never an enlarged sampling
      // height. All cross-row, native-match and local-change gates still apply;
      // newly recovered boundaries remain pending rather than self-confirmed.
      if(line.box.height>=30&&(!line.sampling||line.sampling.sourceHeight>=30)){
        let supported=0;
        const adapted=templates.map(template=>{
          const pool=(byId.get(template.id)||[]).filter(item=>item.row!==row);
          if(pool.length<3||new Set(pool.map(item=>item.row)).size<2)return template;
          const width=median(pool.map(item=>item.box.width)),height=median(pool.map(item=>item.box.height));
          const peers=pool.filter(item=>Math.abs(Math.log(item.box.width/width))<=.12&&Math.abs(Math.log(item.box.height/height))<=.12);
          if(peers.length<3||new Set(peers.map(item=>item.row)).size<2)return template;
          supported++;
          // Keep a bounded variety of accepted shapes, not just a handful of
          // near-perfect native matches: print variation is what this pass adds.
          return {...template,references:peers.sort((a,b)=>b.score-a.score).slice(0,16).map(item=>({id:template.id,...item.descriptor}))};
        });
        if(supported>=3){
          const rescored=line.tokens.map(token=>{
            if(!token.id)return token;
            const template=adapted.find(t=>t.id===token.id);
            const score=matchDescriptor(describe(mask,token.box),[template])[0]?.score||0;
            return {...token,score};
          });
          try{
            const tokens=recognizeLine(mask,line.box,adapted,'components');
            const differs=tokens.length!==line.tokens.length||tokens.some((token,i)=>token.id!==line.tokens[i]?.id);
            // Local evidence gates already require a meaningful gain in every
            // changed region. A fixed whole-row gain dilutes that evidence as
            // more unchanged glyphs are added; only require no regression here.
            if(differs&&supportedPageChanges(rescored,tokens,line.box)&&imageEvidence({lines:[{box:line.box,tokens}]})>imageEvidence({lines:[{box:line.box,tokens:rescored}]})){
              for(const token of tokens){
                const peer=line.tokens.find(t=>t.id===token.id&&overlap(t.box,token.box)>=.85);
                token.certain=token.certain&&Boolean(peer?.certain);
              }
              selected={...line,tokens,pageMatching:{method:'repeated-glyphs',referenceIds:supported}};changed++;
            }
          }catch(error){
            if(!/^(单行内容过多|无法切分这一行)/.test(error.message))throw error;
          }
          const finer=refineReferenceClusters(mask,selected,adapted,templates,options,gridBudget);
          if(finer.regions){
            if(selected===line)changed++;
            selected={...selected,tokens:finer.tokens,pageMatching:{method:'repeated-glyphs',referenceIds:supported,gridRegions:finer.regions}};
          }
        }
      }
      lines.push(selected);count+=selected.tokens.length;
      progress({done:row+1,total:baseline.lines.length,pass:4});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(options.cancelled?.())throw Error('已取消识别。');
    return changed&&count<=1500?{...baseline,lines,pageRefinement:{rows:changed}}:baseline;
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
    if(baseline.lines.some(l=>l.box.height<40)){
      const refined=await refineSmallRows(image,gray,baseline,templates,thresholds,options,progress);
      // A small page can also supply independent native-resolution references.
      // Sub-30-pixel rows cannot supply confident references or be recovered by
      // this pass; interpolation never changes their original resolution gate.
      return baseline.lines.filter(l=>l.box.height>=30).length>=3?refineRepeatedGlyphs(image,refined,templates,options,progress):refined;
    }
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
    chosen=thresholdConsensus(chosen,passes);
    const result={...chosen,thresholdSearch:{baseline:baseline.threshold,selected:chosen.threshold,passes:passes.map(p=>({threshold:p.threshold,evidence:imageEvidence(p)}))}};
    return refineRepeatedGlyphs(image,result,templates,options,progress);
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
  return {binarize,bounds,describe,prepareTemplates,matchDescriptor,rowBands,recognizeLine,recognize,thresholdConsensus,tokenGlyph,tokenReading,transcribe,toWriter};
});
