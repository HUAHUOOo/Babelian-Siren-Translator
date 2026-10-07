/* Synthetic UI workflow fixture, not recognition accuracy or a story answer. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const [width,height] of [[1400,1000],[390,844],[768,600]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(()=>{
   window.Worker=class{postMessage(){setTimeout(()=>{
    const entries=[['h',false,false],['f',true,false],['r',false,true],[null,false,false,'the'],[null,false,false],['f',false,false],['h',false,false],['r',true,false],['h',false,true],['f',false,false],['h',true,false],['r',false,false]];
    const result={width:520,height:210,polarity:'dark',threshold:150,lines:Array.from({length:3},(_,line)=>({box:{x:10,y:20+line*60,width:500,height:40},tokens:entries.slice(line*4,line*4+4).map(([id,certain,manual,fallback],token)=>({box:{x:10+token*120,y:20+line*60,width:70,height:40},id,certain,manual,score:.8,candidates:id||fallback?[{id:id||fallback,score:.8},{id:'A',score:.7}]:[]}))}))};
    window.__testOCR=result;this.onmessage?.({data:{result}});
   },10);}terminate(){}};
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.locator('#language-open-babelian-translate').click();
  await page.evaluate(()=>{const cv=document.createElement('canvas');cv.width=520;cv.height=210;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,520,210);ctx.fillStyle='#222';for(let line=0;line<3;line++)for(let token=0;token<4;token++)ctx.fillRect(10+token*120,20+line*60,70,40);const bytes=Uint8Array.from(atob(cv.toDataURL().split(',')[1]),ch=>ch.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'pending.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);await page.locator('#ocr-run').click();await page.locator('#ocr-results').waitFor();
  const list=page.locator('#ocr-tokens'),editor=page.locator('#ocr-review'),filter=page.locator('#ocr-pending-only');
  const selected=()=>page.locator('.ocr-token[aria-pressed=true]').evaluate(n=>({line:+n.dataset.line,token:+n.dataset.token}));
  const expect=async(line,token)=>assert.deepEqual(await selected(),{line,token});
  const pending=()=>page.evaluate(()=>BabelianOCRUI.pending(__testOCR));
  const frozen=await page.evaluate(()=>JSON.stringify(__testOCR)),raw=await page.locator('#ocr-output').inputValue();
  assert.equal((await pending()).length,7);assert(!(await list.isVisible()));assert(!(await editor.isVisible()));assert.equal(await page.locator('#ocr-pending-status').textContent(),'剩余 7 项待确认');
  await page.locator('#ocr-punctuate').uncheck();const edited=(await page.locator('#ocr-formatted').inputValue())+'!';await page.locator('#ocr-formatted').fill(edited);
  await page.locator('#ocr-review-toggle').click();await page.locator('.ocr-token').first().click();await expect(0,0);assert(await list.isVisible());assert(await editor.isVisible());assert.equal(await page.locator('#ocr-review-position').textContent(),'待确认 1 / 7');
  assert.equal(await editor.evaluate(n=>getComputedStyle(n).position),'fixed');
  if(width>1000){const bounds=await editor.boundingBox(),tokens=await list.boundingBox();assert(bounds.x>width/2);assert(tokens.x+tokens.width<=bounds.x,'desktop reserves room for the side editor');}
  else {const bounds=await editor.boundingBox(),tokens=await list.boundingBox();assert.equal(bounds.x,0);assert(bounds.y>=height*.47);assert(Math.abs(bounds.y+bounds.height-height)<2);assert(tokens.y+tokens.height<=bounds.y,'mobile list stays above sheet');}
  // Fixed panel stays at the same screen position while the page scrolls.
  const before=await editor.boundingBox();await page.evaluate(()=>scrollBy(0,90));assert.deepEqual(await editor.boundingBox(),before);await page.locator('.ocr-token[data-line="0"][data-token="3"]').click();await expect(0,3);
  await page.locator('#ocr-choice').selectOption('A');await page.locator('.ocr-token[data-line="1"][data-token="0"]').click();await expect(1,0);assert.equal(await page.locator('#ocr-output').inputValue(),raw,'candidate preview is not a correction');
  await page.locator('.ocr-token').first().click();await expect(0,0);
  assert.equal(await page.locator('#ocr-pending-next,#ocr-pending-prev,#ocr-review-next,#ocr-review-prev').count(),0);
  await filter.check();assert.equal(await page.locator('.ocr-token').count(),7);assert.equal(await page.locator('.ocr-token:not(.uncertain)').count(),0);assert.equal(await page.locator('#ocr-output').inputValue(),raw);
  await page.locator('.ocr-token[aria-pressed=true]').focus();await page.keyboard.press('ArrowRight');await expect(0,3);await page.keyboard.press('ArrowLeft');await expect(0,0);
  assert.equal(await page.evaluate(()=>JSON.stringify(__testOCR)),frozen,'navigation and filtering never confirm or alter the OCR');assert.equal(await page.locator('#ocr-formatted').inputValue(),edited);assert(!(await page.locator('#ocr-formatted-copy').isDisabled()));
  // Confirm is explicit, does not add samples, and the old close behavior stays.
  await page.locator('#ocr-confirm').click();assert(!(await editor.isVisible()));assert.equal((await pending()).length,6);assert.equal(await page.locator('.ocr-token').count(),6);assert.equal(await page.locator('#ocr-output').inputValue(),raw);assert.equal(await page.locator('#ocr-formatted').inputValue(),edited);
  assert.equal(await page.evaluate(()=>__testOCR.lines[0].tokens[0].manual),true);assert.equal(await page.locator('#ocr-samples').count(),0);assert.equal(await page.locator('#ocr-pending-status').textContent(),'剩余 6 项待确认');
  await page.locator('.ocr-token').first().click();await expect(0,3);
  // Confirm-and-next updates progress using remaining items, not a stale index.
  await page.locator('#ocr-confirm-next').click();await expect(1,0);assert.equal(await page.locator('#ocr-review-position').textContent(),'待确认 1 / 5');assert.equal(await page.locator('#ocr-choice').inputValue(),'A','missing candidate requires an explicit template selection');
  await page.locator('#ocr-confirm-next').click();await expect(1,1);assert.equal((await pending()).length,4);assert(await page.locator('#ocr-formatted-copy').isDisabled());assert.equal(await page.locator('#ocr-formatted').inputValue(),edited,'a changed letter preserves but marks edited suggestions stale');
  await page.locator('#ocr-review-close').click();assert(!(await editor.isVisible()));assert(await list.isVisible());await page.locator('.ocr-token').first().click();await page.keyboard.press('Escape');assert(!(await editor.isVisible()));assert.equal((await pending()).length,4);
  await page.locator('.ocr-token').last().click();await expect(2,3);await page.mouse.click(3,3);assert(!(await editor.isVisible()));assert.equal((await pending()).length,4);
  await page.locator('.ocr-token').first().click();await expect(1,1);await page.locator('#ocr-segmentation-toggle').click();await page.locator('#ocr-rebox').click();assert(!(await editor.isVisible()),'rebox temporarily clears the fixed panel');assert(await filter.isDisabled());await page.keyboard.press('Escape');assert(await editor.isVisible());await expect(1,1);
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.locator('#ocr-segmentation-toggle').click();await page.screenshot({path:path.join(__dirname,'qa/ocr-pending-'+width+'.png')});await page.locator('#ocr-segmentation-toggle').click();
  for(let remaining=4;remaining>0;remaining--){assert.equal((await pending()).length,remaining);await page.locator('#ocr-confirm-next').click();}
  assert(!(await editor.isVisible()));assert.equal((await pending()).length,0);assert.equal(await page.locator('.ocr-token').count(),0);assert(await page.locator('#ocr-filter-empty').isVisible());assert.equal(await page.locator('#ocr-pending-status').textContent(),'无待确认项');
  await filter.uncheck();assert.equal(await page.locator('.ocr-token').count(),12);assert(!(await page.locator('#ocr-filter-empty').isVisible()));
  // Manually marking an accepted item pending and split/merge recalculate counts.
  await page.locator('.ocr-token').first().click();await page.locator('#ocr-unknown').click();assert.equal((await pending()).length,1);await filter.check();assert.equal(await page.locator('.ocr-token').count(),1);
  await page.locator('#ocr-split').click();assert.equal((await pending()).length,2);assert.equal(await page.locator('.ocr-token').count(),2);await page.locator('#ocr-merge').click();assert.equal((await pending()).length,1);await page.locator('#ocr-confirm-next').click();assert(!(await editor.isVisible()));assert.equal((await pending()).length,0);
  // A source-box selection overrides the filter so the accepted item is visible.
  const preview=page.locator('#ocr-preview');await preview.scrollIntoViewIfNeeded();const sourceBounds=await preview.boundingBox();assert(sourceBounds);
  await page.mouse.click(sourceBounds.x+sourceBounds.width*40/520,sourceBounds.y+sourceBounds.height*40/210);
  assert(!(await filter.isChecked()));await expect(0,0);assert(await editor.isVisible());await page.locator('#ocr-review-close').click();
  // A new recognition resets filtering, detail and disclosure state.
  await page.locator('#ocr-run').click();await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);assert(!(await filter.isChecked()));assert(!(await list.isVisible()));assert(!(await editor.isVisible()));assert.equal((await pending()).length,7);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.close();
  console.log(`PASS pending review ${width}x${height}: fixed responsive editor, filtered/arrows, preview vs confirmation, continue/finish/close, removed controls and draft safety, rebox, split/merge/source override/reset; no HTTP/errors/overflow.`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
