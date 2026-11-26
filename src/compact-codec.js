/* Self-contained synchronous RFC 1951 DEFLATE inflate and compact profile codec.
 * Offline only; zero dependencies; safe in browsers, Web Workers, and Node. */
(function(root,factory){
  const api=factory();
  api._source=factory.toString();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BabelianCompact=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_OUT=16*1024*1024;
  const CL_ORDER=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
  const LEN_BASE=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  const LEN_EXTRA=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  const DIST_BASE=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  const DIST_EXTRA=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  const B64_LUT=(()=>{
    const t=new Int8Array(128).fill(-1),chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for(let i=0;i<chars.length;i++)t[chars.charCodeAt(i)]=i;
    return t;
  })();
  function fromBase64(str){
    if(typeof str!=='string')throw Error('Invalid base64 payload');
    if(typeof Buffer==='function'&&typeof Buffer.from==='function'){
      const b=Buffer.from(str,'base64');
      return new Uint8Array(b.buffer,b.byteOffset,b.byteLength);
    }
    if(typeof atob==='function'){
      const bin=atob(str),out=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
      return out;
    }
    let clean=str.replace(/\s+/g,''),pad=clean.endsWith('==')?2:clean.endsWith('=')?1:0;
    const out=new Uint8Array((clean.length*3>>>2)-pad);let p=0;
    for(let i=0;i<clean.length;i+=4){
      const a=B64_LUT[clean.charCodeAt(i)],b=B64_LUT[clean.charCodeAt(i+1)];
      const c=clean[i+2]==='='?0:B64_LUT[clean.charCodeAt(i+2)],d=clean[i+3]==='='?0:B64_LUT[clean.charCodeAt(i+3)];
      if(a<0||b<0||c<0||d<0)throw Error('Invalid base64 character');
      const v=(a<<18)|(b<<12)|(c<<6)|d;
      out[p++]=(v>>>16)&255;if(p<out.length)out[p++]=(v>>>8)&255;if(p<out.length)out[p++]=v&255;
    }
    return out;
  }
  function buildHuffman(lengths,count){
    let maxBits=0;
    const counts=new Int32Array(16);
    for(let i=0;i<count;i++){const l=lengths[i];if(l){counts[l]++;if(l>maxBits)maxBits=l;}}
    if(!maxBits)return {maxBits:1,table:new Int32Array(2).fill(-1)};
    const offsets=new Int32Array(16);
    for(let b=1;b<15;b++)offsets[b+1]=offsets[b]+counts[b];
    const syms=new Int32Array(count),next=offsets.slice();
    for(let i=0;i<count;i++){const l=lengths[i];if(l)syms[next[l]++]=i;}
    const size=1<<maxBits,table=new Int32Array(size).fill(-1);
    let code=0,symIdx=0;
    for(let bits=1;bits<=maxBits;bits++){
      code<<=1;
      const n=counts[bits],step=1<<bits;
      for(let k=0;k<n;k++){
        // Reverse `bits` LSBs for direct LSB-first table lookup.
        let rev=0,c=code;
        for(let j=0;j<bits;j++){rev=(rev<<1)|(c&1);c>>>=1;}
        const entry=(syms[symIdx++]<<5)|bits;
        for(let at=rev;at<size;at+=step)table[at]=entry;
        code++;
      }
    }
    return {maxBits,mask:size-1,table};
  }
  let fixedLit=null,fixedDist=null;
  function getFixed(){
    if(fixedLit)return {lit:fixedLit,dist:fixedDist};
    const ll=new Uint8Array(288);
    ll.fill(8,0,144);ll.fill(9,144,256);ll.fill(7,256,280);ll.fill(8,280,288);
    const dl=new Uint8Array(32).fill(5);
    fixedLit=buildHuffman(ll,288);fixedDist=buildHuffman(dl,32);
    return {lit:fixedLit,dist:fixedDist};
  }
  function inflateRaw(input){
    const src=input instanceof Uint8Array?input:new Uint8Array(input);
    let pos=0,bitBuf=0,bitCnt=0,out=new Uint8Array(Math.min(MAX_OUT,Math.max(256,src.length*2))),outPos=0;
    const ensure=need=>{
      if(outPos+need<=out.length)return;
      if(outPos+need>MAX_OUT)throw Error('Inflate output exceeds safety limit');
      let nextLen=out.length;while(nextLen<outPos+need)nextLen=Math.min(MAX_OUT,nextLen*2);
      const next=new Uint8Array(nextLen);next.set(out.subarray(0,outPos));out=next;
    };
    const needBits=n=>{while(bitCnt<n){if(pos>=src.length)throw Error('Unexpected end of deflate stream');bitBuf|=src[pos++]<<bitCnt;bitCnt+=8;}};
    const readBits=n=>{if(!n)return 0;needBits(n);const v=bitBuf&((1<<n)-1);bitBuf>>>=n;bitCnt-=n;return v;};
    const decode=h=>{
      while(bitCnt<h.maxBits&&pos<src.length){bitBuf|=src[pos++]<<bitCnt;bitCnt+=8;}
      const entry=h.table[bitBuf&h.mask];
      if(entry<0)throw Error('Invalid Huffman code');
      const bits=entry&31;if(bits>bitCnt)throw Error('Truncated Huffman code');
      bitBuf>>>=bits;bitCnt-=bits;return entry>>>5;
    };
    for(;;){
      const bfinal=readBits(1),btype=readBits(2);
      if(btype===0){
        bitBuf=0;bitCnt=0;
        if(pos+4>src.length)throw Error('Truncated stored block');
        const len=src[pos]|(src[pos+1]<<8),nlen=src[pos+2]|(src[pos+3]<<8);pos+=4;
        if((len^0xffff)!==nlen||pos+len>src.length)throw Error('Corrupt stored block');
        ensure(len);out.set(src.subarray(pos,pos+len),outPos);pos+=len;outPos+=len;
      }else if(btype===1||btype===2){
        let lit,dist;
        if(btype===1){const f=getFixed();lit=f.lit;dist=f.dist;}
        else{
          const hlit=readBits(5)+257,hdist=readBits(5)+1,hclen=readBits(4)+4;
          const clLens=new Uint8Array(19);
          for(let i=0;i<hclen;i++)clLens[CL_ORDER[i]]=readBits(3);
          const clHuff=buildHuffman(clLens,19),total=hlit+hdist,lens=new Uint8Array(total);
          for(let i=0;i<total;){
            const sym=decode(clHuff);
            if(sym<16)lens[i++]=sym;
            else if(sym===16){
              if(!i)throw Error('Invalid code length repeat');
              const rep=readBits(2)+3,prev=lens[i-1];
              if(i+rep>total)throw Error('Code length overflow');
              lens.fill(prev,i,i+rep);i+=rep;
            }else if(sym===17){
              const rep=readBits(3)+3;if(i+rep>total)throw Error('Code length overflow');
              i+=rep;
            }else if(sym===18){
              const rep=readBits(7)+11;if(i+rep>total)throw Error('Code length overflow');
              i+=rep;
            }else throw Error('Invalid code length symbol');
          }
          lit=buildHuffman(lens,hlit);dist=buildHuffman(lens.subarray(hlit),hdist);
        }
        for(;;){
          const sym=decode(lit);
          if(sym<256){ensure(1);out[outPos++]=sym;}
          else if(sym===256)break;
          else{
            const li=sym-257;if(li<0||li>=LEN_BASE.length)throw Error('Invalid length symbol');
            const length=LEN_BASE[li]+readBits(LEN_EXTRA[li]);
            const di=decode(dist);if(di<0||di>=DIST_BASE.length)throw Error('Invalid distance symbol');
            const distance=DIST_BASE[di]+readBits(DIST_EXTRA[di]);
            if(distance>outPos)throw Error('Invalid back-reference distance');
            ensure(length);
            for(let k=0;k<length;k++)out[outPos+k]=out[outPos-distance+k];
            outPos+=length;
          }
        }
      }else throw Error('Invalid deflate block type');
      if(bfinal)break;
    }
    return out.subarray(0,outPos);
  }
  function inflateText(b64){
    const bytes=inflateRaw(fromBase64(b64));
    if(typeof TextDecoder==='function')return new TextDecoder('utf-8').decode(bytes);
    if(typeof Buffer==='function')return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).toString('utf8');
    let text='';for(let i=0;i<bytes.length;i++)text+=String.fromCharCode(bytes[i]);return text;
  }
  function pop(n){n-=(n>>>1)&0x55555555;n=(n&0x33333333)+((n>>>2)&0x33333333);return (((n+(n>>>4))&0x0f0f0f0f)*0x01010101)>>>24;}
  function widen32(rows){
    const wide=new Uint32Array(32);
    for(let y=0;y<32;y++){const r=rows[y]|(rows[y-1]||0)|(rows[y+1]||0);wide[y]=(r|(r<<1)|(r>>>1))>>>0;}
    return wide;
  }
  function widen64(rows){
    const wide=new Uint32Array(128);
    for(let y=0;y<64;y++){
      const l=rows[y*2]|(rows[(y-1)*2]||0)|(rows[(y+1)*2]||0);
      const r=rows[y*2+1]|(rows[(y-1)*2+1]||0)|(rows[(y+1)*2+1]||0);
      wide[y*2]=(l|(l<<1)|(l>>>1)|(r<<31))>>>0;
      wide[y*2+1]=(r|(r<<1)|(r>>>1)|(l>>>31))>>>0;
    }
    return wide;
  }
  function unpackVectorProfile(packed,{asArrays=false}={}){
    if(!packed||packed.version!==1||packed.encoding!=='deflate-rows-v1'||!Array.isArray(packed.entries)||packed.entries.length>1024||typeof packed.data!=='string')throw Error('矢量辅助模板格式不支持。');
    const raw=inflateRaw(fromBase64(packed.data));
    if(raw.byteLength!==packed.entries.length*640)throw Error('矢量辅助模板数据长度无效。');
    const view=new DataView(raw.buffer,raw.byteOffset,raw.byteLength),variants=[];
    for(let i=0;i<packed.entries.length;i++){
      const entry=packed.entries[i];
      if(!Array.isArray(entry)||entry.length!==3)throw Error('矢量辅助模板条目无效。');
      const [id,targetHeight,ratio]=entry,base=i*640;
      const rows=new Uint32Array(32),fineRows=new Uint32Array(128);
      let count=0,fineCount=0;
      for(let j=0;j<32;j++){const v=view.getUint32(base+j*4,true);rows[j]=v;count+=pop(v);}
      for(let j=0;j<128;j++){const v=view.getUint32(base+128+j*4,true);fineRows[j]=v;fineCount+=pop(v);}
      const wide=widen32(rows),fineWide=widen64(fineRows);
      variants.push({
        id,targetHeight,ratio,
        rows:asArrays?Array.from(rows):rows,wide:asArrays?Array.from(wide):wide,count,
        fine:{rows:asArrays?Array.from(fineRows):fineRows,wide:asArrays?Array.from(fineWide):fineWide,count:fineCount}
      });
    }
    return {version:1,variants};
  }
  return {fromBase64,inflateRaw,inflateText,unpackVectorProfile};
});
