/* Generic examples only: no private story transcript or correction fixture. */
const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const F=require('../src/text-format.js'),words=zlib.gunzipSync(fs.readFileSync(require.resolve('../src/english-words.txt.gz'))).toString().trim().split(/\s+/).filter(w=>/^[a-z]{2,32}$/.test(w)||w==='a'||w==='i').join(' '),formatter=F.create(words);
const plain=text=>({text,spans:[]}),letters=text=>({text,spans:Array.from(text,(text,i)=>({glyph:'opaque-'+i,start:i,end:i+1,text}))});
const samples=[['wesatnearthepond','we sat near the pond'],['theparcelisforme','the parcel is for me'],['theywanttogohome','they want to go home'],['Togo','Togo'],['Wes','Wes'],['Itis','It is']];
for(const [input,expected] of samples)for(const source of [plain(input),letters(input)]){
 const before=JSON.stringify(source),out=formatter.suggest(source,{punctuate:false});assert.equal(out.text,expected);assert.equal(JSON.stringify(source),before);assert.equal(F.reflow(source,out.text).text,out.text);assert.deepEqual(out.spans.map(x=>x.glyph),source.spans.map(x=>x.glyph));
}
const payload=letters('hehelda/anredbox');payload.spans.splice(6,4,{glyph:'article-opaque',start:6,end:10,text:'a/an'});
const output=formatter.suggest(payload,{punctuate:false});assert.equal(output.text,'he held a/an red box');assert.equal(output.spans.find(s=>s.glyph==='article-opaque').text,'a/an');
// A slash in ordinary source is not automatically interpreted as a ligature.
const slash=formatter.suggest(plain('a/b'),{punctuate:false});assert.equal(slash.text,'a/b');
const unknown=letters('we[?]sat123!/?');const marked=formatter.suggest(unknown);assert(marked.text.includes('[?]'));assert(marked.text.includes('123'));assert(marked.text.includes('!/?'));assert.equal(F.reflow(unknown,marked.text).text,marked.text);
assert.equal(formatter.suggest(plain('Wes met Togo'),{punctuate:false}).text,'Wes met Togo');
console.log('PASS generic feedback patterns: word-valued slash mapping boundaries, weak grammatical spacing, separately written names, unchanged IDs/letters/numbers/unknowns/source punctuation.');
