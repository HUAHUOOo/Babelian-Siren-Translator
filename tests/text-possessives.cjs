const fs=require('node:fs'),zlib=require('node:zlib'),assert=require('node:assert/strict'),{create,reflow}=require('../src/text-format.js');
const formatter=create(zlib.gunzipSync(fs.readFileSync(require.resolve('../src/english-words.txt.gz'))).toString());
const perLetter=text=>({text,spans:Array.from(text,(text,start)=>({glyph:'opaque-'+start,text,start,end:start+1})).filter(s=>/[A-Za-z]/.test(s.text))});
for(const [input,expected] of [
 ['Poseidonsalitheia','Poseidons alitheia'],
 ['Poseidonsaletheia','Poseidons aletheia'],
 ['Seleneproceedingfromtheconjunction','Selene proceeding from the conjunction']
])assert.equal(formatter.suggest(perLetter(input),{punctuate:false}).text,expected);
for(const [input,expected] of [
 ['Poseidonscursehasbeenbroken','Poseidon\'s curse has been broken.'],
 ['POSEIDONScursehasbeenbroken','POSEIDON\'S curse has been broken.'],
 ["Poseidon'scursehasbeenbroken","Poseidon's curse has been broken."],
 ["thedragon'ssoulisgone","the dragon's soul is gone."],
 ['thegodsandsoulsremain','the gods and souls remain.']
]){
 const payload=perLetter(input),frozen=JSON.stringify(payload),output=formatter.suggest(payload);
 assert.equal(output.text,expected);assert.equal(JSON.stringify(payload),frozen);
 assert.deepEqual(output.spans.map(s=>s.glyph),payload.spans.map(s=>s.glyph));
 output.spans.forEach((s,i)=>{assert.equal(s.text,payload.spans[i].text);assert.equal(output.text.slice(s.start,s.end),s.text);});
 assert.equal(reflow(payload,output.text).text,output.text);
}
const unknown=formatter.suggest(perLetter('Poseidons[?]9301[未映射]alitheia'));
assert(unknown.text.includes("Poseidon's"));assert(unknown.text.includes('[?] 9301 [未映射]'));
assert(!formatter.suggest(perLetter('Poseldonsalitheia')).text.includes("Poseidon's"),'No spelling repair or letter substitution');
assert.equal(formatter.suggest(perLetter('Poseidonscurse'),{punctuate:false}).text,'Poseidons curse');
console.log('PASS proper-name possessive punctuation, existing apostrophes, plural preservation, distinct alitheia/aletheia, cross-line word support, unchanged letters/case/digits/placeholders and opaque span identity.');
