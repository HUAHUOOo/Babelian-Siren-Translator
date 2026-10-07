/* Simplified in-memory OCR lifecycle. Legacy serialization/history stay covered
 * by ocr-work.cjs; their removed UI is not exercised here. Synthetic input only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=pathToFileURL(path.resolve(__dirname,'../index.html')).href;
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000},acceptDownloads:true}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(()=>{
   window.Worker=class{postMessage(message){window.__testOptions=message.options;setTimeout(()=>{
    const ids=['h','f','r','the','h','f','r','h'],result={width:420,height:170,polarity:'dark',threshold:150,lines:[0,1].map(line=>({box:{x:15,y:20+line*80,width:360,height:45},tokens:ids.slice(line*4,line*4+4).map((id,token)=>({box:{x:15+token*95,y:20+line*80,width:65,height:45},id,score:.8,certain:token===1,manual:false,candidates:[{id,score:.8},{id:'A',score:.7}],...(token===1?{excludedBoxes:[{x:25+token*95,y:25+line*80,width:10,height:20}]}:{})}))}))};this.onmessage?.({data:{result}});
   },10);}terminate(){}};
  });
  await page.goto(url);await page.locator('#language-open-babelian-translate').click();
  for(const id of ['ocr-work-save','ocr-work-load','ocr-work-file','ocr-work-status','ocr-undo','ocr-redo','ocr-review-undo','ocr-review-redo','ocr-add-sample','ocr-samples','ocr-full','ocr-rotate','ocr-forget','ocr-crop-apply','ocr-polarity','ocr-single','ocr-detail','ocr-auto','ocr-threshold'])assert.equal(await page.locator('#'+id).count(),0,id+' must stay removed');
  await page.evaluate(()=>{const cv=document.createElement('canvas');cv.width=420;cv.height=170;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,420,170);ctx.fillStyle='#222';for(let line=0;line<2;line++)for(let token=0;token<4;token++)ctx.fillRect(15+token*95,20+line*80,65,45);const bytes=Uint8Array.from(atob(cv.toDataURL().split(',')[1]),ch=>ch.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'work-fixture.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);
  await page.locator('#ocr-run').click();await page.locator('#ocr-results').waitFor();
  assert.deepEqual(await page.evaluate(()=>__testOptions),{polarity:'auto',threshold:null,oneLine:false,detail:true});
  const snapshot=()=>page.evaluate(()=>BABELIAN_APP.ocr.snapshot()),result=async()=>(await snapshot()).result;
  const baseline=await result(),stored=await page.evaluate(()=>JSON.stringify({...localStorage}));
  await page.locator('#ocr-punctuate').uncheck();const edited=(await page.locator('#ocr-formatted').inputValue())+'!';await page.locator('#ocr-formatted').fill(edited);
  await page.locator('#ocr-review-toggle').click();await page.locator('.ocr-token').first().click();assert(await page.locator('#ocr-context').isVisible());
  await page.locator('#ocr-candidates button').nth(1).click();assert.deepEqual(await result(),baseline,'candidate preview leaves results unchanged');await page.locator('#ocr-choice').selectOption('f');await page.locator('#ocr-confirm').click();
  const confirmed=await result();assert.equal(confirmed.lines[0].tokens[0].id,'f');assert(confirmed.lines[0].tokens[0].manual);assert.equal(await page.locator('#ocr-formatted').inputValue(),edited);assert(await page.locator('#ocr-formatted-copy').isDisabled());
  // Removed history does not capture browser/text undo shortcuts.
  await page.locator('.ocr-token').first().focus();for(const shortcut of ['Control+z','Control+Shift+z']){await page.keyboard.press(shortcut);assert.deepEqual(await result(),confirmed);}
  for(const id of ['ocr-formatted','ocr-review-toggle']){const prevented=await page.evaluate(id=>{const e=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});document.getElementById(id).dispatchEvent(e);return e.defaultPrevented;},id);assert.equal(prevented,false);}
  await page.locator('.ocr-token').nth(1).click();
  // Original context keeps excluded strokes while the selected crop hides them.
  const pixels=await page.evaluate(()=>{const p=BABELIAN_APP.ocr.snapshot().selected,r=BABELIAN_APP.ocr.snapshot().result,a=BabelianOCRWork.context(r,p),b=r.lines[p.line].tokens[p.token].box;return {caption:document.getElementById('ocr-context-caption').textContent,context:[...document.getElementById('ocr-context').getContext('2d').getImageData(125-a.box.x,30-a.box.y,1,1).data],piece:[...document.getElementById('ocr-piece').getContext('2d').getImageData(125-b.x,30-b.y,1,1).data]};});
  assert(pixels.caption.includes('2 个相邻'));assert(pixels.context[0]<50);assert(pixels.piece[0]>200);
  await page.locator('.ocr-token').first().click();await page.locator('#ocr-segmentation-toggle').click();const priorSplit=await snapshot();
  await page.evaluate(()=>{window.__originalMatch=BabelianOCR.matchDescriptor;let n=0;BabelianOCR.matchDescriptor=(...args)=>{if(++n===2)throw Error('synthetic second-half failure');return __originalMatch(...args);};});
  await page.locator('#ocr-split').click();assert.deepEqual(await snapshot(),priorSplit,'split commits only after both matches succeed');assert((await page.locator('#ocr-status').textContent()).includes('未应用拆分'));await page.evaluate(()=>BabelianOCR.matchDescriptor=__originalMatch);
  await page.locator('#ocr-split').click();assert.equal((await result()).lines[0].tokens.length,5);await page.locator('#ocr-merge').click();assert.equal((await result()).lines[0].tokens.length,4);
  const beforeRebox=await snapshot();await page.locator('#ocr-rebox').click();assert(await page.locator('#ocr-pending-only').isDisabled());await page.keyboard.press('Escape');assert.deepEqual(await snapshot(),beforeRebox);assert(!(await page.locator('#ocr-pending-only').isDisabled()));
  await page.locator('#ocr-rebox').click();await page.locator('#ocr-preview').scrollIntoViewIfNeeded();const cv=page.locator('#ocr-preview'),bb=await cv.boundingBox();
  await page.mouse.move(bb.x+bb.width*18/420,bb.y+bb.height*23/170);await page.mouse.down();await page.mouse.move(bb.x+bb.width*76/420,bb.y+bb.height*62/170);await page.mouse.up();await page.locator('#ocr-rebox-apply').click();
  assert.notDeepEqual(await result(),beforeRebox.result);assert(!(await page.locator('#ocr-rebox-bar').isVisible()));assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),stored,'manual OCR remains page-local');
  // Returning to a workspace preserves in-memory corrections; new recognition resets them.
  const retained=await snapshot();await page.locator('#language-back').click();await page.locator('#language-open-babelian-translate').click();assert.deepEqual(await snapshot(),retained);
  await page.locator('#ocr-run').click();await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);assert.deepEqual(await result(),baseline);assert.equal((await snapshot()).selected,null);assert(!(await page.locator('#ocr-tokens').isVisible()));
  await page.locator('#ocr-review-toggle').click();await page.locator('.ocr-token').nth(1).click();fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.screenshot({path:path.join(__dirname,'qa/ocr-work-'+width+'.png')});
  await page.reload();await page.locator('#language-open-babelian-translate').click();assert.equal((await snapshot()).result,null);assert.equal((await snapshot()).crop,null);assert(await page.locator('#ocr-run').isDisabled());assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),stored);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.close();
  console.log(`PASS simplified OCR lifecycle at ${width}px: automatic defaults, removed controls, candidate/confirmation, native undo untouched, context/exclusions, atomic split failure, split/merge/rebox, page-local corrections/reset, no HTTP/errors/overflow.`);
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
