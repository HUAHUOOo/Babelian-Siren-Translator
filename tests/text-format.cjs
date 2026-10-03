const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),vm=require('node:vm');
const {create,reflow,createDraft}=require('../src/text-format.js');
const data=zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'../src/english-words.txt.gz'))).toString();
const formatter=create(data.trim().split(/\s+/).filter(w=>/^[a-z]{2,32}$/.test(w)||w==='a'||w==='i').join(' '));
const plain=text=>({text,spans:[]});
function perLetter(text){return {text,spans:Array.from(text,(ch,i)=>({glyph:'g'+i,start:i,end:i+1,text:ch})).filter(s=>/[A-Za-z]/.test(s.text))};}
function validSpans(old,next){
 assert.deepEqual(next.spans.map(s=>s.glyph),old.spans.map(s=>s.glyph));
 next.spans.forEach((span,i)=>{
  assert.equal(span.text,next.text.slice(span.start,span.end));assert.equal(span.text.replace(/[\s.,;:!?]/g,''),old.spans[i].text.replace(/[\s.,;:!?]/g,''));
  if(i)assert(next.spans[i-1].end<=span.start);
 });
}
const samples=[
 ['thequickbrownfoxjumpsoverthelazydog','the quick brown fox jumps over the lazy dog'],
 ['THISISTHEPOWEROFDIONYSIANALCHEMY','THIS IS THE POWER OF DIONYSIAN ALCHEMY'],
 ['WITHtheCURSEBROKENAfinalREWARDAWAITS','WITH the CURSE BROKEN A final REWARD AWAITS'],
 ['eleventhousandfivehundredninetynineminusseventhousandsixhundredeightyplussixteen','eleven thousand five hundred ninety nine minus seven thousand six hundred eighty plus sixteen'],
 ['ThnitosKhrusosisamineral','Thnitos Khrusos is a mineral'],
 ['seeparagraph9301','see paragraph 9301'],
 ['theDra\ngonfalls','the Dragon falls']
];
for(const [text,expected] of samples){const source=perLetter(text),frozen=JSON.stringify(source),result=formatter.suggest(source,{punctuate:false});assert.equal(result.text,expected);validSpans(source,result);assert.equal(JSON.stringify(source),frozen);}
const story=perLetter('TheDragoncoilsintheDarkBelowIfyouwantproceedtoaBattleIfyouloseproceedtoanormalDefeatIfyouwinseeparagraphninethreezeroone');
const punctuated=formatter.suggest(story);
assert(punctuated.text.includes('Below.\nIf you want, proceed'));assert(punctuated.text.includes('If you win, see paragraph nine three zero one.'));assert(punctuated.punctuationCount>=4);validSpans(story,punctuated);
assert.equal(formatter.suggest(plain('Ifyouwinseeparagraph9301')).text,'If you win, see paragraph 9301.');
// Synthetic adjacent statements/questions exercise sentence suggestions without
// including any user screenshot transcription or story passage in public tests.
function wordGlyphs(words){
 const spans=[];let text='';
 for(const word of words.split(' ')){const start=text.length;text+=word;spans.push({glyph:'word-'+spans.length,start,end:text.length,text:word});}
 return {text,spans};
}
const sentenceCases=[
 ['A key is rusting and what is the key that is rusting The lock is rusting Bolts are rusting','A key is rusting and what is the key that is rusting?\nThe lock is rusting.\nBolts are rusting.'],
 ['The lamp is glowing Reflections are glowing The window is glowing','The lamp is glowing.\nReflections are glowing.\nThe window is glowing.'],
 ['What is the key that is missing The door is locked','What is the key that is missing?\nThe door is locked.'],
 ['the gate is closed all doors are closed','the gate is closed.\nall doors are closed.'],
 ['WHY IS THE GATE CLOSED','WHY IS THE GATE CLOSED?']
];
for(const [words,expected] of sentenceCases)for(const payload of [perLetter(words.replace(/ /g,'')),wordGlyphs(words)]){
 const frozen=JSON.stringify(payload),output=formatter.suggest(payload);
 assert.equal(output.text,expected);assert.equal(output.unknown.length,0);validSpans(payload,output);
 assert.equal(JSON.stringify(payload),frozen);assert.equal(reflow(payload,output.text).text,output.text);
 const unpunctuated=formatter.suggest(payload,{punctuate:false});
 assert.equal(unpunctuated.text,words);assert.equal(unpunctuated.punctuationCount,0);validSpans(payload,unpunctuated);
}
for(const words of [
 'The gate is closed and the hall is closed',
 'The gate is closed because the hall is closed',
 'The gate is closed whereas the hall is open',
 'The lamp is glowing also whatever is felt as cold or warm that comes with the light for its required condition that too is glowing',
 'I know what is cold and what is warm',
 'It is clear the gate is open',
 'It is expected the gate is closed',
 'The room is painted white the gate is blue'
])assert.equal(formatter.suggest(perLetter(words.replace(/ /g,''))).text,words+'.');
assert.equal(formatter.suggest(perLetter('Thelampisglo\nwing')).text,'The lamp is glowing.');
assert.equal(formatter.suggest(perLetter('Thelampisglo\nwing\nReflectionsareglowing')).text,'The lamp is glowing.\nReflections are glowing.');
const existingQuestion=formatter.suggest(perLetter('Whatisthekeythatismissing?Thedoorislocked.'));
assert.equal(existingQuestion.text,'What is the key that is missing? The door is locked.');assert.equal(existingQuestion.punctuationCount,0);
const ambiguousMark=perLetter('Whatisthekeythatismissing!/?thedoorislockedboltsarerusting'),ambiguousOutput=formatter.suggest(ambiguousMark);
assert.equal(ambiguousOutput.text,'What is the key that is missing!/? the door is locked.\nbolts are rusting.');validSpans(ambiguousMark,ambiguousOutput);
assert.equal(formatter.suggest(ambiguousMark,{punctuate:false}).text,'What is the key that is missing!/? the door is locked bolts are rusting');
const mixedCaseWords=wordGlyphs('THE lamp is glowing AND what is the lamp that is glowing THE lock is glowing lights are glowing');
const mixedCaseOutput=formatter.suggest(mixedCaseWords);
assert.equal(mixedCaseOutput.text,'THE lamp is glowing AND what is the lamp that is glowing?\nTHE lock is glowing.\nlights are glowing.');validSpans(mixedCaseWords,mixedCaseOutput);
assert.equal(formatter.suggest(perLetter('Thelampisglowing[?]Thewindowisglowing')).text,'The lamp is glowing [?] The window is glowing.');
console.log('PASS synthetic sentence suggestions: direct questions, adjacent/repeated copular statements, lowercase/uppercase and word-valued spans; coordinated/relative/complement clauses, source punctuation and image line wraps preserved.');
const listCases=[
 ['Traveling with a map with a lamp with a compass I say we are ready','Traveling with a map, with a lamp, with a compass.\nI say we are ready.'],
 ['The lamp is glowing with red light with green light with blue light','The lamp is glowing with red light, with green light, with blue light.'],
 ['Traveling with THE map OF stars with THE map OF hills with THE map OF rivers We declare it is safe','Traveling with THE map OF stars, with THE map OF hills, with THE map OF rivers.\nWe declare it is safe.'],
 ['Traveling with what!/? Traveling with a map with a lamp with a compass','Traveling with what!/? Traveling with a map, with a lamp, with a compass.']
];
for(const [words,expected] of listCases)for(const payload of [perLetter(words.replace(/ /g,'')),wordGlyphs(words)]){
 const frozen=JSON.stringify(payload),output=formatter.suggest(payload);
 assert.equal(output.text,expected);validSpans(payload,output);assert.equal(JSON.stringify(payload),frozen);
 assert.equal(formatter.suggest(payload,{punctuate:false}).text,words);
}
for(const words of [
 'Traveling with a map with a compass',
 'The box with a lid with a handle with a stripe is open',
 'Traveling with a map that is old with a lamp with a compass',
 'Traveling with a map without a guide with a lamp with a compass',
 'Traveling with a map [?] with a lamp with a compass',
 'Traveling with a map, with a lamp, with a compass',
 'The words I say are glowing with a lamp',
 'Traveling with a map with a lamp with a compass that we carry I say it is safe'
])assert.equal(formatter.suggest(wordGlyphs(words)).text,words+'.');
console.log('PASS synthetic repeated-preposition lists: short participial complements, independent reporting clause, word glyph case and source marks; two-item/nested/relative/unknown/already-punctuated phrases preserved.');
const frontedCases=[
 ['When he finds the key the door is open','When he finds the key, the door is open.'],
 ['When closed there is silence','When closed, there is silence.'],
 ['The lamp is glowing With the key the gate is open','The lamp is glowing.\nWith the key, the gate is open.'],
 ['He realizes The gate is open','He realizes: The gate is open.'],
 ['The gate is closed THE lamp has been repaired','The gate is closed.\nTHE lamp has been repaired.'],
 ['The work has been carried out what can be repaired is ready','The work has been carried out.\nwhat can be repaired is ready.'],
 ['The work is done OF this there is no doubt','The work is done.\nOF this, there is no doubt.'],
 ['When he is ready there is light He understands The gate is open','When he is ready, there is light.\nHe understands: The gate is open.']
];
for(const [words,expected]of frontedCases)for(const payload of [perLetter(words.replace(/ /g,'')),wordGlyphs(words)]){
 const frozen=JSON.stringify(payload),output=formatter.suggest(payload);
 assert.equal(output.text,expected);validSpans(payload,output);assert.equal(JSON.stringify(payload),frozen);
 assert.equal(formatter.suggest(payload,{punctuate:false}).text,words);
}
for(const words of [
 'I know what can be done',
 'The light that fades out with the sunset is dim',
 'He understands that The door is locked',
 'When [?] there is light',
 'When he is ready',
 'The gate is closed while the lamp is glowing',
 'The gate is closed for what he has placed inside',
 'The gate is closed and he has repaired the lamp',
 'The light is glowing with the fading of the sunset'
])assert.equal(formatter.suggest(wordGlyphs(words)).text,words+'.');
assert.equal(formatter.suggest(wordGlyphs('What can be repaired')).text,'What can be repaired?');
console.log('PASS synthetic fronted clauses and statements: temporal/prepositional comma, reporting colon, perfect passive and free-relative subject; complements, relatives, questions, source case/unknown markers and spans preserved.');
const sharedPredicateCases=[
 ['She finds comfort in the garden finds comfort in the library finds comfort in the hall','She finds comfort in the garden, finds comfort in the library, finds comfort in the hall.'],
 ['He sees light in the window sees light in the mirror sees light in the water','He sees light in the window, sees light in the mirror, sees light in the water.'],
 ['I feel joy in spring feel joy in summer feel joy in winter','I feel joy in spring, feel joy in summer, feel joy in winter.'],
 ['She finds comfort in the garden finds comfort in the library finds comfort in the hall AND whatever is felt as cold or warm that comes from the air for its required condition in that too she finds comfort','She finds comfort in the garden, finds comfort in the library, finds comfort in the hall.\nAND whatever is felt as cold or warm that comes from the air for its required condition, in that too she finds comfort.'],
 ['Whatever is felt as cold or warm in that too he finds comfort','Whatever is felt as cold or warm, in that too he finds comfort.'],
 ['AND whatever is felt as cold or warm in that he finds comfort','AND whatever is felt as cold or warm, in that he finds comfort.']
];
for(const [words,expected]of sharedPredicateCases)for(const payload of [perLetter(words.replace(/ /g,'')),wordGlyphs(words)]){
 const frozen=JSON.stringify(payload),output=formatter.suggest(payload);
 assert.equal(output.text,expected);assert.equal(output.unknown.length,0);validSpans(payload,output);assert.equal(JSON.stringify(payload),frozen);
 assert.equal(formatter.suggest(payload,{punctuate:false}).text,words);
}
for(const words of [
 'She finds comfort in the garden finds comfort in the library',
 'She finds comfort in the garden finds joy in the library finds peace in the hall',
 'She finds comfort in the garden and she finds comfort in the library and she finds comfort in the hall',
 'I know she finds comfort in the garden finds comfort in the library finds comfort in the hall',
 'She finds comfort in the garden that is open finds comfort in the library finds comfort in the hall',
 'She finds comfort in the garden [?] finds comfort in the library finds comfort in the hall',
 'She finds [?] comfort in the garden finds comfort in the library finds comfort in the hall',
 'She finds comfort in the garden finds [?] comfort in the library finds comfort in the hall',
 'She finds comfort in the garden, finds comfort in the library, finds comfort in the hall',
 'Whatever is felt as cold or warm, in that too he finds comfort',
 'The light that is felt as cold in that room is fading'
])assert.equal(formatter.suggest(wordGlyphs(words)).text,words+'.');
const wrappedList=wordGlyphs('She finds comfort in the garden finds comfort in the library finds comfort in the hall');
const atWrap=wrappedList.spans[5].start;
const physicalWrap={text:wrappedList.text.slice(0,atWrap)+'\n'+wrappedList.text.slice(atWrap),spans:wrappedList.spans.map(s=>s.start>=atWrap?{...s,start:s.start+1,end:s.end+1}:s)};
assert.equal(formatter.suggest(physicalWrap).text,sharedPredicateCases[0][1]);validSpans(physicalWrap,formatter.suggest(physicalWrap));
console.log('PASS synthetic shared-subject predicate lists and resumed free relatives: repeated short headers, commas, complete clause boundary and resumption kept intact; two-item/different-object/nested/marked/existing-punctuation phrases and source spans preserved.');
const a=formatter.suggest(plain('the[?]dragon[未映射]falls'));assert(a.text.includes('[?]'));assert(a.text.includes('[未映射]'));
assert.equal(formatter.suggest(plain('abcXYZ123')).text.replace(/[\s.,]/g,''),'abcXYZ123');
assert.equal(formatter.suggest(plain('')).text,'');
const term=formatter.suggest(plain('theZyxarlthfalls'),{punctuate:false,extraWords:['Zyxarlth']});assert.equal(term.text,'the Zyxarlth falls');
const antinomy=perLetter('theantinomyremains'),antinomyResult=formatter.suggest(antinomy,{punctuate:false});
assert.equal(antinomyResult.text,'the antinomy remains');validSpans(antinomy,antinomyResult);
// Word-mapped glyphs stay intact even if a user adds internal whitespace.
const word={text:'WITHtheCURSE',spans:[{glyph:'word',start:0,end:4,text:'WITH'},{glyph:'the',start:4,end:7,text:'the'},{glyph:'last',start:7,end:12,text:'CURSE'}]};
const output=reflow(word,'WITH the CURSE.');assert.equal(output.spans.length,3);assert.equal(output.spans[1].text,'the');assert.equal(output.spans[2].end,14);
const ligature=perLetter('THENarrowGate');
ligature.spans=[{glyph:'word-glyph',start:0,end:3,text:'THE'},...ligature.spans.slice(3)];
const ligatureOutput=formatter.suggest(ligature,{punctuate:false});
assert.equal(ligatureOutput.text,'THE Narrow Gate');validSpans(ligature,ligatureOutput);
const acrossLine={text:'THE\nNarrowGate',spans:ligature.spans.map((s,i)=>i?{...s,start:s.start+1,end:s.end+1}:s)};
assert.equal(formatter.suggest(acrossLine,{punctuate:false}).text,'THE Narrow Gate');
// Written letters spelling THEN are not a THE word glyph and stay THEN.
assert.equal(formatter.suggest(perLetter('THENstop'),{punctuate:false}).text,'THEN stop');
assert.equal(reflow({text:'CUSTOMWORD',spans:[{glyph:'single',start:0,end:10,text:'CUSTOMWORD'}]},'CUSTOM WORD.').spans[0].text,'CUSTOM WORD');
const symbols=plain('a[?]B[未映射]9301!/?');assert.equal(reflow(symbols,'a [?] B [未映射] 9301 !/?').text,'a [?] B [未映射] 9301 !/?');
for(const bad of ['the dragon','the[!]dragon','the[ ? ]dragon','the[?]Dragon'])assert.throws(()=>reflow(plain('the[?]dragon'),bad));
assert.throws(()=>reflow(plain('9301'),'3935'));assert.throws(()=>reflow(plain('Hello!'),'Hello.'));assert.throws(()=>reflow(plain('ABC'),'XYZ'));
// A semantic-false but letter-valid suggestion must never flow back into OCR.
const unknown=formatter.suggest(plain('xxqz'),{punctuate:false});assert.equal(unknown.text.replace(/\s/g,''),'xxqz');
console.log('PASS formatting: ranked-word segmentation; case/digits/placeholders/source punctuation preserved; ATO terms; cross-line words; suggestion punctuation; span identity/order.');

