/* Synthetic desktop/mobile browser regression. Build index.html first.
 * No user images, game passages, answers or private work files are used. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const context=await browser.newContext({viewport:{width,height:1000},hasTouch:width<600,acceptDownloads:true}),page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(()=>{window.Worker=class{postMessage(){setTimeout(()=>this.onmessage?.({data:{result:{width:500,height:160,threshold:127,polarity:'dark',lines:[{box:{x:10,y:20,width:303,height:40},tokens:[[10,40],[65,100],[180,3],[220,90]].map(([x,width])=>({box:{x,y:20,width,height:40},id:'h',score:.8,manual:false,certain:false,candidates:[{id:'h',score:.8}]}))}]}}}),10);}terminate(){}};});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.locator('#language-open-babelian-translate').click();
  await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=600;canvas.height=240;const c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,600,240);c.fillStyle='#222';for(const [x,width] of [[10,40],[65,100],[180,3],[220,90]])c.fillRect(50+x,50,width,40);const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(canvas.toDataURL().split(',')[1]),c=>c.charCodeAt(0))],'synthetic-split.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);
  // Crop through the retained screenshot drag gesture, in source pixels.
  const preview=page.locator('#ocr-preview');await preview.scrollIntoViewIfNeeded();const cropBounds=await preview.boundingBox();assert(cropBounds);
  await page.mouse.move(cropBounds.x+cropBounds.width*50/600,cropBounds.y+cropBounds.height*30/240);await page.mouse.down();
  await page.mouse.move(cropBounds.x+cropBounds.width*550/600,cropBounds.y+cropBounds.height*190/240,{steps:8});await page.mouse.up();
  await page.locator('#ocr-run').click();await page.locator('#ocr-results').waitFor();
  await page.locator('#ocr-review-toggle').click();await page.locator('.ocr-token').nth(1).click();await page.locator('#ocr-segmentation-toggle').click();
  const snapshot=()=>page.evaluate(()=>BABELIAN_APP.ocr.snapshot()),baseline=await snapshot(),slider=page.locator('#ocr-split-at');assert.equal(await slider.getAttribute('type'),'range');
  const set=async percent=>{await slider.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));},String(percent));};
  const blueBoundary=async()=>page.evaluate(()=>{
   const {result,selected,crop}=BABELIAN_APP.ocr.snapshot(),box=result.lines[selected.line].tokens[selected.token].box,area=BabelianOCRWork.context(result,selected).box;
   const [left]=BabelianOCRCorrection.splitBoxes(box,Number(document.getElementById('ocr-split-at').value)),cut=left.x+left.width;
   return ['ocr-preview','ocr-context','ocr-split-preview'].map(id=>{const canvas=document.getElementById(id),x=id==='ocr-preview'?crop.x+cut:cut-area.x,y=id==='ocr-preview'?crop.y+box.y+10:box.y-area.y+10,p=canvas.getContext('2d').getImageData(x,y,1,1).data;return p[2]>160&&p[0]<100&&p[1]<180;});
  });
  for(const value of [10,30,70,90]){await set(value);assert.deepEqual(await snapshot(),baseline);assert.deepEqual(await blueBoundary(),[true,true,true]);assert.equal(await page.locator('#ocr-undo').count(),0);}
  await set(50);await slider.focus();await page.keyboard.press('ArrowRight');assert.equal(await slider.inputValue(),'51');assert.deepEqual(await snapshot(),baseline,'native range arrows must not move selection');
  await page.keyboard.press('Home');assert.equal(await slider.inputValue(),'10');await page.keyboard.press('End');assert.equal(await slider.inputValue(),'90');
  await slider.scrollIntoViewIfNeeded();const rect=await slider.boundingBox();
  if(width<600)await page.touchscreen.tap(rect.x+rect.width*.4,rect.y+rect.height/2);
  else{await page.mouse.move(rect.x+rect.width*.9,rect.y+rect.height/2);await page.mouse.down();await page.mouse.move(rect.x+rect.width*.4,rect.y+rect.height/2,{steps:8});await page.mouse.up();}
  assert(Number(await slider.inputValue())<75);assert.deepEqual(await snapshot(),baseline);assert.deepEqual(await blueBoundary(),[true,true,true]);
  // A live preview leaves the recognized geometry untouched.
  assert.deepEqual((await snapshot()).result,baseline.result);
  await page.locator('#ocr-segmentation-toggle').click();await page.locator('#ocr-segmentation-toggle').click();assert.equal(await slider.inputValue(),'50');
  await set(70);await page.locator('#ocr-review-close').click();await page.locator('.ocr-token').nth(1).click();assert.equal(await slider.inputValue(),'50');assert.deepEqual(await snapshot(),baseline);
  await page.locator('.ocr-token').nth(2).click();assert(await slider.isDisabled());assert(await page.locator('#ocr-split').isDisabled());await page.locator('.ocr-token').nth(1).click();
  await set(70);await page.locator('#ocr-rebox').click();await page.locator('#ocr-rebox-cancel').click();assert.equal(await slider.inputValue(),'50');assert.deepEqual(await snapshot(),baseline);
  await set(70);await page.locator('#ocr-split').click();const split=await snapshot();assert.equal(split.result.lines[0].tokens.length,5);assert.deepEqual(split.result.lines[0].tokens.slice(1,3).map(t=>t.box.width),[70,30]);assert.equal(await slider.inputValue(),'50');
  const beforeShortcut=await snapshot();await page.locator('.ocr-token').nth(1).focus();await page.keyboard.press('Control+z');assert.deepEqual(await snapshot(),beforeShortcut,'removed history shortcut leaves corrections intact');
  await page.locator('#ocr-split').click();assert.equal((await snapshot()).result.lines[0].tokens.length,6);
  await slider.scrollIntoViewIfNeeded();fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.screenshot({path:path.join(__dirname,`qa/ocr-split-${width}.png`)});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await context.close();
  console.log(`PASS ${width}px split slider: live canvas pixels, crop offsets, native keyboard and ${width<600?'touch':'mouse'} control, immutable preview, cancel/rebox/selection resets, narrow guard, split/repeated apply, no history shortcut, no network/errors/overflow.`);
 }}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
