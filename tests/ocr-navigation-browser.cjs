/* Deterministic worker fixture tests UI navigation, not OCR accuracy. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());
  await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(()=>{
   window.Worker=class{postMessage(){setTimeout(()=>{
    const result={width:900,height:330,polarity:'dark',threshold:150,lines:[20,5,0,13,20].map((count,line)=>({box:{x:10,y:20+line*60,width:850,height:40},tokens:Array.from({length:count},(_,token)=>{
     const id=token%2?'f':'h';return {box:{x:10+token*42,y:20+line*60,width:40,height:40},id,certain:token%3!==0,manual:false,score:.9,candidates:[{id,score:.9}]};
    })}))};window.__testOCR=result;this.onmessage?.({data:{result}});
   },10);}terminate(){}};
  });
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.locator('#language-open-babelian-translate').click();
  await page.evaluate(()=>{const cv=document.createElement('canvas');cv.width=900;cv.height=330;cv.getContext('2d').fillRect(0,0,900,330);const bytes=Uint8Array.from(atob(cv.toDataURL().split(',')[1]),ch=>ch.charCodeAt(0)),data=new DataTransfer();data.items.add(new File([bytes],'navigation.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
  await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);await page.locator('#ocr-run').click();await page.locator('#ocr-results').waitFor();
  const toggle=page.locator('#ocr-review-toggle'),list=page.locator('#ocr-tokens'),editor=page.locator('#ocr-review'),segToggle=page.locator('#ocr-segmentation-toggle');
  assert.equal(await toggle.evaluate(n=>n.tagName),'BUTTON');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert(!(await list.isVisible()));
  // Native button keyboard activation is also a disclosure control.
  await toggle.focus();await page.keyboard.press('Enter');assert(await list.isVisible());assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert(!(await editor.isVisible()));
  const frozen=await page.evaluate(()=>JSON.stringify(__testOCR)),raw=await page.locator('#ocr-output').inputValue();
  await page.locator('#ocr-punctuate').uncheck();const edited=(await page.locator('#ocr-formatted').inputValue())+'!';await page.locator('#ocr-formatted').fill(edited);
  const current=()=>page.locator('.ocr-token[aria-pressed=true]').evaluate(n=>({line:+n.dataset.line,token:+n.dataset.token}));
  const expect=async(line,token)=>{assert.deepEqual(await current(),{line,token});assert.equal(await page.locator('.ocr-token[aria-pressed=true]').count(),1);assert.equal(await page.locator('#ocr-review-title').textContent(),`复核第 ${line+1} 行 · 第 ${token+1} 项`);};
  const focusToken=async(line,token)=>page.locator(`.ocr-token[data-line="${line}"][data-token="${token}"]`).focus();
  const expectedVertical=async(down)=>page.locator('.ocr-token').evaluateAll((nodes,down)=>{
   const all=nodes.map(n=>({line:+n.dataset.line,token:+n.dataset.token,selected:n.getAttribute('aria-pressed')==='true',rect:n.getBoundingClientRect()})),current=all.find(n=>n.selected);
   const rows=[];for(const n of all){let row=rows.find(r=>Math.abs(r.top-n.rect.top)<2);if(!row){row={top:n.rect.top,items:[]};rows.push(row);}row.items.push(n);}
   rows.sort((a,b)=>a.top-b.top);const index=rows.findIndex(r=>r.items.includes(current)),target=rows[index+(down?1:-1)];if(!target)return {line:current.line,token:current.token};
   const x=(current.rect.left+current.rect.right)/2,picked=target.items.reduce((best,n)=>Math.abs((n.rect.left+n.rect.right)/2-x)<Math.abs((best.rect.left+best.rect.right)/2-x)?n:best);return {line:picked.line,token:picked.token};
  },down);
  await page.locator('.ocr-token').first().click();await expect(0,0);assert(await editor.isVisible());
  const pageY=await page.evaluate(()=>scrollY);
  await page.keyboard.press('ArrowLeft');await expect(0,0);await page.keyboard.press('ArrowUp');await expect(0,0);
  assert.equal(await page.evaluate(()=>scrollY),pageY,'boundary keys must not scroll the page');
  await page.keyboard.press('ArrowRight');await expect(0,1);await page.keyboard.press('ArrowLeft');await expect(0,0);
  const below=await expectedVertical(true);await page.keyboard.press('ArrowDown');assert.deepEqual(await current(),below);
  const above=await expectedVertical(false);await page.keyboard.press('ArrowUp');assert.deepEqual(await current(),above);
  await page.locator('.ocr-token[data-line="0"][data-token="19"]').click();await page.keyboard.press('ArrowRight');await expect(1,0);await page.keyboard.press('ArrowLeft');await expect(0,19);
  await page.locator('.ocr-token[data-line="4"][data-token="19"]').click();await page.keyboard.press('ArrowRight');await expect(4,19);await page.keyboard.press('ArrowDown');await expect(4,19);
  // Repeated arrows scroll only the thumbnail container into view.
  await page.locator('.ocr-token').first().click();const startingY=await page.evaluate(()=>scrollY);
  for(let n=0;n<40;n++)await page.keyboard.press('ArrowRight');assert((await list.evaluate(n=>n.scrollTop))>0);assert.equal(await page.evaluate(()=>scrollY),startingY);
  const kept=await current();assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('ocr-token')),true);
  await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Control+ArrowLeft');assert.deepEqual(await current(),kept);
  await page.locator('#ocr-choice').focus();await page.keyboard.press('ArrowDown');assert.deepEqual(await current(),kept,'select keeps its native arrows');
  await page.locator('#ocr-formatted').focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowDown');assert.deepEqual(await current(),kept,'textarea keeps caret movement');
  assert.equal(await segToggle.evaluate(n=>n.tagName),'BUTTON');assert.equal(await segToggle.getAttribute('aria-expanded'),'false');await segToggle.click();assert.equal(await segToggle.getAttribute('aria-expanded'),'true');assert(await page.locator('#ocr-segmentation').isVisible());
  await page.locator('#ocr-split-at').focus();await page.keyboard.press('ArrowUp');assert.equal(await page.locator('#ocr-split-at').inputValue(),'51');assert.deepEqual(await current(),kept);
  await page.evaluate(()=>{const edit=document.createElement('div');edit.id='test-editable';edit.contentEditable='true';edit.textContent='editable';document.getElementById('ocr-review').append(edit);edit.focus();});await page.keyboard.press('ArrowRight');assert.deepEqual(await current(),kept,'contenteditable keeps its arrows');
  await page.locator('#ocr-rebox').click();await page.keyboard.press('ArrowRight');assert.deepEqual(await current(),kept,'reboxing cannot change target');await page.keyboard.press('Escape');assert(!(await page.locator('#ocr-rebox-bar').isVisible()));
  await focusToken(kept.line,kept.token);await page.keyboard.press('ArrowLeft');assert.notDeepEqual(await current(),kept);
  assert.equal(await page.evaluate(()=>JSON.stringify(__testOCR)),frozen,'selection must not confirm/change glyphs');assert.equal(await page.locator('#ocr-output').inputValue(),raw);assert.equal(await page.locator('#ocr-formatted').inputValue(),edited,'selection preserves edited formatting');assert(!(await page.locator('#ocr-formatted-copy').isDisabled()));
  const retained=await current();await page.locator('#language-back').click();const prevented=await page.evaluate(()=>{const e=new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true});document.body.dispatchEvent(e);return e.defaultPrevented;});assert.equal(prevented,false,'hidden workspace does not capture arrows');await page.locator('#language-open-babelian-translate').click();assert.deepEqual(await current(),retained);
  await segToggle.click();assert.equal(await segToggle.getAttribute('aria-expanded'),'false');assert(!(await page.locator('#ocr-segmentation').isVisible()));
  await toggle.focus();await page.keyboard.press('Space');assert(!(await list.isVisible()));assert(!(await editor.isVisible()));assert.equal(await toggle.getAttribute('aria-expanded'),'false');await page.keyboard.press('Enter');assert(await list.isVisible());assert(!(await editor.isVisible()));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.evaluate(()=>document.getElementById('test-editable').remove());await page.locator('.ocr-token').first().click();await page.screenshot({path:path.join(__dirname,'qa/ocr-navigation-'+width+'.png')});await page.close();
  console.log('PASS review buttons and arrow navigation at '+width+'px: wrapped/short/empty rows, order/geometry, boundaries/focus/list scrolling, native editing/modifiers/rebox/hidden guards; unchanged recognition/draft, no HTTP/errors.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
