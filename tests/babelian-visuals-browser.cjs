const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),native=require('../src/glyphs.json');
const qa=path.join(__dirname,'qa/vector-visuals');fs.mkdirSync(qa,{recursive:true});
const specials={and:'AND',the:'THE',a_word:'A',OF:'OF',OR:'OR','!/?':'!/?'},workingMap=Object.fromEntries(Object.keys(native).map(id=>[id,specials[id]??id]));workingMap.B='HELLO & <世界>';
(async()=>{
 const browser=await chromium.launch({headless:true,downloadsPath:qa,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true}),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(map=>{
   if(localStorage.getItem('vector-test-seeded'))return;
   localStorage.setItem('ato-babelian-mapping-profiles-v2',JSON.stringify({version:2,workingMap:map,baselineMap:map,baseName:'自定义测试',profileSlots:Array(5).fill(null),chosenSlot:0}));
   localStorage.setItem('ato-babelian-writer-v1',JSON.stringify({text:'Abc 123\n',keyboardCase:'upper',specialSpans:[]}));localStorage.setItem('vector-test-seeded','1');
  },workingMap);
  await page.goto(pathToFileURL(process.env.BABELIAN_APP_FILE||path.resolve(__dirname,'../index.html')).href);await page.waitForFunction(()=>Boolean(BABELIAN_APP.navigation));await page.locator('#language-open-babelian').click();
  const vector=await page.evaluate(()=>BABELIAN_APP.visuals.vectorReady);
  const assets=await page.evaluate(async()=>{
   const {glyphs,displayGlyphs}=BABELIAN_APP.assets;const checks=[];
   for(const [id,a]of Object.entries(displayGlyphs)){
    const img=new Image();img.src=a.src;await img.decode();const cv=document.createElement('canvas');cv.width=Math.round(256*a.width/a.height);cv.height=256;const ctx=cv.getContext('2d');ctx.drawImage(img,0,0,cv.width,cv.height);const d=ctx.getImageData(0,0,cv.width,cv.height).data;
    let ink=0;for(let i=3;i<d.length;i+=4)if(d[i]>128)ink++;
    checks.push({id,vector:a.src.startsWith('data:image/svg+xml'),ink,frame:a.width===glyphs[id].width&&a.height===glyphs[id].height,raster:glyphs[id].src.startsWith('data:image/png;base64,')});
   }return checks;
  });assert.equal(assets.length,58);assert(assets.every(a=>a.frame&&a.raster&&a.ink>0&&a.vector===vector));
  assert.equal(await page.locator('#download-svg').isVisible(),vector);assert.equal(await page.locator('#english-input').inputValue(),'Abc 123\n');
  const glyphs=()=>page.locator('.cipher-glyph').evaluateAll(ns=>ns.map(n=>n.dataset.glyph));assert.deepEqual(await glyphs(),['A','b','c']);
  await page.locator('#special-keys button[data-glyph="B"]').click();await page.locator('#special-keys button[data-glyph="and"]').click();assert.deepEqual(await glyphs(),['A','b','c','B','and']);
  const raw=await page.locator('#english-input').inputValue();assert(raw.includes('123'));assert(raw.includes('HELLO & <世界>AND'));
  const mapping=await page.evaluate(()=>localStorage.getItem('ato-babelian-mapping-profiles-v2'));
  const event=page.waitForEvent('download');await page.locator('#download').click();const download=await event;assert(download.suggestedFilename().endsWith('.png'));const png=path.join(qa,'export-'+width+'-'+(vector?'vector':'raster')+'.png');await download.saveAs(png);assert.equal(await download.failure(),null);assert.equal(fs.readFileSync(png).subarray(1,4).toString(),'PNG');
  if(vector){
   const event=page.waitForEvent('download');await page.locator('#download-svg').click();const download=await event;assert(download.suggestedFilename().endsWith('.svg'));const file=path.join(qa,'export-'+width+'.svg');await download.saveAs(file);assert.equal(await download.failure(),null);
   const svg=fs.readFileSync(file,'utf8');const check=await page.evaluate(svg=>{const d=new DOMParser().parseFromString(svg,'image/svg+xml');return {errors:d.querySelectorAll('parsererror').length,images:d.querySelectorAll('image').length,scripts:d.querySelectorAll('script').length,paths:d.querySelectorAll('defs path').length,uses:d.querySelectorAll('use').length,text:d.documentElement.textContent};},svg);
   assert.equal(check.errors,0);assert.equal(check.images,0);assert.equal(check.scripts,0);assert.equal(check.paths,5);assert.equal(check.uses,5);assert(check.text.includes('HELLO & <世界>AND'));assert(check.text.includes('123'));
   assert(!svg.includes('base64'));assert(!svg.includes('<image'));fs.writeFileSync(path.join(qa,'asset-checks-'+width+'.json'),JSON.stringify(assets,null,2));
  }
  assert.equal(await page.evaluate(()=>localStorage.getItem('ato-babelian-mapping-profiles-v2')),mapping);
  await page.screenshot({path:path.join(qa,'writer-'+width+'-'+(vector?'vector':'raster')+'.png'),fullPage:true});
  await page.locator('#language-back').click();await page.locator('#language-open-babelian-translate').click();assert(!(await page.locator('#download-svg').isVisible()));assert(!(await page.locator('#download').isVisible()));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.close();
  console.log('PASS '+(vector?'vector':'raster fallback')+' visuals '+width+'px: 58 nonempty frames, original OCR assets, saved/custom readings, ligature/digits, real PNG'+(vector?'/paths-only SVG':'')+' downloads, unchanged mapping, no translation export controls/network/errors/overflow.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
