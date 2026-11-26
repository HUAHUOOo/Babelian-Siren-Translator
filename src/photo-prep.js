/* Offline mobile-photo preprocessing: local illumination equalization,
 * projection-based skew estimation, and lossless/bilinear rotation.
 * Never mutates input pixels; zero network calls or external dependencies. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BabelianPhotoPrep=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_PIXELS=16000000;
  const clamp=(v,lo,hi)=>v<lo?lo:v>hi?hi:v;

  function validate(image){
    if(!image||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<1||image.height<1||image.width*image.height>MAX_PIXELS||!image.data||image.data.length<image.width*image.height*4){
      throw Error('图像尺寸不支持预处理，请先裁剪到1600万像素以内。');
    }
  }

  function borderFillColor(image){
    const {width:w,height:h,data}=image;
    const border=Math.min(4,Math.max(1,Math.floor(Math.min(w,h)/8)));
    const step=Math.max(1,Math.floor(Math.max(w,h)/160));
    const rs=[],gs=[],bs=[];
    const push=(x,y)=>{
      const i=(y*w+x)*4,a=data[i+3]/255;
      rs.push(Math.round(data[i]*a+255*(1-a)));
      gs.push(Math.round(data[i+1]*a+255*(1-a)));
      bs.push(Math.round(data[i+2]*a+255*(1-a)));
    };
    for(let y=0;y<h;y+=step){
      for(let x=0;x<border;x++)push(x,y);
      for(let x=Math.max(border,w-border);x<w;x++)push(x,y);
    }
    for(let x=border;x<w-border;x+=step){
      for(let y=0;y<border;y++)push(x,y);
      for(let y=Math.max(border,h-border);y<h;y++)push(x,y);
    }
    const med=arr=>{if(!arr.length)return 255;arr.sort((a,b)=>a-b);return arr[arr.length>>1];};
    return [med(rs),med(gs),med(bs)];
  }

  function luminanceInfo(image){
    const {width:w,height:h,data}=image,len=w*h,lum=new Uint8Array(len);
    for(let i=0;i<len;i++){
      const j=i*4,a=data[j+3]/255;
      lum[i]=Math.round((data[j]*.299+data[j+1]*.587+data[j+2]*.114)*a+255*(1-a));
    }
    const edgeHist=new Uint32Array(256),border=Math.min(4,Math.max(1,Math.floor(Math.min(w,h)/8)));
    let edgeCount=0;
    for(let y=0;y<h;y++){
      const row=y*w;
      if(y<border||y>=h-border){for(let x=0;x<w;x++){edgeHist[lum[row+x]]++;edgeCount++;}}
      else{
        for(let x=0;x<border;x++){edgeHist[lum[row+x]]++;edgeCount++;}
        for(let x=Math.max(border,w-border);x<w;x++){edgeHist[lum[row+x]]++;edgeCount++;}
      }
    }
    let background=255,sum=0;
    for(let v=0;v<256;v++){sum+=edgeHist[v];if(sum>=edgeCount/2){background=v;break;}}
    return {lum,background,polarity:background<128?'light':'dark'};
  }

  function estimateBackground(lum,w,h,polarity){
    const cell=clamp(Math.round(Math.min(w,h)/10),12,56);
    const gw=Math.max(2,Math.ceil(w/cell)),gh=Math.max(2,Math.ceil(h/cell));
    const grid=new Float32Array(gw*gh),samples=[];
    const darkInk=polarity==='dark';
    for(let gy=0;gy<gh;gy++){
      const y0=Math.floor(gy*h/gh),y1=Math.max(y0+1,Math.floor((gy+1)*h/gh));
      const sy=Math.max(1,Math.floor((y1-y0)/8));
      for(let gx=0;gx<gw;gx++){
        const x0=Math.floor(gx*w/gw),x1=Math.max(x0+1,Math.floor((gx+1)*w/gw));
        const sx=Math.max(1,Math.floor((x1-x0)/8));
        samples.length=0;
        for(let y=y0;y<y1;y+=sy){
          const row=y*w;
          for(let x=x0;x<x1;x+=sx)samples.push(lum[row+x]);
        }
        samples.sort((a,b)=>a-b);
        // Use upper/lower quartile of each cell so strokes never drag background.
        const q=darkInk?Math.min(samples.length-1,Math.floor(samples.length*.8)):Math.floor(samples.length*.2);
        grid[gy*gw+gx]=samples[q];
      }
    }
    // Two separable [1, 2, 1] / 4 passes on interior cells; keep boundaries unbiased on gradients.
    const tmp=new Float32Array(gw*gh);
    for(let pass=0;pass<2;pass++){
      for(let y=0;y<gh;y++){
        const row=y*gw;
        tmp[row]=grid[row];tmp[row+gw-1]=grid[row+gw-1];
        for(let x=1;x<gw-1;x++)tmp[row+x]=(grid[row+x-1]+2*grid[row+x]+grid[row+x+1])*.25;
      }
      for(let x=0;x<gw;x++){grid[x]=tmp[x];grid[(gh-1)*gw+x]=tmp[(gh-1)*gw+x];}
      for(let y=1;y<gh-1;y++){
        const up=(y-1)*gw,mid=y*gw,dn=(y+1)*gw;
        for(let x=0;x<gw;x++)grid[mid+x]=(tmp[up+x]+2*tmp[mid+x]+tmp[dn+x])*.25;
      }
    }
    let minBg=255,maxBg=0;
    for(let i=0;i<grid.length;i++){if(grid[i]<minBg)minBg=grid[i];if(grid[i]>maxBg)maxBg=grid[i];}
    return {grid,gw,gh,minBg,maxBg,gradientSpan:maxBg-minBg};
  }

  function sampleGrid(grid,gw,gh,x,y,w,h){
    const fx=(x+.5)*gw/w-.5,fy=(y+.5)*gh/h-.5;
    const x0=clamp(Math.floor(fx),0,gw-2),y0=clamp(Math.floor(fy),0,gh-2);
    const dx=clamp(fx-x0,-.5,1.5),dy=clamp(fy-y0,-.5,1.5);
    const r0=y0*gw,r1=(y0+1)*gw;
    const v=(grid[r0+x0]*(1-dx)+grid[r0+x0+1]*dx)*(1-dy)+(grid[r1+x0]*(1-dx)+grid[r1+x0+1]*dx)*dy;
    return clamp(v,0,255);
  }

  function equalizeLighting(image){
    validate(image);
    const {width:w,height:h}=image,{lum,polarity}=luminanceInfo(image);
    const bgInfo=estimateBackground(lum,w,h,polarity),{grid,gw,gh,gradientSpan}=bgInfo;
    const darkInk=polarity==='dark',norm=new Uint8Array(w*h),hist=new Uint32Array(256);
    for(let y=0;y<h;y++){
      const row=y*w;
      for(let x=0;x<w;x++){
        const i=row+x,bg=sampleGrid(grid,gw,gh,x,y,w,h);
        let v;
        if(darkInk){
          v=clamp(Math.round(255*(lum[i]/Math.max(24,bg))),0,255);
        }else{
          const inv=255-lum[i],invBg=Math.max(24,255-bg);
          v=clamp(Math.round(255*(inv/invBg)),0,255);
        }
        norm[i]=v;hist[v]++;
      }
    }
    // Stretch washed-out glare contrast gently while keeping clean dark strokes intact.
    const total=w*h,loTarget=Math.max(1,total*.005),hiTarget=Math.max(1,total*.92);
    let pLo=0,pHi=255,acc=0;
    for(let v=0;v<256;v++){acc+=hist[v];if(acc>=loTarget){pLo=v;break;}}
    acc=0;
    for(let v=0;v<256;v++){acc+=hist[v];if(acc>=hiTarget){pHi=v;break;}}
    const stretch=pHi-pLo>=18&&(pLo>28||pHi<252),lo=pLo>28?Math.floor(pLo*.85):0,span=Math.max(1,pHi-lo);
    const data=new Uint8ClampedArray(total*4);
    for(let i=0;i<total;i++){
      let v=stretch?clamp(Math.round((norm[i]-lo)*255/span),0,255):norm[i];
      if(!darkInk)v=255-v;
      const j=i*4;data[j]=data[j+1]=data[j+2]=v;data[j+3]=255;
    }
    return {width:w,height:h,data,polarity,gradientSpan};
  }

  function downsample(image,maxSide=420){
    const scale=Math.min(1,maxSide/Math.max(image.width,image.height));
    if(scale>=1)return {width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)};
    const w=Math.max(1,Math.round(image.width*scale)),h=Math.max(1,Math.round(image.height*scale));
    const data=new Uint8ClampedArray(w*h*4),sx=image.width/w,sy=image.height/h;
    for(let y=0;y<h;y++){
      const srcY=Math.min(image.height-1,Math.floor((y+.5)*sy))*image.width;
      for(let x=0;x<w;x++){
        const s=(srcY+Math.min(image.width-1,Math.floor((x+.5)*sx)))*4,d=(y*w+x)*4;
        data[d]=image.data[s];data[d+1]=image.data[s+1];data[d+2]=image.data[s+2];data[d+3]=image.data[s+3];
      }
    }
    return {width:w,height:h,data};
  }

  function otsuThreshold(hist,total){
    let sum=0;for(let i=0;i<256;i++)sum+=hist[i]*i;
    let weight=0,partial=0,max=-1,threshold=127;
    for(let i=0;i<255;i++){
      weight+=hist[i];partial+=hist[i]*i;if(!weight||weight===total)continue;
      const delta=partial/weight-(sum-partial)/(total-weight),variance=weight*(total-weight)*delta*delta;
      if(variance>max){max=variance;threshold=i;}
    }
    return threshold;
  }

  function estimateSkew(image,{maxAngle=15}={}){
    validate(image);
    const limit=clamp(Number(maxAngle)||15,1,20);
    const small=downsample(image,420);
    const flat=equalizeLighting(small),{width:w,height:h,data,polarity}=flat;
    const hist=new Uint32Array(256),len=w*h;
    for(let i=0;i<len;i++)hist[data[i*4]]++;
    const threshold=otsuThreshold(hist,len),darkInk=polarity==='dark';
    const rawX=[],rawY=[];
    for(let y=0;y<h;y++){
      const row=y*w;
      for(let x=0;x<w;x++){
        const v=data[(row+x)*4];
        if(darkInk?v<=threshold:v>threshold){rawX.push(x-w*.5);rawY.push(y-h*.5);}
      }
    }
    if(rawX.length<40||rawX.length>len*.85)return {angle:0,confident:false,improvement:1};
    const stride=Math.max(1,Math.ceil(rawX.length/8000));
    const count=Math.ceil(rawX.length/stride),px=new Float32Array(count),py=new Float32Array(count);
    for(let i=0,k=0;i<rawX.length;i+=stride,k++){px[k]=rawX[i];py[k]=rawY[i];}
    const diag=Math.ceil(Math.hypot(w,h))+4,half=diag>>1,proj=new Int32Array(diag);
    // Positive correctionDeg rotates the image clockwise (screen Y down) to level text.
    const scoreCorrection=deg=>{
      const r=deg*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
      proj.fill(0);
      for(let i=0;i<count;i++){
        const bin=Math.round(px[i]*s+py[i]*c)+half;
        if(bin>=0&&bin<diag)proj[bin]++;
      }
      let energy=0,prev=0;
      for(let i=0;i<diag;i++){const cur=proj[i],d=cur-prev;energy+=d*d;prev=cur;}
      return energy;
    };
    const coarseScores=[];let bestAngle=0,bestScore=-1;
    for(let a=-limit;a<=limit;a++){
      const sc=scoreCorrection(a);coarseScores.push(sc);
      if(sc>bestScore){bestScore=sc;bestAngle=a;}
    }
    for(let a=Math.max(-limit,bestAngle-1.2);a<=Math.min(limit,bestAngle+1.2)+1e-6;a+=.2){
      const sc=scoreCorrection(a);if(sc>bestScore){bestScore=sc;bestAngle=a;}
    }
    for(let a=Math.max(-limit,bestAngle-.3);a<=Math.min(limit,bestAngle+.3)+1e-6;a+=.1){
      const sc=scoreCorrection(a);if(sc>bestScore){bestScore=sc;bestAngle=a;}
    }
    coarseScores.sort((a,b)=>a-b);
    const median=coarseScores[coarseScores.length>>1]||1,zeroScore=scoreCorrection(0)||1;
    const improvement=bestScore/zeroScore,rounded=Math.round(bestAngle*10)/10;
    const confident=bestScore>median*1.18&&(Math.abs(rounded)<.4||improvement>1.04);
    return {angle:confident&&Math.abs(rounded)>=.4?rounded:0,confident,improvement};
  }

  function rotate90(image,turns){
    const {width:w,height:h,data}=image;
    if(turns===0)return {width:w,height:h,data:new Uint8ClampedArray(data)};
    const outW=turns%2?h:w,outH=turns%2?w:h,out=new Uint8ClampedArray(outW*outH*4);
    for(let y=0;y<h;y++){
      for(let x=0;x<w;x++){
        let nx,ny;
        if(turns===1){nx=h-1-y;ny=x;}
        else if(turns===2){nx=w-1-x;ny=h-1-y;}
        else{nx=y;ny=w-1-x;}
        const s=(y*w+x)*4,d=(ny*outW+nx)*4;
        out[d]=data[s];out[d+1]=data[s+1];out[d+2]=data[s+2];out[d+3]=data[s+3];
      }
    }
    return {width:outW,height:outH,data:out};
  }

  function rotateFine(image,angleDeg){
    const {width:w,height:h,data}=image;
    const rad=angleDeg*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);
    const ac=Math.abs(c),as=Math.abs(s);
    let outW=Math.max(w,Math.ceil(w*ac+h*as)),outH=Math.max(h,Math.ceil(w*as+h*ac));
    if(outW*outH>MAX_PIXELS){outW=w;outH=h;}
    const out=new Uint8ClampedArray(outW*outH*4);
    const [fr,fg,fb]=borderFillColor(image);
    const cx=(w-1)*.5,cy=(h-1)*.5,ocx=(outW-1)*.5,ocy=(outH-1)*.5;
    for(let y=0;y<outH;y++){
      const dy=y-ocy;
      for(let x=0;x<outW;x++){
        const dx=x-ocx;
        // Inverse map clockwise screen rotation by angleDeg.
        const sx=dx*c+dy*s+cx,sy=-dx*s+dy*c+cy;
        const dst=(y*outW+x)*4;
        if(sx<0||sy<0||sx>w-1||sy>h-1){
          out[dst]=fr;out[dst+1]=fg;out[dst+2]=fb;out[dst+3]=255;continue;
        }
        const x0=sx|0,y0=sy|0,x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1);
        const fx=sx-x0,fy=sy-y0,w00=(1-fx)*(1-fy),w10=fx*(1-fy),w01=(1-fx)*fy,w11=fx*fy;
        const i00=(y0*w+x0)*4,i10=(y0*w+x1)*4,i01=(y1*w+x0)*4,i11=(y1*w+x1)*4;
        out[dst]=Math.round(data[i00]*w00+data[i10]*w10+data[i01]*w01+data[i11]*w11);
        out[dst+1]=Math.round(data[i00+1]*w00+data[i10+1]*w10+data[i01+1]*w01+data[i11+1]*w11);
        out[dst+2]=Math.round(data[i00+2]*w00+data[i10+2]*w10+data[i01+2]*w01+data[i11+2]*w11);
        out[dst+3]=Math.round(data[i00+3]*w00+data[i10+3]*w10+data[i01+3]*w01+data[i11+3]*w11);
      }
    }
    return {width:outW,height:outH,data:out};
  }

  function transformImage(image,{quarterTurns=0,angle=0,equalize=false}={}){
    validate(image);
    const turns=((Math.round(Number(quarterTurns)||0)%4)+4)%4;
    const deg=clamp(Number(angle)||0,-15,15);
    let current={width:image.width,height:image.height,data:new Uint8ClampedArray(image.data)};
    if(turns)current=rotate90(current,turns);
    if(equalize)current=equalizeLighting(current);
    if(Math.abs(deg)>=.05)current=rotateFine(current,deg);
    return current;
  }

  function assess(image){
    validate(image);
    const small=downsample(image,320);
    const {lum,polarity}=luminanceInfo(small);
    const bg=estimateBackground(lum,small.width,small.height,polarity);
    const skew=estimateSkew(small);
    return {
      polarity,
      gradientSpan:Math.round(bg.gradientSpan),
      unevenLighting:bg.gradientSpan>=35,
      skewAngle:skew.confident?skew.angle:0,
      skewed:skew.confident&&Math.abs(skew.angle)>=1.5
    };
  }

  return {equalizeLighting,estimateSkew,transformImage,assess};
});
