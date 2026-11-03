/* Real browser entry parity, image clipboard/picker and retained work. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.evaluate(()=>BABELIAN_APP.siren.ready);const storage=await page.evaluate(()=>JSON.stringify({...localStorage}));
  const initial=[];for(const [kind,root]of [['babelian','#language-babelian'],['siren','#panel-siren']]){
   await page.locator('#language-open-'+kind+'-translate').click();
   assert.deepEqual(await page.locator(root+' button:visible').allTextContents(),['粘贴图片','选择图片']);
   const card=page.locator(root+' .translation-entry-card');initial.push(await card.evaluate(n=>{const r=n.getBoundingClientRect(),h=document.querySelector('[data-tool]')?.dataset.tool;return {x:r.x,y:r.y,width:r.width,height:r.height,helper:n.querySelector('.translation-input-help').textContent,buttons:[...n.querySelectorAll('.translation-input-actions button')].map(b=>{const r=b.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})};}));
   const title=page.locator(kind==='babelian'?'#babelian-title':'#siren-title');assert(await title.isVisible());
   fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await page.screenshot({path:path.join(__dirname,'qa/translation-entry-'+kind+'-'+width+'.png'),fullPage:true});
   if(kind==='babelian'){assert(!(await page.locator('.workspace-tabs').isVisible()));assert(!(await page.locator('#ocr-run').isVisible()));assert(!(await page.locator('#ocr-file-info').isVisible()));assert(!(await page.locator('#babelian-description').isVisible()));}
   await page.locator('#language-back').click();
  }
  assert.deepEqual(initial[0],initial[1],'Initial card layout, controls and helper must match');
  const group=C.fromText('A').groups[0];F.geometry.arrange(group);
  const inputs=await page.evaluate(async({group,assets})=>{
   async function draw(parts,width,height){const cv=document.createElement('canvas');cv.width=width;cv.height=height;const c=cv.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,width,height);for(const [a,p]of parts){const im=new Image();im.src=a.src;await im.decode();const h=p.size*a.height/a.width;c.save();c.translate(p.x,p.y);c.rotate((p.rotation||0)*Math.PI/180);c.drawImage(im,-p.size*(a.pivotX??0),-h*(a.pivotY??0),p.size,h);c.restore();}return cv.toDataURL();}
   const a=BABELIAN_APP.assets.glyphs.a;return {babelian:await draw([[a,{x:40,y:30,size:60*a.width/a.height}]],200,130),siren:await draw([[assets.base,{x:group.cx,y:group.cy,size:group.baseSize,rotation:group.baseRotation}],...group.items.map(i=>[assets.letters[i.letter],i])],600,600)};
  },{group,assets:F.assets});
  for(const kind of ['babelian','siren']){
   await page.locator('#language-open-'+kind+'-translate').click();const paste=page.locator(kind==='babelian'?'#ocr-paste-image':'#siren-paste-image'),file=page.locator(kind==='babelian'?'#ocr-file':'#siren-image-file'),status=page.locator(kind==='babelian'?'#ocr-status':'#siren-status'),run=page.locator(kind==='babelian'?'#ocr-run':'#siren-auto-scan');
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:()=>Promise.reject(Error('test permission denied'))}}));await paste.click();await page.waitForFunction(id=>document.getElementById(id).textContent.includes('无法读取剪贴板'),kind==='babelian'?'ocr-status':'siren-status');assert(await status.isVisible());assert(!(await run.isVisible()));
   const png=inputs[kind];await page.evaluate(src=>{const blob=new Blob([Uint8Array.from(atob(src.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'});Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:async()=>[{types:['image/png'],getType:async()=>blob}]}});},png);
   await paste.click();await page.waitForFunction(id=>!document.getElementById(id).disabled,kind==='babelian'?'ocr-run':'siren-auto-scan');assert(await run.isVisible());
   if(kind==='babelian'){assert(!(await page.locator('.workspace-tabs').isVisible()));assert(await page.locator('#ocr-preview').isVisible());}
   else{assert(!(await page.locator('#siren-missing-toggle').isVisible()));assert(!(await page.locator('#siren-source-coverage').isVisible()));}
   // Native file picker still works alongside the new button.
   await file.setInputFiles({name:'entry.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await page.waitForFunction(id=>!document.getElementById(id).disabled,kind==='babelian'?'ocr-run':'siren-auto-scan');
   await run.click();await page.waitForFunction(kind=>kind==='babelian'?!!BABELIAN_APP.ocr.snapshot().result:BABELIAN_APP.siren.snapshot().groups.length>0,kind,{timeout:120000});await page.waitForFunction(id=>!document.getElementById(id).disabled,kind==='babelian'?'ocr-run':'siren-auto-scan');
   const before=await page.evaluate(kind=>JSON.stringify(kind==='babelian'?BABELIAN_APP.ocr.snapshot():BABELIAN_APP.siren.snapshot()),kind);
   if(kind==='babelian')assert(await page.locator('.workspace-tabs').isVisible());else assert(await page.locator('#siren-missing-toggle').isVisible());
   // A delayed clipboard response must not replace work after leaving the page.
   await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{read:()=>new Promise(r=>window.__resolveClipboard=r)}}));await paste.click();await page.locator('#language-back').click();await page.evaluate(()=>window.__resolveClipboard([]));await page.waitForTimeout(30);
   await page.locator('#language-open-'+kind+'-translate').click();assert.equal(await page.evaluate(kind=>JSON.stringify(kind==='babelian'?BABELIAN_APP.ocr.snapshot():BABELIAN_APP.siren.snapshot()),kind),before);assert(await run.isVisible());await page.locator('#language-back').click();
  }
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),storage);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();console.log('PASS shared translation entry '+width+'px: exact initial geometry/labels, clipboard permission/success, picker, real recognition, progressive tools, navigation/stale clipboard/state retention and no network/errors/overflow.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
