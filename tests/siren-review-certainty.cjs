/* Executes the production final-emission callback with synthetic fit metrics.
 * Tests the certainty boundary, not pixel accuracy; no game images or text. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/siren-recognition.js'),'utf8');
const begin=source.indexOf('   return chosen.map((p,i)=>{'),marker='   }).filter(Boolean);',end=source.indexOf(marker,begin);
assert(begin>=0&&end>begin,'Production final-emission callback must be located');
const callback=source.slice(begin,end+marker.length);
let cases=0;
function emit({weak=true,score=.90,support=.90,fraction=.50,margin=.30,initialMargin=.10,benefit=100}={}){
 const input={weakProposal:weak,margin:initialMargin,matchedLetter:'A'},before=JSON.stringify(input);
 // Deliberately stale high scores ensure the gate reads the final measured ink.
 const best={letter:'A',outside:false,benefit,score:.99,uniqueSupport:.99,uniqueFraction:.99};
 const rival={letter:'B',outside:false,benefit:benefit-margin*Math.max(1,benefit),score:.99};
 const scope={chosen:[input],rank:()=>[best,rival],letters:{A:{points:()=>[]},B:{points:()=>[]}},
  bitmap:{width:1,height:1},bm:new Float32Array(1),
  support:(_image,_points,candidate)=>candidate.letter==='A'?{score,uniqueSupport:support,uniqueFraction:fraction}:{score:.50,uniqueSupport:.50,uniqueFraction:.50}};
 vm.createContext(scope);vm.runInContext('function emitFinal(){'+callback+'}\nglobalThis.output=emitFinal();',scope);
 assert.equal(JSON.stringify(input),before,'Final emission must not rewrite the original proposal');
 cases++;return JSON.parse(JSON.stringify(scope.output));
}
function expectLetter(options,letter){const result=emit(options);assert.equal(result.length,1,'Supported review slot remains present');assert.equal(result[0].letter,letter);assert(result[0].candidates.length<=3);return result[0];}

// Newly admitted weak ink remains unresolved until the old strong independent
// support floor is restored by the final joint fit, even at high overall score.
for(const support of [.70,.71,.779999])expectLetter({support},null);
for(const support of [.78,.90,1])expectLetter({support},'A');
expectLetter({score:.78,support:.70},null);
expectLetter({score:.859999,support:.95},null);
expectLetter({score:.86,support:.78},'A');
expectLetter({margin:.079,support:.95},null);
expectLetter({margin:.08,support:.78},'A');
expectLetter({initialMargin:-.01,support:.95},null);

// Retention and automatic letter selection are separate decisions.
for(const options of [{score:.779999},{support:.699999},{fraction:.239999},{benefit:0}])assert.equal(emit(options).length,0,'Insufficient independent ink must not manufacture a slot');
expectLetter({fraction:.24,support:.78},'A');

// Strong proposals retain their existing final-score/margin behavior. The new
// weak-proposal promotion guard must not silently change legacy strong fits.
expectLetter({weak:false,support:.71},'A');
expectLetter({weak:false,score:.85},null);
expectLetter({weak:false,margin:.07},null);
expectLetter({weak:false,initialMargin:-.01},null);

console.log('PASS '+cases+' Siren final-emission cases: weak independent-support promotion floor, final measured metrics, score/margin gates, unresolved retention, insufficient-ink rejection and unchanged strong-proposal behavior.');
