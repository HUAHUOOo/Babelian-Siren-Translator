/* Runnable browser regression for the built index.html. Synthetic local image
 * and scanner replies exercise real DOM/canvas/pointer state, not OCR accuracy.
 * Run after npm run build, with PLAYWRIGHT_MODULE/BROWSER_EXECUTABLE if needed.
 * A failed normal Chromium launch is a blocker, not a passing browser result. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:960},acceptDownloads:true}),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(String(error)));page.on('dialog',dialog=>dialog.accept());await page.route(/^https?:/,route=>{requests.push(route.request().url());return route.abort();});
  await page.addInitScript(()=>{
    const state=window.__sirenReviewScan={reply:[],hold:false,release:null,cancels:0,payloads:[]};let api;
    Object.defineProperty(window,'SirenScan',{configurable:true,get:()=>api,set(value){api={...value,create:()=>({cancel(){state.cancels++;},run(payload){state.payloads.push({operation:payload.operation,width:payload.image.width,height:payload.image.height,limit:payload.limit});return state.hold?new Promise(resolve=>{state.release=resolve;}):Promise.resolve(state.reply);}})};}});
  });
  await page.goto(pathToFileURL(root+'/index.html').href);await page.waitForFunction(()=>window.BABELIAN_APP?.siren);await page.evaluate(()=>BABELIAN_APP.siren.ready);await page.locator('#language-open-siren-translate').click();
  const template=C.fromText('A').groups[0];assert(F.geometry.arrange(template));const token=template.items[0];
  function result(cx,cy,size=500){const scale=size/500,p={letter:'A',x:cx+(token.x-300)*scale,y:cy+(token.y-300)*scale,size:token.size*scale,rotation:C.rotationFor(template,token),score:.96};return {base:{cx,cy,size,rotation:0},items:[{...p,letter:null,candidates:[p]}]};}
  const results=[result(400,400),result(1200,400)],missing=result(200,200,200);
  const image=await page.evaluate(async({base,letter,groups})=>{
    const canvas=document.createElement('canvas');canvas.width=1600;canvas.height=800;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1600,800);
    for(const group of groups)for(const [asset,p] of [[base,{x:group.base.cx,y:group.base.cy,size:group.base.size,rotation:0}],[letter,group.items[0]]]){const img=new Image();img.src=asset.src;await img.decode();const height=p.size*asset.height/asset.width;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(img,-p.size*asset.pivotX,-height*asset.pivotY,p.size,height);ctx.restore();}return canvas.toDataURL('image/png');
  },{base:F.assets.base,letter:F.assets.letters.A,groups:results});
  await page.locator('#siren-image-file').setInputFiles({name:'synthetic-two-groups.png',mimeType:'image/png',buffer:Buffer.from(image.split(',')[1],'base64')});await page.locator('#siren-auto-scan').waitFor({state:'visible'});await page.evaluate(value=>{__sirenReviewScan.reply=value;},results);await page.locator('#siren-auto-scan').click();await page.waitForFunction(()=>BABELIAN_APP.siren.snapshot().groups.length===2);
  const snapshot=()=>page.evaluate(()=>JSON.stringify(BABELIAN_APP.siren.snapshot())),before=await snapshot();
  await page.locator('#siren-next-pending').click();assert.equal(await snapshot(),before);assert.match(await page.locator('#siren-pending-status').innerText(),/待复核 2 项/);assert.equal(await page.evaluate(()=>document.activeElement.id),'siren-stage');
  const expected=results[0].items[0];assert(await page.evaluate(p=>{const ctx=document.getElementById('siren-source-canvas').getContext('2d'),data=ctx.getImageData(Math.round(p.x)-2,Math.round(p.y)-2,5,5).data;for(let i=0;i<data.length;i+=4)if(data[i]>150&&data[i+1]>50&&data[i+1]<140&&data[i+2]<60)return true;return false;},expected),'Source crosshair must be rendered at the selected glyph source coordinate');
  async function selectROI(){await page.locator('#siren-missing-toggle').click();const canvas=page.locator('#siren-source-canvas');await canvas.scrollIntoViewIfNeeded();const r=await canvas.boundingBox();await page.mouse.move(r.x+r.width*600/1600,r.y);await page.mouse.down();await page.mouse.move(r.x+r.width*1000/1600,r.y+r.height*400/800,{steps:8});await page.mouse.up();assert(await page.locator('#siren-missing-run').isEnabled());}
  await selectROI();await page.evaluate(reply=>{__sirenReviewScan.reply=[reply];},missing);await page.locator('#siren-missing-run').click();await page.locator('#siren-missing-preview').waitFor({state:'visible'});assert.equal(await snapshot(),before);assert.deepEqual(await page.evaluate(()=>__sirenReviewScan.payloads.at(-1)),{operation:'detect',width:400,height:400,limit:2});
  await page.locator('#siren-missing-add').click();assert.equal((await page.evaluate(()=>BABELIAN_APP.siren.snapshot())).groups.length,3);const appended=JSON.parse(await snapshot());assert.deepEqual(appended.groups.slice(0,2),JSON.parse(before).groups);await page.evaluate(()=>document.getElementById('siren-missing-add').click());assert.equal((await page.evaluate(()=>BABELIAN_APP.siren.snapshot())).groups.length,3);await page.locator('#siren-undo').click();assert.equal(await snapshot(),before);
  // Escape bubbles from the scan button, even while scanning, and late replies
  // from a deliberately non-cooperative worker cannot add a group.
  await selectROI();await page.evaluate(()=>{__sirenReviewScan.hold=true;});await page.locator('#siren-missing-run').click();await page.waitForFunction(()=>!!__sirenReviewScan.release);await page.keyboard.press('Escape');assert(!(await page.locator('#siren-missing-panel').isVisible()));await page.evaluate(reply=>{__sirenReviewScan.release([reply]);__sirenReviewScan.hold=false;},missing);await page.waitForFunction(()=>!document.getElementById('siren-auto-scan').disabled);assert.equal(await snapshot(),before);
  // Reloading an old work file removes full-source provenance, keeps navigation
  // enabled and clearly falls back to highlighting the saved editor crop.
  await page.locator('#siren-work-file').setInputFiles({name:'synthetic-old-work.json',mimeType:'application/json',buffer:Buffer.from(before)});await page.waitForFunction(()=>!document.getElementById('siren-next-pending').disabled);await page.locator('#siren-next-pending').click();assert.match(await page.locator('#siren-pending-status').innerText(),/无此项原图定位/);
  for(const width of [1280,390]){await page.setViewportSize({width,height:960});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');}
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);console.log('PASS browser Siren shortcuts: actual source-pixel highlight, pointer ROI mapping, explicit preview/append/undo, repeated apply, button Escape/late result, old-work fallback, desktop/mobile width. Scanner replies are synthetic; no OCR accuracy claim.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
