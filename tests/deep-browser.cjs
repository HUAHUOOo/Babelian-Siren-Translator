const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),F=require(root+'/tests/siren-fixture.cjs'),C=require(root+'/src/siren-core.js');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});
  const page=await browser.newPage({viewport:{width:1400,height:1000},acceptDownloads:true}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(root+'/index.html').href);await page.waitForFunction(()=>window.BABELIAN_APP?.navigation);await page.evaluate(()=>window.BABELIAN_APP.siren.ready);
  await page.locator('#language-open-siren').click();await page.locator('#siren-open-add').click();
  const order=await page.locator('#siren-keyboard button span').allTextContents();assert.equal(order.join(''),'ABCDEFGHIJKLMZYXWVUTSRQPON');
  for(const width of [1400,390]){await page.setViewportSize({width,height:1000});const boxes=await page.locator('#siren-keyboard button').evaluateAll(list=>list.map(e=>({x:e.offsetLeft,y:e.offsetTop})));assert.equal(boxes.filter(b=>b.y===boxes[0].y).length,13);for(let i=0;i<13;i++)assert.equal(boxes[i].x,boxes[i+13].x);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.locator('#siren-keyboard-panel').screenshot({path:path.resolve(__dirname,'qa/siren-keyboard-paired.png')});await page.setViewportSize({width:1400,height:1000});
  const doc=C.fromText('A');doc.mode='review';const group=doc.groups[0];F.geometry.arrange(group);const t=group.items[0],pose={...t,rotation:C.rotationFor(group,t),score:.99};
  group.image=await page.evaluate(async({group,pose,base,letter})=>{const cv=document.createElement('canvas');cv.width=cv.height=600;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,600,600);for(const [a,p] of [[base,{x:group.cx,y:group.cy,size:group.baseSize,rotation:group.baseRotation}],[letter,pose]]){const img=new Image();img.src=a.src;await img.decode();const h=p.size*a.height/a.width;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(img,-p.size*a.pivotX,-h*a.pivotY,p.size,h);ctx.restore();}return cv.toDataURL();},{group,pose,base:F.assets.base,letter:F.assets.letters.A});
  t.letter=null;t.fit={rotation:pose.rotation,score:.9,candidates:[{letter:'A',x:t.x,y:t.y,size:t.size,rotation:pose.rotation,score:.9}]};
  await page.locator('#siren-mode-review').click();await page.locator('#siren-work-file').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.waitForFunction(()=>window.BABELIAN_APP.siren.snapshot().groups.length===1);
  await page.locator('#siren-items button').first().click();const before=await page.evaluate(()=>JSON.stringify(window.BABELIAN_APP.siren.snapshot()));await page.locator('#siren-deep-toggle').click();await page.locator('#siren-deep-run').click();await page.waitForFunction(()=>!document.getElementById('siren-deep-run').disabled,{},{timeout:60000});
  assert((await page.locator('#siren-deep-candidates button').count())>0);assert.equal(await page.evaluate(()=>JSON.stringify(window.BABELIAN_APP.siren.snapshot())),before);
  await page.locator('#siren-deep-candidates button').first().click();assert.equal(await page.evaluate(()=>JSON.stringify(window.BABELIAN_APP.siren.snapshot())),before);await page.locator('#siren-deep-apply').click();assert.equal((await page.evaluate(()=>window.BABELIAN_APP.siren.snapshot())).groups[0].items[0].letter,'A');
  assert.equal(await page.locator('#siren-add-sample,#siren-samples').count(),0);
  await page.locator('#language-back').click();await page.locator('#language-open-babelian-translate').click();
  const png=await page.evaluate(async()=>{const a=window.BABELIAN_APP.assets.glyphs.B,img=new Image();img.src=a.src;await img.decode();const cv=document.createElement('canvas');cv.width=Math.ceil(90*a.width/a.height)+30;cv.height=120;const ctx=cv.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,cv.width,cv.height);ctx.drawImage(img,15,15,90*a.width/a.height,90);return cv.toDataURL();});
  await page.locator('#ocr-file').setInputFiles({name:'glyph.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await page.waitForFunction(()=>!document.getElementById('ocr-run').disabled);await page.locator('#ocr-run').click();await page.locator('#ocr-results').waitFor();await page.locator('#ocr-review-toggle').click();await page.locator('.ocr-token').first().click();
  const automaticWork=await page.evaluate(()=>BABELIAN_APP.ocr.snapshot());assert.equal(automaticWork.result.lines[0].tokens[0].manual,false);
  const raw=await page.locator('#ocr-output').inputValue();await page.locator('#ocr-deep').click();await page.locator('#ocr-deep-candidates button').first().waitFor();assert.equal(await page.locator('#ocr-output').inputValue(),raw);await page.locator('#ocr-deep-candidates button').first().click();assert.equal(await page.locator('#ocr-output').inputValue(),raw);
  await page.locator('#ocr-confirm').click();assert(!(await page.locator('#ocr-review').isVisible()));
  assert.equal(await page.locator('#ocr-add-sample,#ocr-samples,#ocr-work-save,#ocr-work-load,#ocr-undo,#ocr-redo').count(),0);
  const keptOCR=await page.locator('#ocr-output').inputValue(),keptSiren=await page.evaluate(()=>JSON.stringify(window.BABELIAN_APP.siren.snapshot())),keptStorage=await page.evaluate(()=>JSON.stringify({...localStorage}));
  assert((await page.evaluate(()=>BABELIAN_APP.ocr.snapshot())).result.lines[0].tokens[0].manual);
  await page.locator('#language-back').click();await page.locator('#language-open-siren-translate').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(BABELIAN_APP.siren.snapshot())),keptSiren);
  assert(!(await page.locator('#host-status').isVisible()));assert(!(await page.locator('#host-bar').isVisible()));
  const event=page.waitForEvent('download');await page.locator('#siren-save').click();const saved=JSON.parse(fs.readFileSync(await (await event).path(),'utf8'));
  await page.locator('#siren-work-file').setInputFiles({name:'retained-siren-work.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
  await page.waitForFunction(()=>document.getElementById('siren-work-file').value==='');
  assert.equal(await page.evaluate(()=>JSON.stringify(BABELIAN_APP.siren.snapshot())),keptSiren);
  await page.locator('#language-back').click();assert(!(await page.locator('#host-bar').isVisible()));await page.locator('#language-open-babelian-translate').click();
  assert.equal(await page.locator('#ocr-output').inputValue(),keptOCR);assert.equal(await page.locator('.ocr-token').count(),1);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),keptStorage);assert(!(await page.locator('#host-status').isVisible()));assert(await page.locator('#host-bar').isVisible(),'workspace backup actions remain');
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log('PASS isolated headless browser: paired keyboard desktop/mobile, actual deep worker/preview/confirmation, retained Siren work save/load, removed Babelian work/sample/history controls, language/storage isolation, empty standalone status strip hidden, no remote requests/JS errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
