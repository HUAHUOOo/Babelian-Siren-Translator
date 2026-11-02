/* Anonymous vector geometry only; no extracted font outlines. */
const assert=require('node:assert/strict'),fs=require('node:fs');
const V=require('../src/babelian-visuals.js');
const original={one:{width:24,height:48,src:'original-one.png'},two:{width:48,height:48,src:'original-two.png'}};
const outline={viewBox:[0,0,10,20],matrix:[1,0,0,1,0,0],d:'M0 0L10 0L5 20Z'};
const profile={version:1,glyphs:{one:outline,two:{...outline,viewBox:[0,0,20,20]}}},before=JSON.stringify(original);
const display=V.create(original,profile);assert(display.vectorReady);assert.equal(display.error,'');
assert.equal(JSON.stringify(original),before);assert.equal(display.assets.one.width,24);assert.equal(display.assets.one.height,48);assert(display.assets.one.src.startsWith('data:image/svg+xml;'));
const absent=V.create(original);assert(!absent.vectorReady);assert.equal(absent.assets.one,original.one);assert(!absent.canExport([[{glyph:'one'}]]));
for(const invalid of [{version:9,glyphs:profile.glyphs},{version:1,glyphs:{one:outline}},{version:1,glyphs:{one:{...outline,d:'M0 0" onload="alert(1)'},two:outline}},{version:1,glyphs:{one:{...outline,viewBox:[0,0,0,1]},two:outline}},{version:1,glyphs:{one:{...outline,matrix:[1,0,0,1,NaN,0]},two:outline}}]){
 const r=V.create(original,invalid);assert(!r.vectorReady);assert(r.error);assert.equal(r.assets.one,original.one);
}
function legacy(lines,text,measure){
 const width=1600,margin=78,right=width-margin,glyphHeight=64,placements=[];let x=margin,y=146;
 for(const line of lines){for(const token of line){const glyph=original[token.glyph],w=glyph.width/glyph.height*glyphHeight;if(x+w>right){x=margin;y+=86;}placements.push({letter:token.glyph,x,y,width:w});x+=w+5;}x=margin;y+=86;}
 const separatorY=y+17,englishRows=[];
 for(const line of text.split('\n')){let row='';for(const letter of line.replace(/\t/g,'    ')){if(row&&measure(row+letter)>width-2*margin){englishRows.push(row);row='';}row+=letter;}englishRows.push(row);}
 const englishY=separatorY+86,height=englishY+englishRows.length*42+68;
 return {width,height,margin,right,glyphHeight,placements,separatorY,englishY,englishRows};
}
for(let n=0;n<40;n++){
 const lines=Array.from({length:n%5+1},(_,row)=>Array.from({length:n*2+row},(_,i)=>({glyph:i%2?'one':'two'}))),text=('Abc & <> 123\t'.repeat(n)+'\n').repeat(n%3+1),measure=s=>s.length*16.2;
 assert.deepEqual(display.layout(lines,text,measure),legacy(lines,text,measure));
}
const lines=[[{glyph:'one'},{glyph:'two'},{glyph:'one'}]],page=display.layout(lines,'  abc & <script> "中文"\n123',s=>s.length*16),svg=display.toSVG(page);
assert.equal((svg.match(/<symbol /g)||[]).length,2);assert.equal((svg.match(/<use /g)||[]).length,3);assert(svg.includes('&amp; &lt;script&gt; &quot;中文&quot;'));assert(svg.includes('xml:space="preserve"'));
assert(!/<image\b|<script\b|foreignObject|data:image\/png|base64|@font-face|<style\b/.test(svg));assert(!absent.canExport(lines));assert.throws(()=>absent.toSVG(page),/矢量/);
assert.throws(()=>display.toSVG({...page,placements:[{letter:'one',x:'0" onload="bad',y:0,width:2}]}),/版式/);
assert.throws(()=>display.toSVG({...page,englishRows:['a\u0001b']}),/控制字符/);assert.throws(()=>display.toSVG({...page,englishRows:['\ud800']}),/控制字符/);
assert.throws(()=>display.layout([[{glyph:'missing'}]],'',s=>s.length),/未知/);assert.throws(()=>display.layout(Array.from({length:400},()=>[]),'',s=>s.length),/分段/);
assert.equal(JSON.stringify(original),before);
const ui=fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8');assert(ui.includes('img.src=glyphs[id].src'),'Recognition masks must still load the original raster source.');assert(ui.includes('img.src=displayGlyphs[id].src'));
console.log('PASS vector visuals: display/raster separation, original frames and assets unchanged, fallback/validation, 40 legacy PNG layout comparisons, paths-only SVG/dedup/escaped text/limits, original OCR raster source.');
