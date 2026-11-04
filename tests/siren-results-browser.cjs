/* Real browser UI checks with public generated art, not unknown-image accuracy QA. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),C=require('../src/siren-core.js'),F=require('./siren-fixture.cjs');
const out=process.env.SIREN_QA_DIR||path.join(__dirname,'qa');fs.mkdirSync(out,{recursive:true});
async function fixture(page,text){
 const doc=C.fromText(text);for(const group of doc.groups){assert(F.geometry.arrange(group));const entries=C.ordered(group,F.geometry.analyze(group));for(const e of entries){const t=e.item;t.contact={x:e.first.x,y:e.first.y};t.fit={rotation:t.rotation,score:.91,candidates:[{letter:t.letter,x:t.x,y:t.y,size:t.size,rotation:t.rotation,score:.91}]};}}
 doc.mode='review';
 const images=await page.evaluate(async({doc,assets})=>{
  const result=[];for(const g of doc.groups){const cv=document.createElement('canvas');cv.width=cv.height=900;const ctx=cv.getContext('2d');ctx.scale(1.5,1.5);ctx.fillStyle='white';ctx.fillRect(0,0,600,600);
   for(const [asset,p]of [[assets.base,{x:g.cx,y:g.cy,size:g.baseSize,rotation:g.baseRotation}],...g.items.map(p=>[assets.letters[p.letter],p])]){const img=new Image();img.src=asset.src;await img.decode();ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.rotation*Math.PI/180);ctx.drawImage(img,-p.size*asset.pivotX,-p.size*asset.height/asset.width*asset.pivotY,p.size,p.size*asset.height/asset.width);ctx.restore();}result.push(cv.toDataURL());}return result;
 },{doc,assets:F.assets});doc.groups.forEach((g,i)=>g.image=images[i]);return doc;
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
 try{for(const width of [1400,390]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[],requests=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.accept());await page.route(/^https?:/,r=>{requests.push(r.request().url());return r.abort();});
  await page.goto(pathToFileURL(process.env.BABELIAN_APP_FILE||path.resolve(__dirname,'../index.html')).href);await page.evaluate(()=>BABELIAN_APP.siren.ready);await page.locator('#language-open-siren-translate').click();
  assert.deepEqual(await page.locator('#panel-siren button:visible').allTextContents(),['粘贴图片','选择图片']);
  const stored=await page.evaluate(()=>JSON.stringify({...localStorage})),snapshot=()=>page.evaluate(()=>JSON.stringify(BABELIAN_APP.siren.snapshot()));
  const load=async doc=>{await page.locator('#siren-work-file').setInputFiles({name:'generated-work.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(doc))});await page.waitForFunction(()=>!document.getElementById('siren-tools').disabled);};
  const doc=await fixture(page,'HELLOWORLD');await load(doc);const original=await snapshot();
  assert(!(await page.locator('#siren-stage').isVisible()));assert(await page.locator('#siren-results').isVisible());assert(!(await page.locator('#siren-raw').isVisible()));assert.equal((await page.locator('#siren-formatted').inputValue()).replace(/[^A-Z]/g,''),'HELLOWORLD');
  // User spacing is valid even when this compound is already a dictionary word.
  await page.locator('#siren-formatted').fill('HELLO WORLD');
  assert.equal(await page.locator('#siren-review-toggle').getAttribute('aria-expanded'),'false');
  await page.locator('#siren-results').screenshot({path:path.join(out,'siren-result-first-'+width+'.png')});
  await page.locator('#siren-formatted').evaluate(n=>{n.focus();n.setSelectionRange(7,7);n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
  assert.match(await page.locator('#siren-location-status').textContent(),/对应 5 个字形/);assert.equal(await page.locator('#siren-location-groups button').count(),2);assert(!(await page.locator('#siren-stage').isVisible()));assert(!(await page.locator('#siren-precision-panel').isVisible()));assert.equal(await snapshot(),original);
  await page.locator('#siren-location-groups button').last().click();assert.equal(await snapshot(),original);
  await page.locator('#siren-location-review').click();assert(await page.locator('#siren-stage').isVisible());assert(await page.locator('#siren-precision-panel').isVisible());assert.equal(await snapshot(),original);
  const popup=page.locator('#siren-precision-panel'),footer=page.locator('.siren-precision-footer');assert(await footer.isVisible());
  const position=await footer.evaluate(n=>{const b=n.getBoundingClientRect(),p=n.closest('#siren-precision-panel').getBoundingClientRect();return {top:b.top,bottom:b.bottom,pTop:p.top,pBottom:p.bottom,height:innerHeight};});assert(position.bottom<=position.pBottom+1&&position.bottom<=position.height+1);assert(position.top>=position.pTop);
  await page.locator('#siren-item-next').click();assert.equal(await snapshot(),original);await page.locator('#siren-item-prev').click();assert.equal(await snapshot(),original);
  await page.screenshot({path:path.join(out,'siren-review-open-'+width+'.png'),fullPage:true});
  await page.locator('#siren-precision-done').click();assert(!(await popup.isVisible()));
  // Selecting art highlights its exact raw letter range without confirming it.
  await page.locator('#siren-items button').first().click();assert.equal(await snapshot(),original);const selected=await page.locator('#siren-raw').evaluate(n=>n.value.slice(n.selectionStart,n.selectionEnd));assert.equal(selected.length,1);
  await page.locator('#siren-zoom-4').click();assert.equal(await snapshot(),original);
  const wrap=page.locator('#siren-stage-wrap');await wrap.scrollIntoViewIfNeeded();const dimensions=await wrap.evaluate(n=>({width:n.clientWidth,height:n.clientHeight,sw:n.scrollWidth,sh:n.scrollHeight}));assert(dimensions.sw>dimensions.width*3.7);assert(dimensions.sh>dimensions.height*3.7);
  const rect=await wrap.boundingBox();await page.mouse.move(rect.x+rect.width*.65,rect.y+Math.min(rect.height*.65,280));await page.mouse.down();await page.mouse.move(rect.x+rect.width*.3,rect.y+90,{steps:5});await page.mouse.up();assert.equal(await snapshot(),original);const scrolled=await wrap.evaluate(n=>[n.scrollLeft,n.scrollTop]);assert(scrolled[0]>0||scrolled[1]>0);
  await page.locator('#siren-zoom-fit').click();assert.equal(await wrap.evaluate(n=>n.scrollLeft),0);assert.equal(await wrap.evaluate(n=>n.scrollTop),0);assert.equal(await snapshot(),original);
  // Overlay, text links and keyboard selection are view-only.
  await page.locator('#siren-items button').first().click();await page.locator('#siren-view-overlay').click();assert.equal(await snapshot(),original);await page.locator('#siren-view-overlay').click();
  await page.locator('#siren-stage').focus();await page.keyboard.press('Z');assert.equal(await snapshot(),original);await page.keyboard.press('ArrowRight');assert.equal(await snapshot(),original);
  // Contact marking: magnifier is read-only until release; cancellation is safe.
  await page.locator('#siren-items button').first().click();await page.locator('#siren-precision-toggle').click();await page.locator('#siren-contact').click();
  const saved=JSON.parse(original),group=saved.groups[1],p=F.geometry.basePoints(group)[70],stage=page.locator('#siren-stage');await stage.scrollIntoViewIfNeeded();
  let b=await stage.boundingBox(),pop=await popup.boundingBox(),x=b.x+p.x*b.width/600,y=b.y+p.y*b.height/600;if(x>=pop.x&&x<=pop.x+pop.width&&y>=pop.y-15)await page.evaluate(n=>scrollBy(0,n),y-pop.y+35);
  b=await stage.boundingBox();x=b.x+p.x*b.width/600;y=b.y+p.y*b.height/600;
  await page.mouse.move(x,y);await page.mouse.down();assert(await page.locator('#siren-contact-lens').isVisible());assert.equal(await snapshot(),original);
  await page.locator('#siren-contact-lens').screenshot({path:path.join(out,'siren-contact-lens-'+width+'.png')});
  await page.keyboard.press('Escape');await page.mouse.up();assert.equal(await snapshot(),original);assert(!(await page.locator('#siren-contact-lens').isVisible()));
  await page.locator('#siren-zoom-2').click();await page.locator('#siren-precision-toggle').click();await page.locator('#siren-contact').click();await stage.scrollIntoViewIfNeeded();b=await stage.boundingBox();pop=await popup.boundingBox();x=b.x+p.x*b.width/600;y=b.y+p.y*b.height/600;if(x>=pop.x&&x<=pop.x+pop.width&&y>=pop.y-15)await page.evaluate(n=>scrollBy(0,n),y-pop.y+35);
  b=await stage.boundingBox();await page.mouse.click(b.x+p.x*b.width/600,b.y+p.y*b.height/600);const marked=JSON.parse(await snapshot()),contact=marked.groups[1].items[0].contact;assert(contact&&Math.hypot(contact.x-p.x,contact.y-p.y)<2,'Zoomed marking must retain logical coordinates');const expected=JSON.parse(original);expected.groups[1].items[0].contact=contact;assert.deepEqual(marked,expected,'Only the explicit contact is edited');await page.locator('#siren-precision-done').click();await page.locator('#siren-undo').click();assert.equal(await snapshot(),original);await page.locator('#siren-zoom-fit').click();
  // Explicit adjustment still moves and is undoable; viewing never does.
  await page.locator('#siren-items button').first().click();await page.locator('#siren-edit-mode').click();await stage.scrollIntoViewIfNeeded();b=await stage.boundingBox();const target=JSON.parse(original).groups[1].items[0];x=b.x+target.x*b.width/600;y=b.y+target.y*b.height/600;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+12,y+8,{steps:3});await page.mouse.up();assert.notEqual(await snapshot(),original);await page.locator('#siren-undo').click();assert.equal(await snapshot(),original);
  await page.locator('#siren-view-mode').click();await page.locator('#siren-review-toggle').click();assert(!(await stage.isVisible()));
  // Numbers trace to source words, and manual content changes cannot fabricate links.
  await load(await fixture(page,'FIFTY'));assert.equal(await page.locator('#siren-formatted').inputValue(),'50');await page.locator('#siren-formatted').evaluate(n=>{n.setSelectionRange(0,0);n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});assert.match(await page.locator('#siren-location-status').textContent(),/对应 5 个字形/);
  await page.locator('#siren-formatted').fill('51');await page.locator('#siren-formatted').evaluate(n=>{n.setSelectionRange(0,0);n.dispatchEvent(new MouseEvent('click',{bubbles:true}));});assert.match(await page.locator('#siren-location-status').textContent(),/无法可靠定位/);assert(await page.locator('#siren-location-review').isDisabled());
  await page.locator('#siren-format').click();assert.equal(await page.locator('#siren-formatted').inputValue(),'50');
  await page.locator('#language-back').click();await page.locator('#language-open-siren-translate').click();assert.equal(await page.locator('#siren-formatted').inputValue(),'50');
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage})),stored);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  await page.screenshot({path:path.join(out,'siren-final-'+width+'.png'),fullPage:true});console.log('PASS '+width+'px: result-first/collapsed review, cross-group/number links both ways, view/zoom/pan immutability, overlay, keyboard safety, fixed mobile footer, lens cancel/mark/undo, explicit edit/undo, stale-text refusal, state retention, no network/errors/overflow.');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
