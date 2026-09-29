/* UI contract test with deterministic worker output (not an OCR accuracy test).
 * Exercises pending, candidate-only, missing, confirmed and current-map states. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
  await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(()=>{
   window.Worker=class{postMessage(){setTimeout(()=>{
    const entries=[['h',false,[{id:'h',score:.6},{id:'f',score:.5}]],[null,false,[{id:'the',score:.5}]],[null,false,[]],['r',true,[{id:'r',score:.95}]]];
    const result={width:260,height:80,polarity:'dark',threshold:150,lines:[{box:{x:10,y:10,width:220,height:50},tokens:entries.map(([id,certain,candidates],i)=>({box:{x:10+i*60,y:10,width:40,height:50},id,certain,candidates,manual:false,score:candidates[0]?.score||0}))}]};
    window.__testOCR=result;this.onmessage?.({data:{result}});
   },10);}terminate(){}};
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.locator('#language-open-babelian-translate').click();
  // Use the page's real paste handler with an in-memory test PNG.
  await page.evaluate(()=>{const cv=document.createElement('canvas');cv.width=260;cv.height=80;const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,260,80);c.fillStyle='#222';for(let i=0;i<4;i++)c.fillRect(10+i*60,10,20,50);const bytes=Uint8Array.from(atob(cv.toDataURL().split(',')[1]),ch=>ch.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'review.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);await page.locator('#ocr-run').click();await page.locator('#ocr-results').waitFor();
  const list=page.locator('#ocr-token-details'),editor=page.locator('#ocr-review'),raw=()=>page.locator('#ocr-output').inputValue();
  assert(!(await list.evaluate(n=>n.open)));assert(!(await editor.isVisible()));assert.equal(await raw(),'hTHE[?]r');
  assert.equal(await page.locator('.ocr-token.uncertain').count(),3);assert.equal(await page.evaluate(()=>__testOCR.lines[0].tokens[0].manual),false);
  assert((await page.locator('#ocr-results').boundingBox()).y<150,'Recognition should bring the English result into view');
  assert(await page.locator('#ocr-output-note').textContent().then(t=>t.includes('3 项尚待确认')&&t.includes('1 项无候选')));
  await page.locator('#ocr-punctuate').uncheck();await page.locator('#ocr-formatted').fill('h THE [?] r!');
  // Selecting an original screenshot box opens both list and editor.
  await page.locator('#ocr-preview').scrollIntoViewIfNeeded();let b=await page.locator('#ocr-preview').boundingBox();
  await page.locator('#ocr-preview').click({position:{x:b.width*30/260,y:b.height*30/80}});
  assert(await list.evaluate(n=>n.open));assert(await editor.isVisible());assert.equal(await page.locator('#ocr-choice').inputValue(),'h');
  await page.locator('#ocr-candidates button').nth(1).click();assert(await editor.isVisible());assert.equal(await raw(),'hTHE[?]r','Preview is not confirmation');
  await page.locator('#ocr-choice').selectOption('h');await page.locator('#ocr-confirm').click();assert(!(await editor.isVisible()));assert.equal(await raw(),'hTHE[?]r');
  assert.equal(await page.locator('#ocr-formatted').inputValue(),'h THE [?] r!');assert(!(await page.locator('#ocr-formatted-copy').isDisabled()));
  const first=page.locator('.ocr-token').first();await first.click();assert(await editor.isVisible());assert(!(await page.locator('#ocr-add-sample').isDisabled()));
  await page.locator('#ocr-unknown').click();assert(await editor.isVisible());assert.equal(await raw(),'hTHE[?]r');
  await page.mouse.click(3,3);assert(!(await editor.isVisible()),'Page blank dismisses detail');assert(await list.evaluate(n=>n.open));
  await first.click();await page.locator('#ocr-preview').scrollIntoViewIfNeeded();b=await page.locator('#ocr-preview').boundingBox();await page.locator('#ocr-preview').click({position:{x:b.width*255/260,y:b.height*75/80}});assert(!(await editor.isVisible()),'Image blank dismisses detail');
  await first.click();await page.locator('#ocr-segmentation summary').click();assert(await editor.isVisible());await page.locator('#ocr-rebox').click();
  await page.locator('#ocr-rebox-cancel').click();assert(await editor.isVisible(),'Rebox controls must not close review');
  // Native <details> dispatches toggle asynchronously after the click task.
  await list.locator('summary').first().click();await editor.waitFor({state:'hidden'});assert(!(await editor.isVisible()));assert(!(await list.evaluate(n=>n.open)));
  await list.locator('summary').first().click();assert(!(await editor.isVisible()),'Expanding alone must not select a glyph');
  await page.locator('.ocr-token').nth(1).click();assert.equal(await page.locator('#ocr-choice').inputValue(),'the','id:null uses fallback candidate');
  await first.click();await page.locator('#ocr-choice').selectOption('f');await page.locator('#ocr-confirm').click();assert(!(await editor.isVisible()));assert.equal(await raw(),'fTHE[?]r');
  assert.equal(await page.locator('#ocr-formatted').inputValue(),'h THE [?] r!');assert(await page.locator('#ocr-formatted-copy').isDisabled(),'Changed candidate preserves but invalidates edited formatting');
  await page.locator('#ocr-append').click();assert.equal(await page.locator('#english-input').inputValue(),'fTHE[?]r');
  await list.locator('summary').first().click();await page.locator('#ocr-results').scrollIntoViewIfNeeded();
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.screenshot({path:path.join(__dirname,'qa/ocr-result-first-'+width+'.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  // Starting another recognition resets the review fold/selection state.
  await page.locator('#ocr-run').click();await page.waitForFunction(()=>!document.querySelector('#ocr-run').disabled);assert(!(await list.evaluate(n=>n.open)));assert(!(await editor.isVisible()));
  await page.close();
 }console.log('PASS pasted-image result-first UI on desktop/mobile: collapsed review, candidate output, no-candidate placeholder, blank/confirm dismissal, preview controls, rebox, sample eligibility, stale formatting, writer append, no network.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
