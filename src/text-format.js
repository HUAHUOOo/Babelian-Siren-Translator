/* Formatting is a separate suggestion layer. It cannot alter glyph recognition,
   case, non-whitespace source characters, or unresolved OCR placeholders. */
(function(root,factory){
 const commonJS=typeof module==='object'&&module.exports;
 const api=factory(commonJS?require('./domain-terms.json'):root.BabelianDomainTerms);
 if(commonJS)module.exports=api;else root.BabelianTextFormat=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(domainTerms){
 'use strict';
 domainTerms=domainTerms||{};
 const DOMAIN='aeon trespass odyssey babelian siren sirens strider dahaka dionysian alchemy thnitos khrusos umbral antinomy ambrosia aether arcology irem poseidon poseidons alitheia argo argonaut argonauts titan titans primordial primordials ur fleece sisyphus pandora hermes trismegistus petrified dissipate coalesce seawater amorphous storybook unbestowed rot';
 function create(wordData){
  const words=typeof wordData==='string'?wordData.trim().split(/\s+/):wordData;
  const costs=new Map();let max=1;
  for(const [i,word] of words.entries())if(/^[a-z]{2,32}$/.test(word)||word==='a'||word==='i'){
   if(!costs.has(word))costs.set(word,Math.log((i+1)*Math.log(words.length+1)));max=Math.max(max,word.length);
  }
  for(const word of [...DOMAIN.split(' '),...(domainTerms.words||[])])if(/^[a-z]{2,40}$/.test(word)){
   costs.set(word,Math.min(costs.get(word)??Infinity,8));max=Math.max(max,word.length);
  }
  const phrases=new Map();
  for(const phrase of ['narrow hell',...(domainTerms.phrases||[])]){
   const parts=phrase.split(' '),key=parts.join('');
   if(parts.length<2||parts.length>10||key.length>120||parts.some(p=>!/^[a-z]{1,40}$/.test(p)))continue;
   const cost=parts.reduce((sum,p)=>sum+(costs.get(p)??8),0)-Math.min(3,.6*(parts.length-1));
   if(cost<(phrases.get(key)?.cost??Infinity))phrases.set(key,{parts,cost});
   max=Math.max(max,key.length);
  }
  function split(text,extra=[]){
   const lower=text.toLowerCase(),n=lower.length,local=new Map();
   for(const word of extra){const w=word.toLowerCase();if(/^[a-z]{2,40}$/.test(w))local.set(w,5.5);}
   const limit=Math.max(max,...Array.from(local.keys(),w=>w.length),1);
   const dp=new Float64Array(n+1).fill(Infinity),back=Array(n+1);dp[0]=0;
   for(let end=1;end<=n;end++){
    for(let size=1;size<=Math.min(end,limit);size++){
     const start=end-size,word=lower.slice(start,end),cost=local.get(word)??costs.get(word);
     if(cost===undefined)continue;
     if(dp[start]+cost<dp[end]){dp[end]=dp[start]+cost;back[end]={start,known:true};}
    }
    for(let size=2;size<=Math.min(end,max);size++){
     const start=end-size,phrase=phrases.get(lower.slice(start,end));
     if(phrase&&dp[start]+phrase.cost<dp[end]){dp[end]=dp[start]+phrase.cost;back[end]={start,known:true,parts:phrase.parts};}
    }
    // Unknown strings remain present; do not spell-correct or invent letters.
    for(let size=1;size<=Math.min(end,40);size++){
     const start=end-size,cost=dp[start]+15+size*3;
     if(cost<dp[end]){dp[end]=cost;back[end]={start,known:false};}
    }
   }
   const parts=[];for(let at=n;at;){
    const step=back[at];
    if(step.parts){
     let end=at;
     for(const word of [...step.parts].reverse()){parts.push({text:text.slice(end-word.length,end),known:true});end-=word.length;}
    }else parts.push({text:text.slice(step.start,at),known:step.known});
    at=step.start;
   }
   return parts.reverse();
  }
  function suggest(payload,{punctuate=true,extraWords=[]}={}){
   if(typeof payload.text!=='string'||payload.text.length>80000)throw Error('文本过长，请分段整理。');
   // Physical line wraps have no word-boundary meaning. Existing spaces inside
   // a user's word mapping still constrain the segmentation.
   const boundaries=new Set();
   for(const span of payload.spans||[]){
    if(!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<0||span.end>payload.text.length||span.start>=span.end)continue;
    const value=payload.text.slice(span.start,span.end);
    // A recognized word-valued glyph supplies a real boundary even though
    // neighboring letter-valued glyphs have no spaces in the raw transcript.
    // Keep THE + N distinct from THEN; ordinary glyph spacing is not evidence.
    if(/^[A-Za-z]{2,40}$/.test(value)&&costs.has(value.toLowerCase())){boundaries.add(span.start);boundaries.add(span.end);}
   }
   const chars=[];
   for(let i=0;i<=payload.text.length;i++){
    if(boundaries.has(i))chars.push(' ');
    if(i<payload.text.length&&payload.text[i]!=='\n'&&!(payload.text[i]==='\r'&&payload.text[i+1]==='\n'))chars.push(payload.text[i]);
   }
   const stream=chars.join(''),unknown=[];
   let text=stream.replace(/[A-Za-z]+(?:'[sS]\b)?/g,chunk=>{
    // Preserve an existing possessive as punctuation, not a separate unknown
    // one-letter word. Segmentation still reads exactly the source letters.
    const suffix=/'[sS]$/.test(chunk)?chunk.slice(-2):'',body=suffix?chunk.slice(0,-2):chunk;
    return split(body,extraWords).map(p=>{if(!p.known)unknown.push(p.text);return p.text;}).join(' ')+suffix;
   });
   text=text.replace(/\[\?\]|\[未映射\]/g,m=>' '+m+' ').replace(/[\t ]+/g,' ').trim();
   // Whitespace after existing punctuation; all source punctuation stays intact.
   text=text.replace(/([.,;:!?])(?=[A-Za-z])/g,'$1 ');
   text=text.replace(/([A-Za-z])(?=[0-9])/g,'$1 ').replace(/([0-9])(?=[A-Za-z])/g,'$1 ');
   let punctuationCount=0;
   if(punctuate){const result=sentenceSuggestions(text);text=result.text;punctuationCount=result.count;}
   const aligned=reflow(payload,text); // Fail closed if a formatting rule alters source letters.
   return {...aligned,unknown:[...new Set(unknown)],punctuationCount};
  }
  return {split,suggest};
 }
 function sentenceSuggestions(text){
  let possessives=0;
  // Only a confirmed singular proper-name reading receives this apostrophe.
  // It is a punctuation suggestion; OCR IDs and source letters never change.
  // Do not apply a generic trailing-s rule to gods, souls or other plurals.
  text=text.replace(/\b(poseidon)(s)\b/gi,(_,name,s)=>{possessives++;return name+"'"+s;});
  const words=[...text.matchAll(/[A-Za-z]+/g)].map(m=>({text:m[0],lower:m[0].toLowerCase(),start:m.index,end:m.index+m[0].length}));
  const inserts=new Map();let count=possessives,start=0,finite=false,question=false;
  const verbs=new Set('is are was were be been has have had can may must will would should falls coils stirs comes awaits turns carries treats want win lose see think granted saw ends remains knows know broken lies stands begins ends'.split(' '));
  const copulas=new Set('is are was were'.split(' ')),nominalStarts=new Set();
  const dependent=new Set('and but or nor neither either also not as than that which who whom whose what when where why how whatever whoever whenever wherever whether if unless because since while whilst whereas though although before after until once so except including with without of for from to in into on onto at by through under over between among near around against about despite during'.split(' '));
  const modifiers=new Set('very quite rather still already almost fully entirely'.split(' '));
  const predicates=new Set('open closed quiet silent cold warm hot dark bright ready safe lost broken gone dead alive awake asleep empty full clear blue red green'.split(' '));
  const determiners=new Set('the a an this these those my your his her its our their each every any all both'.split(' '));
  // Conservative adjacent copular clauses: a complete, short predicate followed
  // by a short nominal subject. Repeated predicates work without a topic-specific
  // noun/adjective list. Connectives and relatives keep their clause together.
  let priorCopula=-1;
  for(let i=0;i<words.length;i++)if(copulas.has(words[i].lower)){
   if(priorCopula>=0){
    let complement=priorCopula+1;
    while(complement<i&&modifiers.has(words[complement].lower))complement++;
    const candidate=complement+1,subjectWords=words.slice(candidate,i),predicate=words[complement]?.lower||'';
    const repeated=predicate===words[i+1]?.lower,complete=repeated||/(?:ing|ed)$/.test(predicate)||predicates.has(predicate);
    const anchored=subjectWords.length===1||repeated||determiners.has(subjectWords[0]?.lower);
    const shortNominal=subjectWords.length>=1&&subjectWords.length<=4&&anchored&&subjectWords.every((w,n)=>!dependent.has(w.lower)&&!verbs.has(w.lower)&&!(n&&/^(the|a|an)$/.test(w.lower)&&!(n===1&&/^(all|both)$/.test(subjectWords[0].lower))));
    // Dummy "it is clear/likely ..." can introduce a complement without "that".
    const complementClause=words[priorCopula-1]?.lower==='it'&&/^(clear|likely|possible|certain|true|obvious|important|necessary|known|expected|believed|understood|said|assumed|reported|thought|suggested|supposed|proven|accepted|suspected)$/.test(predicate);
    if(complete&&shortNominal&&!complementClause&&!/[.!?:;,]|\[/.test(text.slice(words[priorCopula].end,words[i].start)))nominalStarts.add(candidate);
   }
   priorCopula=i;
  }
  const questionWords=new Set('what who where when why how'.split(' '));
  const questionAuxiliaries=new Set('is are was were do does did can could will would should has have had must'.split(' '));
  const indirect=new Set('know knows knew known wonder wonders wondered ask asks asked explain explains explained remember remembers remembered understand understands understood tell tells told say says said see sees saw hear hears heard'.split(' '));
  // Only repeated, short nominal complements of a participial predicate form
  // this list. Nested relatives, finite clauses, markers and existing punctuation
  // are not evidence for inserting commas between ordinary occurrences of with.
  function participialList(from,to){
   const positions=[];
   for(let i=from;i<to;i++)if(words[i].lower==='with')positions.push(i);
   if(positions.length<3)return [];
   const first=positions[0],predicate=first-1;
   if(!/ing$/.test(words[predicate]?.lower||''))return [];
   let anchor=predicate-1;
   while(anchor>=from&&modifiers.has(words[anchor].lower))anchor--;
   if(predicate!==from&&!copulas.has(words[anchor]?.lower))return [];
   const allowed=new Set('with of and or nor'.split(' '));
   for(let n=0;n<positions.length;n++){
    const end=positions[n+1]??to,phrase=words.slice(positions[n]+1,end);
    if(!phrase.length||phrase.length>10||phrase.some(w=>verbs.has(w.lower)||indirect.has(w.lower)||dependent.has(w.lower)&&!allowed.has(w.lower)))return [];
   }
   if(/[.!?:;,]|\[/.test(text.slice(words[first].start,words[to-1].end)))return [];
   return positions;
  }
  for(let i=0;i<words.length;i++){
   const w=words[i],prior=words[i-1],gap=prior?text.slice(prior.end,w.start):'';
   if(/[.!?]/.test(gap.replace(/\[\?\]|\[未映射\]/g,''))){start=i;finite=false;question=false;}
   const prev=prior?.lower,n=i-start;
   const boundary=/^(if|however|otherwise|meanwhile|nevertheless|therefore|though)$/.test(w.lower)&&!['as','even','only','and','but'].includes(prev);
   const subject=/^(you|it|they|we|this|there)$/.test(w.lower)&&/^(can|may|must|will|should|is|are|was|were|has|have)$/.test(words[i+1]?.lower||'')&&!['that','which','where','who','when','because','if','though','as','so'].includes(prev);
   // Optative clauses ("may he live ...") start a new wish, unlike the ordinary
   // permission construction ("you may draw ..."). Never change source case.
   const wish=w.lower==='may'&&/^(he|she|it|they|we|you)$/.test(words[i+1]?.lower||'')&&/^(live|rot|rest|prosper|survive|find|be|have|fall|remain|burn|perish)$/.test(words[i+2]?.lower||'')&&!['and','but','that','whether'].includes(prev);
   // A completed presentational participle list can precede an independent
   // speaker clause. Never split a relative or an ordinary "words I say" phrase.
   const report=/^(i|we|he|she|they)$/.test(w.lower)&&/^(say|said|declare|declared|insist|insisted|warn|warned)$/.test(words[i+1]?.lower||'')&&
    n>=5&&/ing$/.test(words[start]?.lower||'')&&words[start+1]?.lower==='with'&&participialList(start,i).length>=3;
   if((report||finite&&(nominalStarts.has(i)||n>=5&&(boundary||subject||wish)))&&!/[.!?:;]|\[/.test(gap)){
    inserts.set(w.start,question?'?\n':'.\n');count++;start=i;finite=false;question=false;
   }
   const directQuestion=questionWords.has(w.lower)&&questionAuxiliaries.has(words[i+1]?.lower)&&(i===start||finite&&/^(and|but)$/.test(prev)&&!words.slice(start,i).some(token=>indirect.has(token.lower)));
   if(directQuestion&&!/\[/.test(text.slice(words[start]?.start??0,w.start)))question=true;
   if(verbs.has(w.lower))finite=true;
  }
  // A short leading conditional followed by an instruction needs a comma.
  const commands=new Set('proceed see draw gain discard return choose apply resolve place remove take ignore'.split(' '));
  for(let i=0;i<words.length;i++)if(words[i].lower==='if'){
   for(let j=i+3;j<Math.min(words.length,i+15);j++){
    if(/[.!?;]|\[/.test(text.slice(words[i].end,words[j].start))||inserts.has(words[j].start))break;
    if(commands.has(words[j].lower)){
     if(!/[,;:]\s*$/.test(text.slice(0,words[j].start))){inserts.set(words[j].start,', ');count++;}break;
    }
   }
  }
  let listStart=0;
  for(let i=1;i<=words.length;i++){
   const gap=i<words.length?text.slice(words[i-1].end,words[i].start):'';
   if(i===words.length||/[.!?;:]/.test(gap.replace(/\[\?\]|\[未映射\]/g,''))||/^[.?]/.test(inserts.get(words[i]?.start)||'')){
    for(const at of participialList(listStart,i).slice(1))if(!inserts.has(words[at].start)){inserts.set(words[at].start,', ');count++;}
    listStart=i;
   }
  }
  let out=text;
  for(const [at,value] of [...inserts].sort((a,b)=>b[0]-a[0]))out=out.slice(0,at).replace(/[ \t]+$/,'')+value+out.slice(at);
  if(words.length>=3&&/[A-Za-z0-9]$/.test(out)&&!out.endsWith('[未映射]')){out+=question?'?':'.';count++;}
  return {text:out,count};
 }
 function reflow(payload,formatted){
  if(typeof formatted!=='string'||formatted.length>100000)throw Error('整理文本过长。');
  const source=payload.text,positions=new Int32Array(source.length).fill(-1);let i=0,j=0;
  const added=/^[\s.,;:!?，。；：！？“”‘’"'()—-]$/;
  while(i<source.length){
   if(/\s/.test(source[i])){i++;continue;}
   const marker=source.startsWith('[?]',i)?'[?]':source.startsWith('[未映射]',i)?'[未映射]':null;
   if(marker){
    while(j<formatted.length&&added.test(formatted[j]))j++;
    if(formatted.slice(j,j+marker.length)!==marker)throw Error('请保留完整的 [?] / [未映射] 占位符。');
    for(let k=0;k<marker.length;k++)positions[i+k]=j+k;i+=marker.length;j+=marker.length;continue;
   }
   while(j<formatted.length&&formatted[j]!==source[i]&&added.test(formatted[j]))j++;
   if(formatted[j]!==source[i])throw Error('只能调整空格和标点，不能改动原文字母、大小写或数字；请到逐字复核或映射中修改。');
   positions[i]=j;i++;j++;
  }
  while(j<formatted.length&&added.test(formatted[j]))j++;
  if(j!==formatted.length)throw Error('整理文本中出现了原文没有的字母、数字或占位符。');
  const spans=(payload.spans||[]).map(span=>{
   const hits=[];for(let at=span.start;at<span.end;at++)if(positions[at]>=0)hits.push(positions[at]);
   if(!hits.length)return null;
   const start=hits[0],end=hits.at(-1)+1;return {...span,start,end,text:formatted.slice(start,end)};
  }).filter(Boolean);
  return {text:formatted,spans};
 }
 function createDraft(formatter){
  let draft=null;
  const key=(payload,options)=>JSON.stringify([payload,options]);
  function generate(payload,options){
   const output=formatter.suggest(payload,options);
   draft={payload,signature:key(payload,options),value:output.text,meta:output,dirty:false,stale:false};return state();
  }
  function state(){
   if(!draft)return null;
   let error='';
   if(draft.stale)error='逐字原文、映射或整理设置已变化。手动编辑已保留，请重新生成建议后再复制或追加。';
   else try{reflow(draft.payload,draft.value);}catch(e){error=e.message;}
   return {value:draft.value,dirty:draft.dirty,stale:draft.stale,meta:draft.meta,error};
  }
  return {
   state,generate,clear:()=>{draft=null;},
   update(payload,options){
    if(!draft)return generate(payload,options);
    if(key(payload,options)===draft.signature){draft.stale=false;return state();}
    if(draft.dirty){draft.stale=true;return state();}
    return generate(payload,options);
   },
   edit(value){if(!draft)return null;draft.value=value;draft.dirty=true;return state();},
   payload(){const current=state();if(!current||current.error)throw Error(current?.error||'尚无整理结果。');return reflow(draft.payload,draft.value);}
  };
 }
 return {create,reflow,sentenceSuggestions,createDraft};
});