const draft=createDraft(formatter),p=perLetter('theDragonfalls'),opt={punctuate:false,extraWords:[]};
draft.update(p,opt);draft.edit('the Dragon falls!');assert.equal(draft.payload().text,'the Dragon falls!');
assert(draft.update(p,opt).dirty);assert.equal(draft.state().value,'the Dragon falls!');
const p2=perLetter('theDragoncoils');assert(draft.update(p2,opt).stale);assert.equal(draft.state().value,'the Dragon falls!');assert.throws(()=>draft.payload(),/已变化/);
assert(!draft.update(p,opt).stale);assert.equal(draft.payload().text,'the Dragon falls!');
draft.update(p2,opt);draft.generate(p2,opt);assert.equal(draft.payload().text,'the Dragon coils');
draft.edit('the Dragon wins');assert(draft.state().error);assert.throws(()=>draft.payload());draft.clear();assert.equal(draft.state(),null);
draft.update(p,opt);draft.update(p2,opt);assert.equal(draft.payload().text,'the Dragon coils');
draft.edit('the Dragon coils.');assert(draft.update(p2,{...opt,punctuate:true}).stale);
console.log('PASS formatting drafts: unchanged refresh preserves edits; new mapping/recognition/settings cannot overwrite edited text; stale export blocked; explicit regeneration; clear.');

const start=Date.now(),long=formatter.suggest(plain('thequickbrownfoxjumpsoverthelazydog'.repeat(150)),{punctuate:false});
assert.equal(long.text.replace(/\s/g,''),'thequickbrownfoxjumpsoverthelazydog'.repeat(150));assert(Date.now()-start<10000);
assert.throws(()=>formatter.suggest(plain('x'.repeat(80001))),/过长/);
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
assert(html.includes('Copyright (c) 2017 Derek Anderson'));assert(html.includes('wordninja'));assert(!html.includes('__ENGLISH_WORD_DATA__'));
const source=fs.readFileSync(path.join(__dirname,'../src/text-format.js'),'utf8');assert(!/\b(fetch|XMLHttpRequest|localStorage)\b/.test(source));
console.log('PASS formatting build: offline dictionary and license embedded; bounded long input; no remote calls.');
