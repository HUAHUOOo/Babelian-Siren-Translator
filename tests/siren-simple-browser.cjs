/* Progressive entry, real generated image and real recognition Worker. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const F=require('./siren-fixture.cjs'),C=require('../src/siren-core.js');
const hiddenInitially=['siren-work-actions','siren-work-note','siren-heading-note','siren-source-area','siren-auto-scan','siren-group-toolbar','siren-editor-area','siren-results','siren-samples','siren-add-sample','siren-image-file'];
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(process.env.BABELIAN_APP_FILE||path.resolve(__dirname,'../index.html')).href);
  await page.evaluate(()=>BABELIAN_APP.siren.ready);await page.locator('#language-open-siren-translate').click();
  const snapshot=()=>page.evaluate(()=>BABELIAN_APP.siren.snapshot());
  const samplesHidden=async()=>{assert(!(await page.locator('#siren-samples').isVisible()));assert(!(await page.locator('#siren-add-sample').isVisible()));assert(await page.locator('[data-siren-auxiliary]').evaluateAll(ns=>ns.every(n=>n.hidden&&n.getClientRects().length===0)));};
  for(const id of hiddenInitially)assert(!(await page.locator('#'+id).isVisible()),'Initially hidden '+id);
  assert.deepEqual(await page.locator('#panel-siren button:visible').allTextContents(),['粘贴图片','选择图片']);await samplesHidden();
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.screenshot({path:path.join(__dirname,'qa/siren-simple-entry-'+width+'.png'),fullPage:true});
  // Failed input must retain the clean entry and expose the error message.
  await page.locator('#siren-image-file').setInputFiles({name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('invalid')});
  await page.waitForFunction(()=>document.getElementById('siren-status').textContent.includes('无法读取'));
  assert(!(await page.locator('#siren-source-area').isVisible()));assert(!(await page.locator('#siren-editor-area').isVisible()));
  const group=C.fromText('A').groups[0];assert(F.geometry.arrange(group));
  const png=await page.evaluate(async({group,assets})=>{
   const cv=document.createElement('canvas');cv.width=cv.height=600;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,600);
   const parts=[[assets.base,{x:group.cx,y:group.cy,size:group.baseSize,rotation:group.baseRotation}],...group.items.map(t=>[assets.letters[t.letter],t])];
   for(const [a,p]of parts){const img=new Image();img.src=a.src;await img.decode();const h=p.size*a.height/a.width;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(img,-p.size*a.pivotX,-h*a.pivotY,p.size,h);ctx.restore();}
   return cv.toDataURL();
  },{group,assets:F.assets});
  if(width===1400){const chooser=page.waitForEvent('filechooser');await page.locator('#siren-upload').click();await (await chooser).setFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});}
  else await page.evaluate(png=>{const data=new DataTransfer();data.items.add(new File([Uint8Array.from(atob(png.split(',')[1]),c=>c.charCodeAt(0))],'synthetic.png',{type:'image/png'}));document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},png);
  await page.waitForFunction(()=>!document.getElementById('siren-auto-scan').disabled);
  assert(await page.locator('#siren-source-canvas').isVisible());assert(await page.locator('#siren-auto-scan').isVisible());for(const id of ['siren-work-actions','siren-editor-area','siren-results','siren-group-toolbar'])assert(!(await page.locator('#'+id).isVisible()));await samplesHidden();
  await page.locator('#siren-auto-scan').click();await page.waitForFunction(()=>BABELIAN_APP.siren.snapshot().groups.length>0,{},{timeout:120000});await page.waitForFunction(()=>!document.getElementById('siren-auto-scan').disabled);
  assert(!(await page.locator('#siren-stage').isVisible()));assert(await page.locator('#siren-results').isVisible());assert(await page.locator('#siren-work-actions').isVisible());assert((await page.locator('#siren-raw').inputValue()).length>0);await samplesHidden();
  // Warm-cache runs may finish before a second automation round-trip. Dispatch
  // the real buttons in one turn to test cancellation before cached delivery.
  const kept=await snapshot();await page.evaluate(()=>{document.getElementById('siren-auto-scan').click();document.getElementById('siren-scan-cancel').click();});await page.waitForFunction(()=>document.getElementById('siren-scan-status').textContent.startsWith('已取消'));assert.deepEqual(await snapshot(),kept);await samplesHidden();
  await page.locator('#language-back').click();await page.locator('#language-open-siren').click();assert(await page.locator('#siren-stage').isVisible());assert(await page.locator('#siren-add-group').isVisible());await samplesHidden();
  await page.locator('#language-back').click();await page.locator('#language-open-siren-translate').click();assert.deepEqual(await snapshot(),kept);assert(await page.locator('#siren-source-canvas').isVisible());await samplesHidden();
  await page.screenshot({path:path.join(__dirname,'qa/siren-simple-results-'+width+'.png'),fullPage:true});
  if(!(await page.locator('#siren-stage').isVisible()))await page.locator('#siren-review-toggle').click();
  while((await snapshot()).groups.length){if(!(await page.locator('#siren-delete-group').isVisible()))await page.locator('#siren-group-more summary').click();await page.locator('#siren-delete-group').click();}
  for(const id of ['siren-work-actions','siren-group-toolbar','siren-editor-area','siren-results'])assert(!(await page.locator('#'+id).isVisible()),'Empty work hides '+id);
  assert(await page.locator('#siren-auto-scan').isVisible());await samplesHidden();assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),stored);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.close();
  console.log('PASS Siren simple '+width+'px: clean entry, picker/paste/error, preview/scan, real Worker results, cancellation, generation/navigation/state retention, empty-work cleanup, sample controls hidden, no network/errors/overflow.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
