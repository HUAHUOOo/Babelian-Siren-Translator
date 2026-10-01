/* Derive a terminology-only vocabulary from a user-supplied story data file.
 * Parse JSON without executing JavaScript. Story passages never enter output. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
function extract(raw){
 const data=JSON.parse(raw.replace(/^\uFEFF?\s*window\.STORYBOOK_DATA\s*=\s*/,'').replace(/;\s*$/,''));
 if(!Array.isArray(data.books))throw Error('Expected STORYBOOK_DATA.books');
 const terms=new Set(),words=new Set(),phrases=new Set(),skipped=new Set();
 const common=new Set(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../src/english-words.txt.gz'))).toString().trim().split(/\s+/).slice(0,25000));
 const candidates=new Map();
 function ordinaryJoinedWords(name){
  const value=name.toLowerCase().replace(/['’]s$/,''),parts=new Int16Array(value.length+1).fill(-1);parts[0]=0;
  if(!/^(?:(?:it|he|she|they|you|we)(?:can|may|has|is|will|must|should|would|have|had|are|were)|(?:roll|gain|lose|see|return)(?:a|an))/.test(value))return false;
  for(let end=1;end<=value.length;end++)for(let start=0;start<end;start++){
   const word=value.slice(start,end);
   if(parts[start]>=0&&(word.length>=2||word==='a'||word==='i')&&common.has(word))parts[end]=Math.max(parts[end],parts[start]+1);
  }
  return parts[value.length]>=2;
 }
 function add(value){
  const term=value.replace(/([A-Za-z])-\s*\n\s*([a-z])/g,'$1$2').replace(/\s+/g,' ').replace(/^[\s"“”.,:;…]+|[\s"“”.,:;…]+$/g,'').trim();
  // Babelian letter mappings are A–Z; retain the display spelling while using
  // its accent-free form for segmentation (Areté -> arete, for example).
  const normalized=term.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[œŒ]/g,m=>m==='œ'?'oe':'OE').replace(/[æÆ]/g,m=>m==='æ'?'ae':'AE').replace(/[–—…,:]/g,' ');
  if(!/^[A-Za-z][A-Za-z ’'\-/&]*$/.test(normalized)||/^(?:if|when|respecting|you|they|gain|lose|roll|see|return|e\.g)\b/i.test(normalized)){skipped.add(term);return;}
  const parts=normalized.replace(/[’']/g,'').replace(/[\-/&]/g,' ').toLowerCase().trim().split(/\s+/);
  if(!parts.length||parts.length>10||!parts.some(w=>w.length>=3)||parts.some(w=>w.length>40)){skipped.add(term);return;}
  terms.add(term);
  for(const word of parts)if(word.length>=2)words.add(word);
  for(const match of normalized.matchAll(/\b([A-Za-z]+)['’]s\b/g))words.add(match[1].toLowerCase());
  if(parts.length>1&&parts.join('').length<=120)phrases.add(parts.join(' '));
 }
 for(const book of data.books)for(const entry of book.entries||[]){
  for(const field of ['title','text','encounter','section']){
   const value=typeof entry[field]==='string'?entry[field]:'';
   for(const m of value.matchAll(/[（(]([^（）()]{1,150})[）)]/g))if(/[A-Za-z]/.test(m[1]))add(m[1]);
  }
  if(typeof entry.englishTitle==='string')add(entry.englishTitle);
  // English runs in bilingual headings are also explicit names, not passages.
  for(const m of (entry.title||'').matchAll(/[A-Za-z][A-Za-z ’'\-]+/g))add(m[0]);
  const original=(entry.originalText||'').replace(/([A-Za-z])-\s*\n\s*([a-z])/g,'$1$2').replace(/\s+/g,' ');
  for(const m of original.matchAll(/\b[A-Z][a-z]{2,}(?:['’]s)?\b/g)){
   const word=m[0].replace(/['’]s$/,'').toLowerCase();
   if(!common.has(word)){
    const candidate=candidates.get(m[0])||{count:0,internal:false};candidate.count++;
    const prefix=original.slice(0,m.index).trimEnd();
    candidate.internal=candidate.internal||(prefix.length>0&&!/[.!?:;]$/.test(prefix));
    candidates.set(m[0],candidate);
   }
  }
 }
 // Supplement names absent from the bilingual glosses, including single-use
 // uncommon capitals inside sentences. A lone sentence-start capital is not
 // enough evidence. This is vocabulary extraction, not spelling correction.
 for(const [name,evidence]of candidates)if(evidence.count>=2||evidence.internal){
  // English OCR sometimes glues ordinary words (e.g. "Itcan") together.
  // An explicit bilingual name remains authoritative; inferred names alone
  // must not turn such runs into a preferred indivisible dictionary word.
  const word=name.toLowerCase().replace(/['’]s$/,'');
  if(!words.has(word)&&ordinaryJoinedWords(name)){skipped.add(name);continue;}
  add(name);
 }
 const sort=values=>[...values].sort((a,b)=>a.localeCompare(b,'en'));
 return {vocabulary:{schema:1,sourceSha256:crypto.createHash('sha256').update(raw).digest('hex'),books:data.books.map(b=>b.id),terms:sort(terms),words:sort(words),phrases:sort(phrases)},skipped:sort(skipped)};
}
if(require.main===module){
 const [input,output,report]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node scripts/extract-domain-terms.cjs INPUT.js OUTPUT.json [PRIVATE_REPORT.json]');
 const result=extract(fs.readFileSync(input,'utf8'));fs.writeFileSync(output,JSON.stringify(result.vocabulary,null,2)+'\n');
 if(report)fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({books:result.vocabulary.books,terms:result.vocabulary.terms.length,words:result.vocabulary.words.length,phrases:result.vocabulary.phrases.length,skipped:result.skipped.length}));
}
module.exports={extract};
