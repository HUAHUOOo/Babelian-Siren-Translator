/* Focused real browser check; synthetic work, no private screenshots. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M8AAAICAQB7CY0KAAAAAElFTkSuQmCC';
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:960}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>r.abort());
  await page.goto(pathToFileURL(path.resolve(__dirname,'../index.html')).href);await page.evaluate(()=>BABELIAN_APP.siren.ready);await page.locator('#language-open-siren-translate').click();
  const doc=C.create('review'),g=C.addGroup(doc);g.image=png;C.add(g,'A',{x:300,y:440});
  await page.locator('#siren-work-file').setInputFiles({name:'contact-work.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.locator('#siren-review-toggle').click();await page.locator('#siren-items button').first().click();
  const contact=page.locator('#siren-contact'),popup=page.locator('#siren-precision-panel');await contact.scrollIntoViewIfNeeded();assert.equal(await contact.count(),1);
  const view=await contact.evaluate(n=>{const b=n.getBoundingClientRect(),r=document.querySelector('label[for="siren-radius"]').getBoundingClientRect(),s=getComputedStyle(n);return {above:b.bottom<=r.top,background:s.backgroundColor,color:s.color,accent:getComputedStyle(document.body).getPropertyValue('--accent-strong').trim()};});
  assert(view.above);assert.equal(view.color,'rgb(255, 255, 255)');assert.equal(view.background,'rgb(4, 27, 46)');
  const snapshot=()=>page.evaluate(()=>JSON.stringify(BABELIAN_APP.siren.snapshot())),before=await snapshot();
  await contact.click();assert.match(await contact.textContent(),/再点按钮可取消/);assert.equal(await snapshot(),before);await contact.click();assert.equal(await contact.textContent(),'标记最内侧交点');assert.equal(await snapshot(),before);
  fs.mkdirSync(path.join(__dirname,'qa'),{recursive:true});await popup.screenshot({path:path.join(__dirname,'qa/siren-contact-button-'+width+'.png')});
  await page.locator('#siren-position-lock').click();assert(await contact.isDisabled());await page.locator('#siren-position-lock').click();assert(!(await contact.isDisabled()));
  await contact.click();const stage=page.locator('#siren-stage'),p=F.geometry.basePoints(g)[40];await stage.scrollIntoViewIfNeeded();
  let r=await stage.boundingBox(),box=await popup.boundingBox(),x=r.x+p.x*r.width/600,y=r.y+p.y*r.height/600;if(x>=box.x&&x<=box.x+box.width&&y>box.y-15&&y<=box.y+box.height)await page.evaluate(n=>window.scrollBy(0,n),y-box.y+30);
  r=await stage.boundingBox();await page.mouse.click(r.x+p.x*r.width/600,r.y+p.y*r.height/600);
  const marked=JSON.parse(await snapshot()).groups[0].items[0].contact;assert(marked,await page.locator('#siren-status').textContent());assert(Math.hypot(marked.x-p.x,marked.y-p.y)<10);assert.equal(await contact.textContent(),'标记最内侧交点');
  assert(await popup.evaluate(n=>n.scrollWidth<=n.clientWidth));assert.deepEqual(errors,[]);await page.close();console.log('PASS contact button '+width+'px: above radius, deep-blue/white, toggle is non-mutating, lock guard and actual canvas marking retained.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
