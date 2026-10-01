const assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
const {extract}=require('../scripts/extract-domain-terms.cjs'),{create}=require('../src/text-format.js'),terms=require('../src/domain-terms.json');
const source='window.STORYBOOK_DATA='+JSON.stringify({books:[{id:'test',entries:[
 {title:'虚构地点（Test Harbour）',text:'角色（Kroisos）。标记（A1）。普通说明（You may draw a card）。',originalText:'Acacallis arrives. Acacallis leaves. We meet Zyxtheos. Itcan happen. Itcan return.'},
 {englishTitle:"Hermes’ Gift",text:'关键词（Areté）与（Aeon Trespass: Odyssey）。级别（2）。'}
]}]})+';';
const result=extract(source).vocabulary;
assert.deepEqual(result.books,['test']);
for(const word of ['test','harbour','kroisos','hermes','gift','acacallis','zyxtheos','arete','odyssey'])assert(result.words.includes(word));
assert(result.phrases.includes('test harbour'));assert(!result.words.includes('a1'));assert(!result.words.includes('you'));assert(!result.words.includes('arrives'));
assert(!result.words.includes('itcan'));
assert.throws(()=>extract(source+'globalThis.evil=true;'),SyntaxError);
assert.equal(globalThis.evil,undefined);
assert.deepEqual(terms.books,['c1','c1.5','c2','c2.5','c3','c4','c5']);
for(const word of ['kroisos','symmachy','balaneion','knossos','trismegistus'])assert(terms.words.includes(word));
assert(terms.words.every(w=>/^[a-z]{2,40}$/.test(w)));
const formatter=create(zlib.gunzipSync(fs.readFileSync(require.resolve('../src/english-words.txt.gz'))).toString());
for(const [input,expected] of [
 ['KroisosstandsnearKnossos','Kroisos stands near Knossos'],
 ['theBalaneionandSymmachy','the Balaneion and Symmachy'],
 ['IntheNarrowHell','In the Narrow Hell']
])assert.equal(formatter.suggest({text:input,spans:[]},{punctuate:false}).text,expected);
assert.equal(formatter.suggest({text:'Here stands the tower of Hades may he rest forever',spans:[]}).text,'Here stands the tower of Hades.\nmay he rest forever.');
assert.equal(formatter.suggest({text:'Here stands the tower where you may draw a card',spans:[]}).text,'Here stands the tower where you may draw a card.');
assert.equal(formatter.suggest({text:'mayherotinthepit',spans:[]},{punctuate:false}).text,'may he rot in the pit');
const text='Kroisosmayherest',spans=Array.from(text,(c,i)=>({glyph:'id-'+i,start:i,end:i+1,text:c}));
const formatted=formatter.suggest({text,spans});
assert.equal(formatted.text.replace(/[\s.,]/g,''),text);assert.deepEqual(formatted.spans.map(s=>s.glyph),spans.map(s=>s.glyph));
console.log('PASS imported terminology: safe JSON extraction, all seven books, names/multiword terms, marker/instruction exclusion, case/spans and optative punctuation.');
