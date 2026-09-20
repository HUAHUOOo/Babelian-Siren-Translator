const assert=require('node:assert/strict'),OCR=require('../src/ocr-engine.js'),{masks,draw}=require('./ocr.cjs');
(async()=>{
 const image=draw([['h','the','r','s','e','f','T','x']],{height:64}),bytes=Buffer.from(image.data);
 const result=await OCR.recognize(image,masks);assert(result.thresholdSearch);assert.deepEqual(Buffer.from(image.data),bytes);
 const manual=await OCR.recognize(image,masks,{threshold:result.threshold,polarity:result.polarity});assert.equal(manual.threshold,result.threshold);assert.equal(manual.thresholdSearch,undefined);
 const coarse=await OCR.recognize(image,masks,{detail:false});assert.equal(coarse.thresholdSearch,undefined);
 const low=await OCR.recognize(draw([['h','the','x']],{height:28}),masks);assert.equal(low.thresholdSearch,undefined);assert(low.lines[0].tokens.every(t=>!t.certain));
 // Replacing every opaque ID cannot change pixel boundaries or decisions.
 const ids=new Map(masks.map((m,i)=>[m.id,'opaque-'+i]));
 const renamed=await OCR.recognize(image,masks.map(m=>({...m,id:ids.get(m.id)})));
 assert.deepEqual(renamed.lines.map(l=>l.tokens.map(t=>({id:t.id,box:t.box,certain:t.certain}))),result.lines.map(l=>l.tokens.map(t=>({id:ids.get(t.id),box:t.box,certain:t.certain}))));
 const custom=Object.fromEntries(masks.map(m=>[m.id,'自定'+m.id]));
 const confirmed={...result,lines:result.lines.map(l=>({...l,tokens:l.tokens.map(t=>({...t,manual:true}))}))};
 assert(OCR.transcribe(confirmed,custom).startsWith('自定h'));
 for(const pass of [1,2,3]){let cancel=false;await assert.rejects(OCR.recognize(image,masks,{cancelled:()=>cancel},p=>{if(p.pass===pass)cancel=true;}),/取消/);}
 // Faint background marks exposed by an optional threshold must not make a
 // readable baseline fail its row-count limit or waste work on 100 extra rows.
 const noisy={width:image.width,height:image.height+1020,data:new Uint8Array(image.width*(image.height+1020)*4)};
 for(let i=0;i<noisy.data.length;i+=4){noisy.data[i]=noisy.data[i+1]=noisy.data[i+2]=244;noisy.data[i+3]=255;}
 noisy.data.set(image.data);
 for(let mark=0;mark<101;mark++)for(let y=0;y<5;y++)for(let c=0;c<3;c++)noisy.data[((image.height+mark*10+y)*image.width+10)*4+c]=170;
 const safe=await OCR.recognize(noisy,masks);assert.equal(safe.lines.length,1);assert.deepEqual(safe.lines[0].tokens.map(t=>t.id),result.lines[0].tokens.map(t=>t.id));
 console.log('PASS adaptive threshold: source integrity, manual/coarse/low-resolution fallbacks, opaque IDs, current mapping and cancellation.');
})().catch(e=>{console.error(e);process.exitCode=1;});
