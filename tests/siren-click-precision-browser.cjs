/* Actual desktop/mobile pointer regression using public, generated artwork.
 * This verifies interaction and work preservation, not OCR accuracy. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs');
const output=process.env.SIREN_QA_DIR||path.join(__dirname,'qa');
async function workFixture(page){
 const doc=C.create('review'),g=C.addGroup(doc),points=F.geometry.basePoints(g);
 for(const [n,letter,x,y] of [[0,'A',220,210],[1,'B',420,330],[2,'C',220,450]]){
  const t=C.add(g,letter,{x,y});t.contact={x:points[200+n*700].x,y:points[200+n*700].y};
  t.fit={score:.9,rotation:t.rotation,candidates:[{letter,x,y,size:t.size,rotation:t.rotation,score:.9}]};
  if(n===1)t.positionLocked=true;if(n===2)t.letter=null;
 }
 g.image=await page.evaluate(async({g,assets})=>{
  const cv=document.createElement('canvas');cv.width=cv.height=900;const ctx=cv.getContext('2d');ctx.scale(1.5,1.5);ctx.fillStyle='white';ctx.fillRect(0,0,600,600);
  for(const [a,p] of [[assets.base,{x:g.cx,y:g.cy,size:g.baseSize,rotation:g.baseRotation}],...g.items.map(t=>[assets.letters[t.letter||t.fit.candidates[0].letter],t])]){
   const img=new Image();img.src=a.src;await img.decode();ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(img,-p.size*a.pivotX,-p.size*a.height/a.width*a.pivotY,p.size,p.size*a.height/a.width);ctx.restore();
  }return cv.toDataURL();
 },{g,assets:F.assets});return doc;
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000},hasTouch:width===390,acceptDownloads:true}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(process.env.BABELIAN_APP_FILE||path.resolve(__dirname,'../index.html')).href);await page.evaluate(()=>BABELIAN_APP.siren.ready);await page.locator('#language-open-siren-translate').click();
  assert.deepEqual(await page.locator('#panel-siren button:visible').allTextContents(),['粘贴图片','选择图片']);assert.equal(await page.locator('#siren-precision-toggle').count(),0);
  const doc=await workFixture(page),group=doc.groups[0];
  await page.locator('#siren-work-file').setInputFiles({name:'click-work.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.waitForFunction(()=>!document.getElementById('siren-tools').disabled);await page.locator('#siren-review-toggle').click();
  const stage=page.locator('#siren-stage'),wrap=page.locator('#siren-stage-wrap'),popup=page.locator('#siren-precision-panel'),items=page.locator('#siren-items button'),selected=page.locator('#siren-items button[aria-pressed=true]');
  const snapshot=()=>page.evaluate(()=>JSON.stringify(BABELIAN_APP.siren.snapshot())),original=await snapshot();
  const closed=async()=>assert(!(await popup.isVisible())),opened=async()=>assert(await popup.isVisible());
  const close=async(id='close')=>{await page.locator('#siren-precision-'+id).click();await closed();};
  const aim=async t=>{
   await wrap.evaluate((w,t)=>{const c=w.querySelector('canvas');w.scrollLeft=t.x*c.clientWidth/600-w.clientWidth/2;w.scrollTop=t.y*c.clientHeight/600-w.clientHeight/2;},t);
   await wrap.scrollIntoViewIfNeeded();const b=await stage.boundingBox();return {x:b.x+t.x*b.width/600,y:b.y+t.y*b.height/600};
  };
  const tap=async t=>{const p=await aim(t);await page.mouse.move(p.x,p.y);await page.mouse.down();await closed();await page.mouse.up();await opened();};
  // Buttons (including unknown and locked) directly open one live window.
  await closed();for(let i=0;i<3;i++){await items.nth(i).click();await opened();assert.equal(await selected.getAttribute('aria-expanded'),'true');assert.equal(await selected.getAttribute('aria-haspopup'),'dialog');assert.equal(await snapshot(),original);}
  assert.match(await page.locator('#siren-selection').textContent(),/待确认/);await close('done');assert(await selected.evaluate(n=>n===document.activeElement));
  await items.first().focus();await page.keyboard.press('Enter');await opened();await page.keyboard.press('Escape');await closed();assert(await selected.evaluate(n=>n===document.activeElement));
  // A tap opens on release; neither selection nor closing changes saved work.
  for(const t of group.items){await tap(t);assert.equal(Number(await page.locator('#siren-radius').inputValue()),Math.round(C.radius(group,t)*10)/10);await close();assert.equal(await page.evaluate(()=>document.activeElement.id),'siren-stage');assert.equal(await snapshot(),original);}
  // Zoom/pan that starts on a glyph, including moving out and back, never opens.
  for(const z of [2,4]){
   await page.locator('#siren-zoom-'+z).click();const p=await aim(group.items[0]),beforeScroll=await wrap.evaluate(w=>[w.scrollLeft,w.scrollTop]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x-30,p.y-20,{steps:4});await page.mouse.up();await closed();assert.equal(await snapshot(),original);const afterScroll=await wrap.evaluate(w=>[w.scrollLeft,w.scrollTop]);assert.notDeepEqual(afterScroll,beforeScroll);
   const q=await aim(group.items[0]);await page.mouse.move(q.x,q.y);await page.mouse.down();await page.mouse.move(q.x-20,q.y,{steps:2});await page.mouse.move(q.x,q.y,{steps:2});await page.mouse.up();await closed();assert.equal(await snapshot(),original);
   await tap(group.items[0]);await close();
  }
  await page.locator('#siren-zoom-fit').click();
  // Canceled/lost pointers cannot be interpreted as a confirmed tap.
  for(const type of ['pointercancel','lostpointercapture']){
   const p=await aim(group.items[0]);await page.mouse.move(p.x,p.y);await page.mouse.down();await stage.dispatchEvent(type,{pointerId:1});await page.mouse.up();
   await closed();assert.equal(await snapshot(),original);
  }
  // Editing still drags and undoes; a locked glyph cannot move but can be tapped.
  await page.locator('#siren-edit-mode').click();let p=await aim(group.items[0]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+14,p.y+8,{steps:3});await page.mouse.up();await closed();assert.notEqual(await snapshot(),original);await page.locator('#siren-undo').click();assert.equal(await snapshot(),original);
  p=await aim(group.items[1]);await page.mouse.move(p.x,p.y);await page.mouse.down();await page.mouse.move(p.x+25,p.y+10,{steps:3});await page.mouse.up();await closed();assert.equal(await snapshot(),original);await tap(group.items[1]);assert(await page.locator('#siren-radius').isDisabled());await close();await tap(group.items[0]);await close();
  // Contact marking keeps its own gesture rather than reopening after Escape.
  await items.first().click();await page.locator('#siren-contact').click();await page.keyboard.press('Escape');await closed();assert.equal(await snapshot(),original);
  await page.locator('#siren-view-mode').click();
  if(width===390){const p=await aim(group.items[2]);await page.touchscreen.tap(p.x,p.y);await opened();assert.match(await page.locator('#siren-selection').textContent(),/待确认/);await close();}
  // Reading English remains read-only; clicking a glyph in its image also opens.
  await page.locator('#siren-review-toggle').click();await closed();
  await page.locator('#siren-raw').evaluate(n=>{n.setSelectionRange(0,0);n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});await closed();assert(!(await stage.isVisible()));
  const preview=page.locator('#siren-location-preview');await preview.scrollIntoViewIfNeeded();const box=await preview.boundingBox();await preview.click({position:{x:group.items[0].x*box.width/600,y:group.items[0].y*box.height/600}});await opened();assert(await stage.isVisible());assert.equal(await snapshot(),original);await close();
  await items.last().click();await opened();assert.match(await page.locator('#siren-selection').textContent(),/待确认/);
  fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'siren-direct-precision-'+width+'.png'),fullPage:true});
  assert.equal(await snapshot(),original);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);await page.close();
  console.log('PASS direct precision '+width+'px: button/unknown/locked taps, canvas release, 2x/4x pan and out/back, pointer cancellation, edit/undo, focus, saved work, no network/errors/overflow.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
