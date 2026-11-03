/* Real Chrome/Worker, public generated spirals only. Not phone or accuracy QA. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url'),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const F=require('./siren-fixture.cjs'),C=require('../src/siren-core.js');
const output=process.env.SIREN_QA_DIR||path.join(__dirname,'qa');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.addInitScript(()=>{const NativeWorker=Worker;window.workerTrace=[];window.workerCount=0;window.lastWorkerResult=null;window.Worker=class extends NativeWorker{constructor(...args){super(...args);workerCount++;this.addEventListener('message',e=>{if(e.data.partial)workerTrace.push({index:e.data.partial.index,cached:e.data.partial.cached,group:e.data.partial.group});if(e.data.result)window.lastWorkerResult=e.data.result;});}};});
  await page.goto(pathToFileURL(process.env.BABELIAN_APP_FILE||path.resolve(__dirname,'../index.html')).href);await page.evaluate(()=>BABELIAN_APP.siren.ready);await page.locator('#language-open-siren-translate').click();
  const snapshot=()=>page.evaluate(()=>BABELIAN_APP.siren.snapshot());const stored=await page.evaluate(()=>JSON.stringify({...localStorage}));
  assert.deepEqual(await page.locator('#panel-siren button:visible').allTextContents(),['粘贴图片','选择图片']);assert(!(await page.locator('#siren-scan-preview').isVisible()));
  const groups=['A','B'].map(text=>{const g=C.fromText(text).groups[0];assert(F.geometry.arrange(g));return g;});
  const png=await page.evaluate(async({groups,assets})=>{
   const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,600);
   for(let n=0;n<groups.length;n++){const g=groups[n],parts=[[assets.base,{x:g.cx,y:g.cy,size:g.baseSize,rotation:g.baseRotation}],...g.items.map(p=>[assets.letters[p.letter],p])];for(const [a,p]of parts){const img=new Image();img.src=a.src;await img.decode();ctx.save();ctx.translate(p.x+600*n,p.y);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(img,-p.size*a.pivotX,-p.size*a.height/a.width*a.pivotY,p.size,p.size*a.height/a.width);ctx.restore();}}
   return canvas.toDataURL();
  },{groups,assets:F.assets});
  const upload=async()=>{await page.locator('#siren-image-file').setInputFiles({name:'generated-pair.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await page.waitForFunction(()=>!document.getElementById('siren-auto-scan').disabled);};await upload();
  await page.locator('#siren-auto-scan').click();await page.waitForFunction(()=>document.getElementById('siren-preview-groups').children.length===1,{},{timeout:180000});
  assert.equal((await snapshot()).groups.length,0,'Incremental preview must not mutate work');assert(await page.locator('#siren-scan-cancel').isVisible());assert(!(await page.locator('#siren-preview-keep').isVisible()));
  await page.screenshot({path:path.join(output,'progress-'+width+'.png'),fullPage:true});
  await page.locator('#siren-scan-cancel').click();assert.equal((await snapshot()).groups.length,0);assert(await page.locator('#siren-preview-keep').isVisible());
  const firstRaw=await page.evaluate(()=>workerTrace[0].group);await page.locator('#siren-preview-keep').click();assert.equal((await snapshot()).groups.length,1);await page.locator('#siren-undo').click();assert.equal((await snapshot()).groups.length,0,'Keep completed is one undoable action');
  const start=Date.now();await page.locator('#siren-auto-scan').click();await page.waitForFunction(()=>BABELIAN_APP.siren.snapshot().groups.length===2&&!document.getElementById('siren-auto-scan').disabled,{},{timeout:180000});const resumedMs=Date.now()-start;
  const trace=await page.evaluate(()=>workerTrace);assert.deepEqual(trace.map(x=>[x.index,x.cached]),[[1,false],[1,true],[2,false]]);assert.deepEqual(trace[1].group,firstRaw);assert(!(await page.locator('#siren-scan-preview').isVisible()));
  const firstResults=await page.evaluate(()=>lastWorkerResult),kept=await snapshot();
  await page.locator('#siren-groups button').first().click();await page.locator('#siren-items button').first().click();await page.locator('#siren-precision-toggle').click();await page.locator('#siren-position-lock').click();await page.locator('#siren-precision-close').click();const locked=await snapshot();assert(locked.groups[0].items[0].positionLocked);
  assert.equal(await page.locator('#siren-difference').evaluate(n=>n.open),false);await page.locator('#siren-difference summary').click();await page.waitForFunction(()=>document.getElementById('siren-difference-status').textContent.includes('600×600'));
  assert.deepEqual(await snapshot(),locked,'Diagnostic cannot mutate work or confirmations');
  const pixels=await page.evaluate(()=>{const a=document.getElementById('siren-difference-rebuilt').getContext('2d').getImageData(0,0,600,600).data,b=document.getElementById('siren-difference-map').getContext('2d').getImageData(0,0,600,600).data;let ink=0,red=0,blue=0;for(let i=0;i<a.length;i+=4){if(a[i]<128)ink++;if(b[i]===192&&b[i+1]===39)red++;if(b[i]===23&&b[i+1]===104)blue++;}return {ink,red,blue};});assert(pixels.ink>100);assert(pixels.red+pixels.blue>0);
  await page.screenshot({path:path.join(output,'difference-'+width+'.png'),fullPage:true});await page.locator('#siren-difference').screenshot({path:path.join(output,'difference-panel-'+width+'.png')});await page.locator('#siren-difference summary').click();
  const count=await page.evaluate(()=>workerCount),warm=Date.now();await page.locator('#siren-auto-scan').click();await page.waitForFunction(()=>BABELIAN_APP.siren.snapshot().groups.length===4&&!document.getElementById('siren-auto-scan').disabled,{},{timeout:30000});const cachedMs=Date.now()-warm;
  assert.equal(await page.evaluate(()=>workerCount),count,'Exact repeat reuses completed computation without another Worker');assert.deepEqual((await snapshot()).groups.slice(0,2),locked.groups,'Cached recognition does not replace former manual corrections');assert.deepEqual(await page.evaluate(()=>workerTrace.slice(-2).map(x=>x.group)),firstResults);
  // Reloaded identical pixels also hit; a different image invalidates and cancels safely.
  await upload();await page.evaluate(()=>{document.getElementById('siren-auto-scan').click();document.getElementById('siren-scan-cancel').click();});assert.equal((await snapshot()).groups.length,4);
  await page.locator('#language-back').click();await page.locator('#language-open-siren-translate').click();assert(!(await page.locator('#siren-scan-preview').isVisible()));assert.deepEqual((await snapshot()).groups.slice(0,2),locked.groups);
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),stored);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  console.log(JSON.stringify({pass:true,width,resumedMs,cachedMs,pixels,groupsBeforeCache:kept.groups.length,finalGroups:(await snapshot()).groups.length}));await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
