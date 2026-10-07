/* Pixels stay on device. Online translation is a separate, explicit text-only
   opt-in; only "append to writer" enters local/ATO draft persistence. */
globalThis.BabelianOCRUI={
  // Pending status is the same as the orange review tiles; mapping and the
  // displayed candidate letter are deliberately irrelevant here.
  pending(result){
    const items=[];
    result?.lines.forEach((row,line)=>row.tokens.forEach((t,token)=>{
      if(!(t.id&&(t.manual||t.certain)))items.push({line,token});
    }));
    return items;
  },
  pendingNeighbor(result,position,direction=1){
    const items=this.pending(result),before=(a,b)=>a.line<b.line||a.line===b.line&&a.token<b.token;
    if(!items.length)return null;
    if(!position)return direction<0?items.at(-1):items[0];
    const others=items.filter(p=>p.line!==position.line||p.token!==position.token);
    if(!others.length)return null;
    return direction<0?others.filter(p=>before(p,position)).at(-1)||others.at(-1):others.find(p=>before(position,p))||others[0];
  },
  // Left/right follow reading order; up/down follow the actual thumbnail
  // layout, including wrapped rows. Geometry is presentation-only.
  neighbor(items,position,key){
    const at=items.findIndex(item=>item.line===position.line&&item.token===position.token);
    if(at<0)return null;
    const location=item=>item?{line:item.line,token:item.token}:null;
    if(key==='ArrowLeft'||key==='ArrowRight')return location(items[at+(key==='ArrowLeft'?-1:1)]);
    if(key!=='ArrowUp'&&key!=='ArrowDown')return null;
    const current=items[at].rect;
    if(!current)return null;
    const up=key==='ArrowUp',candidates=items.filter(item=>item.rect&&item.rect.width>0&&item.rect.height>0&&
      (up?item.rect.bottom<=current.top+1:item.rect.top>=current.bottom-1));
    if(!candidates.length)return null;
    const gap=item=>up?current.top-item.rect.bottom:item.rect.top-current.bottom;
    const nearest=Math.min(...candidates.map(gap)),center=(current.left+current.right)/2;
    const distance=item=>Math.abs((item.rect.left+item.rect.right)/2-center);
    return location(candidates.filter(item=>gap(item)<=nearest+1).reduce((best,item)=>distance(item)<distance(best)?item:best));
  },
  mount({glyphs,wordData,getMapping,editMapping,append,notify}){
  const $=id=>document.getElementById(id),OCR=BabelianOCR,Work=BabelianOCRWork,ids=Object.keys(glyphs);
  const panel=$('panel-decode'),preview=$('ocr-preview'),ctx=preview.getContext('2d');
  let source=null,crop=null,result=null,resultImage=null,selected=null,drag=null,rebox=null;
  let templatesPromise=null,templates=null,prepared=null,worker=null,job=0,loading=0,busy=false;
  let deepSuggestion=null,splitToken=null,reviewContext=null;
  const formatter=BabelianTextFormat.create(wordData),formattedDraft=BabelianTextFormat.createDraft(formatter);
  const translation=BabelianTranslation.createSession(BabelianTranslation.createClient(),renderTranslation);
  const label=id=>'G'+String(ids.indexOf(id)+1).padStart(2,'0');
  const mapping=()=>getMapping();
  // Preserve the previous automatic defaults without exposing tuning controls.
  const options=()=>({polarity:'auto',threshold:null,oneLine:false,detail:true});
  const outputOptions=()=>({joinLines:$('ocr-join').checked});
  function message(text){$('ocr-status').textContent=text;}
  function imageElement(id){const img=document.createElement('img');img.src=glyphs[id].src;img.alt=label(id);return img;}
  function setBusy(value){busy=value;$('ocr-run').disabled=value||!source;$('ocr-cancel').hidden=!value;$('ocr-controls').disabled=value;$('ocr-deep').disabled=value;panel.setAttribute('aria-busy',String(value));syncReviewControls();}
  function cancel(){job++;if(worker){worker.terminate();worker=null;}setBusy(false);}
  function clearResult(){
    formattedDraft.clear();$('ocr-formatted').value='';$('ocr-format-status').textContent='';
    translation.invalidate('识别结果已清除，请重新整理后翻译。');endRebox();
    result=null;resultImage=null;selected=null;deepSuggestion=null;$('ocr-deep-candidates').replaceChildren();$('ocr-deep-status').textContent='';$('ocr-results').hidden=true;$('ocr-review').hidden=true;$('ocr-inspection').hidden=true;
    setReviewOpen(false);setSegmentationOpen(false);$('ocr-output-note').textContent='';
    $('ocr-pending-only').checked=false;$('ocr-filter-empty').hidden=true;syncReviewControls();
    setTranslationOpen(false);
    $('ocr-output').value='';$('ocr-tokens').replaceChildren();$('ocr-candidates').replaceChildren();
    $('ocr-piece').width=1;$('ocr-piece').height=1;$('ocr-choice-image').removeAttribute('src');
    reviewContext=null;$('ocr-context').width=1;$('ocr-context').height=1;
    $('ocr-split-preview').width=1;$('ocr-split-preview').height=1;
  }
  function changeCrop(next){
    if(!source||busy)return;
    const x=Math.max(0,Math.min(source.width-1,Math.round(next.x))),y=Math.max(0,Math.min(source.height-1,Math.round(next.y)));
    crop={x,y,width:Math.max(1,Math.min(source.width-x,Math.round(next.width))),height:Math.max(1,Math.min(source.height-y,Math.round(next.height)))};
    clearResult();draw();message('框选区域已更新。点击“识别所选区域”。');
  }
  function draw(){
    if(!source)return;
    if(preview.width!==source.width||preview.height!==source.height){preview.width=source.width;preview.height=source.height;}
    ctx.clearRect(0,0,preview.width,preview.height);ctx.drawImage(source,0,0);
    const scale=preview.width/Math.max(1,preview.clientWidth),line=Math.max(1,scale*1.4);
    ctx.fillStyle='#10241d88';
    ctx.fillRect(0,0,preview.width,crop.y);ctx.fillRect(0,crop.y+crop.height,preview.width,preview.height-crop.y-crop.height);
    ctx.fillRect(0,crop.y,crop.x,crop.height);ctx.fillRect(crop.x+crop.width,crop.y,preview.width-crop.x-crop.width,crop.height);
    ctx.strokeStyle='#a57b37';ctx.lineWidth=line;ctx.strokeRect(crop.x,crop.y,crop.width,crop.height);
    const parts=splitPreview();
    if(result)result.lines.forEach((row,li)=>row.tokens.forEach((token,ti)=>{
      const current=selected?.line===li&&selected?.token===ti,b=token.box;
      if(current&&parts)return;
      ctx.strokeStyle=current?'#1768dc':token.manual||token.certain?'#188041':'#c86613';
      ctx.strokeRect(crop.x+b.x,crop.y+b.y,b.width,b.height);
    }));
    if(parts)drawSplitBoxes(ctx,parts,crop.x,crop.y,scale);
    if(rebox?.box){const b=rebox.box;ctx.save();ctx.strokeStyle='#1768dc';ctx.lineWidth=line*2;ctx.setLineDash([scale*5,scale*3]);ctx.strokeRect(crop.x+b.x,crop.y+b.y,b.width,b.height);ctx.restore();}
  }
  function point(e){const r=preview.getBoundingClientRect();return {x:Math.max(0,Math.min(source.width,(e.clientX-r.left)*source.width/r.width)),y:Math.max(0,Math.min(source.height,(e.clientY-r.top)*source.height/r.height))};}
  preview.addEventListener('pointerdown',e=>{if(!source||busy||e.button!==0)return;if(rebox){rebox.box=null;$('ocr-rebox-apply').disabled=true;}drag={start:point(e),last:point(e)};preview.setPointerCapture(e.pointerId);});
  preview.addEventListener('pointermove',e=>{
    if(!drag)return;drag.last=point(e);draw();ctx.strokeStyle='#1768dc';ctx.strokeRect(drag.start.x,drag.start.y,drag.last.x-drag.start.x,drag.last.y-drag.start.y);
  });
  preview.addEventListener('pointerup',e=>{
    if(!drag)return;const start=drag.start,end=point(e);drag=null;
    if(rebox){
      try{
        rebox.box=BabelianOCRCorrection.rectangle(start,end,crop);$('ocr-rebox-apply').disabled=false;
        const hits=BabelianOCRCorrection.overlaps(result,rebox.position,rebox.box).filter(hit=>hit.rematch);
        const old=active(),freed=BabelianOCRCorrection.released(imageMask(BabelianOCRCorrection.exclusionsFor([old])),old.box,rebox.box);
        $('ocr-rebox-status').textContent=`新框 ${rebox.box.width} × ${rebox.box.height} 像素。`+
          (freed.left+freed.right?'旧框有笔画移出新框，会与本行邻近项一起重新识别。':'')+
          (hits.length?`覆盖本行 ${hits.length} 个其他识别框超过20%，会重新匹配附近字形。`:freed.left+freed.right?'':'仅替换当前项。')+'确认框住完整字形后，点击“应用新框”。';
      }
      catch(error){$('ocr-rebox-status').textContent=error.message;}draw();return;
    }
    if(Math.abs(end.x-start.x)>5&&Math.abs(end.y-start.y)>5)changeCrop({x:Math.min(start.x,end.x),y:Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)});
    else if(result){
      for(const [li,row] of result.lines.entries())for(const [ti,t] of row.tokens.entries()){
        const b=t.box;if(end.x>=crop.x+b.x&&end.x<crop.x+b.x+b.width&&end.y>=crop.y+b.y&&end.y<crop.y+b.y+b.height){select(li,ti);return;}
      }
      closeReview();
    }draw();
  });
  preview.addEventListener('pointercancel',()=>{drag=null;draw();});
  function endRebox(){
    rebox=null;drag=null;$('ocr-rebox-bar').hidden=true;preview.classList.remove('reboxing');
  }
  $('ocr-rebox').addEventListener('click',()=>{
    if(!active()||busy)return;
    resetSplitPreview();rebox={position:{...selected},box:null};drag=null;
    $('ocr-rebox-bar').hidden=false;$('ocr-rebox-apply').disabled=true;preview.classList.add('reboxing');
    $('ocr-rebox-status').textContent=`正在重新框选第 ${selected.line+1} 行第 ${selected.token+1} 项：请在截图上拖动。`;
    setEditorVisible(false);syncReviewControls();
    $('ocr-rebox-bar').scrollIntoView({block:'start'});$('ocr-rebox-cancel').focus({preventScroll:true});draw();
  });
  function cancelRebox(){endRebox();renderReview();$('ocr-review').querySelector('.ocr-review-body').scrollTop=0;syncReviewControls();revealSelected();draw();message('已取消重新框选，原识别框保持不变。');}
  $('ocr-rebox-cancel').addEventListener('click',cancelRebox);
  document.addEventListener('keydown',e=>{if(!panel.hidden&&rebox&&e.key==='Escape'){e.preventDefault();cancelRebox();}});
  $('ocr-rebox-apply').addEventListener('click',()=>{
    if(!rebox?.box||busy)return;
    try{
      const position={...rebox.position};
      const update=BabelianOCRCorrection.replace(OCR,result,position,rebox.box,resultImage,prepared);
      endRebox();selected=update.position;renderResults();draw();
      const warning=update.overlap.length?'部分框仍有几何交叠，请核对裁片（已分配给新框的像素不会重复识别）。':'';
      const detail=update.rematched?`已按新框重新分割本行局部区域：${update.replaced} 个旧项更新为 ${update.generated} 项（含新框）。新框及附近候选需重新确认；其他区域和映射未改变。`:'已替换当前字形框，其他项未改动。请确认新候选。';
      message(detail+warning);notify(detail+warning);
      $('ocr-review').querySelector('.ocr-review-body').scrollTop=0;revealSelected();
      $('ocr-choice').focus({preventScroll:true});
    }catch(error){$('ocr-rebox-status').textContent=error.message;}
  });
  async function loadFile(file){
    if(!file)return;
    if(!/^image\/(png|jpeg|webp)$/.test(file.type)&&!(/\.(png|jpe?g|webp)$/i.test(file.name)&&!file.type)){message('请选择 PNG、JPG 或 WebP 图片。');return;}
    if(file.size>16*1024*1024){message('图片超过16MB，请先裁剪或压缩。');return;}
    if(result&&!confirm('载入新图将清除本次识别和手动校正（不会清除书写区或映射）。继续吗？'))return;
    const version=++loading;cancel();setBusy(true);message('正在读取图片…');
    const url=URL.createObjectURL(file),img=new Image();
    try{
      await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('图片无法读取，请换一张截图。'));img.src=url;});
      if(version!==loading)return;
      if(img.naturalWidth*img.naturalHeight>40000000)throw Error('图片尺寸过大，请先裁剪。');
      const scale=Math.min(1,2200/img.naturalWidth,Math.sqrt(6000000/(img.naturalWidth*img.naturalHeight)));
      source=document.createElement('canvas');source.width=Math.max(1,Math.round(img.naturalWidth*scale));source.height=Math.max(1,Math.round(img.naturalHeight*scale));
      source.getContext('2d').drawImage(img,0,0,source.width,source.height);
      crop={x:0,y:0,width:source.width,height:source.height};clearResult();$('ocr-image-area').hidden=false;
      $('ocr-file-info').textContent=`${file.name} · ${source.width} × ${source.height}${scale<1?'（已缩小，请优先上传裁剪后的原尺寸密码图）':''}`;
      $('ocr-run').disabled=false;draw();message('请拖动框选纯巴别语区域，排除英文、标题、插图和边框。');
    }catch(e){if(version===loading)message(e.message);}
    finally{URL.revokeObjectURL(url);$('ocr-file').value='';if(version===loading)setBusy(false);}
  }
  $('ocr-upload').addEventListener('click',()=>$('ocr-file').click());
  $('ocr-file').addEventListener('change',e=>loadFile(e.target.files[0]));
  panel.addEventListener('dragover',e=>{e.preventDefault();});
  panel.addEventListener('drop',e=>{e.preventDefault();if(!busy)loadFile(e.dataTransfer.files[0]);});
  document.addEventListener('paste',e=>{if(panel.hidden||busy)return;const file=[...e.clipboardData.items].find(i=>i.kind==='file'&&i.type.startsWith('image/'))?.getAsFile();if(file){e.preventDefault();loadFile(file);}});
  async function loadTemplates(prepare=true){
    if(!templatesPromise)templatesPromise=Promise.all(ids.map(id=>new Promise((resolve,reject)=>{
      const img=new Image();img.onload=()=>{
        try{
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;const c=canvas.getContext('2d');c.drawImage(img,0,0);
        const rgba=c.getImageData(0,0,canvas.width,canvas.height).data,data=new Uint8Array(canvas.width*canvas.height);
        for(let i=0;i<data.length;i++)data[i]=Number(rgba[i*4+3]>=128);
        resolve({id,width:canvas.width,height:canvas.height,data});
        }catch(e){reject(Error('无法读取本地字形模板：'+e.message));}
      };img.onerror=()=>reject(Error('字形模板载入失败，请检查素材是否完整。'));img.src=glyphs[id].src;
    }))).catch(e=>{templatesPromise=null;throw e;});
    templates=await templatesPromise;if(prepare)prepared=OCR.prepareTemplates(templates,options());return templates;
  }
  function progress(p){message(`正在按图形匹配${p.pass>1?'（细笔画复核）':''}：${p.done} / ${p.total} 行…`);}
  async function recognize(){
    if(!source||busy)return;
    if(result&&!confirm('重新识别会替换本次结果和手动校正，继续吗？'))return;
    clearResult();setBusy(true);const version=++job;message('正在准备字形模板…');
    try{
      await loadTemplates();if(version!==job)return;
      resultImage=source.getContext('2d').getImageData(crop.x,crop.y,crop.width,crop.height);
      let answer;
      // Blob workers support the offline single-file build. If unavailable, keep
      // the same engine and yield between lines; never send pixels to a service.
      if(typeof Worker!=='undefined'){
        let url;
        try{url=URL.createObjectURL(new Blob([OCR.workerSource()],{type:'text/javascript'}));worker=new Worker(url);}catch(_){worker=null;}finally{if(url)URL.revokeObjectURL(url);}
      }
      if(worker){
        try{answer=await new Promise((resolve,reject)=>{
          worker.onmessage=e=>{if(version!==job)return;if(e.data.progress)progress(e.data.progress);else if(e.data.error)reject(Error(e.data.error));else resolve(e.data.result);};
          worker.onerror=()=>reject(Error('本地识别进程无法启动。'));
          worker.postMessage({image:resultImage,templates,options:options()});
        });}catch(e){
          if(version!==job)return;worker?.terminate();worker=null;message('正在使用兼容模式识别…');
          answer=await OCR.recognize(resultImage,templates,{...options(),cancelled:()=>version!==job},p=>{if(version===job)progress(p);});
        }
      }else answer=await OCR.recognize(resultImage,templates,{...options(),cancelled:()=>version!==job},p=>{if(version===job)progress(p);});
      if(version!==job)return;result=answer;selected=null;renderResults();draw();
      if(!result.lines.length)message('未找到有效字形行。请检查框选范围及图片清晰度。');
      else message(`识别完成，共 ${result.lines.length} 行。${result.polarity==='dark'?'深字浅底':'浅字深底'}，阈值 ${result.threshold}。请复核橙色项目及分割边界。`);
    }catch(e){if(version===job){message('识别失败：'+e.message);clearResult();}}
    finally{if(version===job){worker?.terminate();worker=null;setBusy(false);if(result?.lines.length)$('ocr-results').scrollIntoView({block:'start'});}}
  }
  $('ocr-run').addEventListener('click',recognize);
  $('ocr-cancel').addEventListener('click',()=>{loading++;cancel();message('已取消。可以调整框选后重新识别。');});
  function renderResults(){
    if(!result)return;
    const map=mapping(),list=$('ocr-tokens'),scroll=list.scrollTop;list.replaceChildren();let unknown=0,total=0,noCandidate=0;
    result.lines.forEach((line,li)=>{
      const row=document.createElement('div');row.className='ocr-token-line';const title=document.createElement('span');title.className='ocr-row-label';title.textContent=`第 ${li+1} 行`;row.append(title);
      line.tokens.forEach((token,ti)=>{
        total++;const id=OCR.tokenGlyph(token),accepted=token.id&&(token.manual||token.certain),reading=OCR.tokenReading(token,map);if(!accepted)unknown++;if(!id)noCandidate++;
        if($('ocr-pending-only').checked&&accepted)return;
        const b=document.createElement('button');b.type='button';b.className='ocr-token';b.dataset.line=li;b.dataset.token=ti;b.classList.toggle('uncertain',!accepted);b.classList.toggle('unmapped',!!accepted&&!map[id]);b.setAttribute('aria-pressed',String(selected?.line===li&&selected?.token===ti));
        const top=document.createElement('span');top.textContent=`${ti+1} · ${id?label(id):'未知'}`;
        if(id)b.append(imageElement(id));
        const text=document.createElement('strong');text.textContent=reading;b.append(top,text);
        b.title=`第${li+1}行第${ti+1}项 · ${token.manual?'已人工确认':accepted?'自动匹配，仍建议复核':'待确认'} · 点击核对原图`;
        b.addEventListener('click',()=>select(li,ti));row.append(b);
      });if(row.children.length>1)list.append(row);
    });
    $('ocr-results').hidden=!total;$('ocr-inspection').hidden=!total;
    $('ocr-output').value=OCR.transcribe(result,map,outputOptions());
    $('ocr-output-note').textContent=unknown?`${unknown} 项尚待确认，已有候选先按当前映射输出${noCandidate?`；${noCandidate} 项无候选，显示 [?]`:''}。需要时展开逐字复核。`:'已按当前映射输出。需要校正时，可展开逐字复核。';
    refreshFormatted();
    list.scrollTop=scroll;
    $('ocr-filter-empty').hidden=!$('ocr-pending-only').checked||unknown>0||list.hidden;
    syncReviewControls();if(selected)renderReview();else setEditorVisible(false);
  }
  function focusSelected(){
    if(!selected)return;
    $('ocr-tokens').querySelector(`[data-line="${selected.line}"][data-token="${selected.token}"]`)?.focus({preventScroll:true});
  }
  function select(line,token){
    if(!result?.lines[line]?.tokens[token])return;
    const changed=$('ocr-review').hidden||selected?.line!==line||selected?.token!==token;
    const t=result.lines[line].tokens[token];
    // An explicit source-box selection must remain visible even under a filter.
    if(t.id&&(t.manual||t.certain))$('ocr-pending-only').checked=false;
    endRebox();if(changed)resetSplitPreview();selected={line,token};setReviewOpen(true);renderResults();
    if(changed)$('ocr-review').querySelector('.ocr-review-body').scrollTop=0;
    draw();focusSelected();revealSelected();
  }
  function revealSelected(){
    if(!selected||$('ocr-tokens').hidden)return;
    const list=$('ocr-tokens'),button=list.querySelector(`[data-line="${selected.line}"][data-token="${selected.token}"]`);
    if(!button)return;
    let outer=list.getBoundingClientRect();const inner=button.getBoundingClientRect();
    if(inner.top<outer.top)list.scrollTop+=inner.top-outer.top;
    else if(inner.bottom>outer.bottom)list.scrollTop+=inner.bottom-outer.bottom;
    // The sheet never hides the active review list. Once positioned, successive
    // arrows scroll only the list, not the document or the fixed editor.
    if(matchMedia('(max-width:1000px)').matches&&!$('ocr-review').hidden){
      outer=list.getBoundingClientRect();const ceiling=$('ocr-review').getBoundingClientRect().top-16;
      if(outer.top<16||outer.bottom>ceiling)window.scrollBy(0,outer.top-16);
    }
  }
  function setEditorVisible(open){
    $('ocr-review').hidden=!open;panel.classList.toggle('ocr-review-active',open);
  }
  function syncReviewControls(){
    const items=BabelianOCRUI.pending(result),at=selected?items.findIndex(p=>p.line===selected.line&&p.token===selected.token):-1;
    const text=!items.length?'无待确认项':at>=0?`待确认 ${at+1} / ${items.length}`:`剩余 ${items.length} 项待确认`;
    $('ocr-pending-status').textContent=text;$('ocr-review-position').textContent=text;
    for(const id of ['ocr-confirm','ocr-confirm-next','ocr-choice','ocr-unknown','ocr-rebox'])$(id).disabled=busy||!!rebox||!active();
    syncSplitControls();
    $('ocr-merge').disabled=busy||!!rebox||!active()||selected.token>=result.lines[selected.line].tokens.length-1;
    $('ocr-pending-only').disabled=busy||!!rebox;
  }
  function setReviewOpen(open){
    $('ocr-tokens').hidden=!open;$('ocr-review-toggle').setAttribute('aria-expanded',String(open));
    $('ocr-review-toggle').textContent=open?'收起逐字复核':'展开逐字复核';
    $('ocr-filter-empty').hidden=!open||!$('ocr-pending-only').checked||BabelianOCRUI.pending(result).length>0;
    if(!open)closeReview();
  }
  function setSegmentationOpen(open){
    resetSplitPreview();$('ocr-segmentation').hidden=!open;$('ocr-segmentation-toggle').setAttribute('aria-expanded',String(open));
    syncSplitControls();drawReviewContext();draw();
  }
  function closeReview(){
    endRebox();resetSplitPreview();selected=null;deepSuggestion=null;reviewContext=null;setEditorVisible(false);
    $('ocr-deep-candidates').replaceChildren();$('ocr-deep-status').textContent='';
    $('ocr-tokens').querySelectorAll('[aria-pressed="true"]').forEach(b=>b.setAttribute('aria-pressed','false'));syncReviewControls();draw();
  }
  $('ocr-review-toggle').addEventListener('click',()=>setReviewOpen($('ocr-tokens').hidden));
  $('ocr-pending-only').addEventListener('change',()=>{
    setReviewOpen(true);
    if($('ocr-pending-only').checked&&active()?.id&&(active().manual||active().certain))closeReview();
    renderResults();focusSelected();revealSelected();
  });
  $('ocr-review-close').addEventListener('click',()=>{const position=selected&&{...selected};closeReview();if(position)$('ocr-tokens').querySelector(`[data-line="${position.line}"][data-token="${position.token}"]`)?.focus({preventScroll:true});});
  $('ocr-segmentation-toggle').addEventListener('click',()=>setSegmentationOpen($('ocr-segmentation').hidden));
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&!e.defaultPrevented&&!busy&&!rebox&&!panel.closest('[hidden]')&&selected){e.preventDefault();$('ocr-review-close').click();return;}
    if(!/^Arrow(Left|Right|Up|Down)$/.test(e.key)||e.defaultPrevented||e.isComposing||e.altKey||e.ctrlKey||e.metaKey||e.shiftKey||
      panel.closest('[hidden]')||busy||rebox||drag||!active()||$('ocr-tokens').hidden||$('ocr-review').hidden)return;
    const target=e.target;
    // Editing and native select/range/number controls keep their arrow keys.
    if(target.isContentEditable||target.closest?.('input,textarea,select,[role="textbox"]')||target!==document.body&&!panel.contains(target))return;
    e.preventDefault();
    const items=[...$('ocr-tokens').querySelectorAll('.ocr-token')].map(button=>({line:Number(button.dataset.line),token:Number(button.dataset.token),rect:button.getBoundingClientRect()}));
    const next=BabelianOCRUI.neighbor(items,selected,e.key);if(!next)return;
    select(next.line,next.token);
  });
  document.addEventListener('click',e=>{
    if(!selected||panel.hidden||busy||rebox)return;
    // Blank areas dismiss the editor. Controls, comparison images and screenshot
    // gestures keep their own behavior; candidate selection is only a preview.
    if(e.target.closest('button,a,input,select,textarea,summary,label,figure,#ocr-preview,#ocr-rebox-bar'))return;
    closeReview();
  });
  function active(){return selected&&result?.lines[selected.line]?.tokens[selected.token];}
  function resetSplitPreview(){splitToken=null;$('ocr-split-at').value='50';}
  function syncSplitControls(){
    const token=active(),slider=$('ocr-split-at');
    if(splitToken!==token){slider.value='50';splitToken=token;}
    const canSplit=!!token&&token.box.width>=4;
    slider.disabled=$('ocr-split').disabled=busy||!!rebox||!canSplit;
    if(!canSplit){$('ocr-split-value').textContent=token?'字形过窄，无法拆分':'50%';slider.removeAttribute('aria-valuetext');return;}
    const [left,right]=BabelianOCRCorrection.splitBoxes(token.box,Number(slider.value));
    const percent=Math.round(left.width/token.box.width*100);
    $('ocr-split-value').textContent=`${percent}% · 左 ${left.width} / 右 ${right.width} 像素`;
    slider.setAttribute('aria-valuetext',`左侧 ${left.width} 像素（${percent}%），右侧 ${right.width} 像素`);
  }
  function splitPreview(){
    const token=active();
    if(!token||token.box.width<4||rebox||$('ocr-review').hidden||$('ocr-segmentation').hidden)return null;
    return BabelianOCRCorrection.splitBoxes(token.box,Number($('ocr-split-at').value));
  }
  function drawSplitBoxes(context,parts,offsetX,offsetY,scale){
    context.save();context.strokeStyle='#1768dc';context.lineWidth=Math.max(1,scale*1.5);
    const [left,right]=parts;
    context.setLineDash([scale*5,scale*3]);context.strokeRect(offsetX+right.x,offsetY+right.y,right.width,right.height);
    context.setLineDash([]);context.strokeRect(offsetX+left.x,offsetY+left.y,left.width,left.height);context.restore();
  }
  function drawReviewContext(){
    const token=active();if(!reviewContext||reviewContext.token!==token)return;
    const {box:area,image,neighbors}=reviewContext,parts=splitPreview(),b=token.box;
    for(const id of ['ocr-context','ocr-split-preview']){
      const canvas=$(id);canvas.width=area.width;canvas.height=area.height;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      // object-fit:contain can letterbox in either direction. Work in original
      // crop pixels and compensate only the stroke width for display scaling.
      const scale=Math.max(area.width/Math.max(1,canvas.clientWidth),area.height/80);
      if(parts)drawSplitBoxes(context,parts,-area.x,-area.y,scale);
      else{context.lineWidth=Math.max(1,scale*1.5);context.strokeStyle='#1768dc';context.strokeRect(b.x-area.x,b.y-area.y,b.width,b.height);}
    }
    $('ocr-context-caption').textContent=`原图上下文 · 当前项${neighbors?`及 ${neighbors} 个相邻字形`:''}，`+(parts?'蓝色实线为左半、虚线为右半；仅预览，尚未拆分。':'蓝框为当前项；保留全部原始笔画。');
    $('ocr-context').setAttribute('aria-label',parts?'选中字形与相邻原图：蓝色实线框为左半，虚线框为右半':'选中字形与同一原图行前后相邻字形；蓝框为当前字形');
  }
  $('ocr-split-at').addEventListener('input',()=>{
    if(busy||rebox||!active())return;
    syncSplitControls();drawReviewContext();draw();
  });
  function renderReview(){
    const token=active();if(!token||rebox)return;setEditorVisible(true);
    if(deepSuggestion&&(deepSuggestion.token!==token||deepSuggestion.signature!==JSON.stringify(token)))deepSuggestion=null;
    $('ocr-deep-candidates').replaceChildren();$('ocr-deep-status').textContent='';
    if(deepSuggestion){
      const answer=deepSuggestion.answer;
      $('ocr-deep-status').textContent=answer.candidates.length?'已对比 '+answer.uniqueMasks+' 种有效阈值图和粗细尺度。候选需确认，支持次数不是正确率。':'此框内没有可靠候选，请检查分割。';
      for(const c of answer.candidates){
        const b=document.createElement('button');b.type='button';b.className='ocr-candidate';b.append(imageElement(c.id));const caption=document.createElement('span');caption.textContent=label(c.id)+' · '+Math.round(c.score*100)+' 分 · '+c.support+'/'+c.variantCount+' 方案首选';b.append(caption);
        b.addEventListener('click',()=>{if(active()!==token||JSON.stringify(token)!==deepSuggestion?.signature)return;$('ocr-choice').value=c.id;showChoice();});$('ocr-deep-candidates').append(b);
      }
    }
    $('ocr-review-title').textContent=`复核第 ${selected.line+1} 行 · 第 ${selected.token+1} 项`;
    const b=token.box,canvas=$('ocr-piece');canvas.width=b.width;canvas.height=b.height;
    const tmp=document.createElement('canvas');tmp.width=resultImage.width;tmp.height=resultImage.height;tmp.getContext('2d').putImageData(resultImage,0,0);
    canvas.getContext('2d').drawImage(tmp,b.x,b.y,b.width,b.height,0,0,b.width,b.height);
    const pieceContext=canvas.getContext('2d');pieceContext.fillStyle=result.polarity==='light'?'#232323':'#f4f4f4';
    for(const excluded of token.excludedBoxes||[])pieceContext.fillRect(excluded.x-b.x,excluded.y-b.y,excluded.width,excluded.height);
    $('ocr-piece-caption').textContent=token.excludedBoxes?.length?'原图裁片（隐去已分配给其他框的区域）':'原图裁片';
    const context=Work.context(result,selected),area=context.box,nearby=document.createElement('canvas');nearby.width=area.width;nearby.height=area.height;
    // Keep a small, unmarked context image for fast slider redraws, retaining
    // the original pixels including excluded/neighbor strokes.
    nearby.getContext('2d').drawImage(tmp,area.x,area.y,area.width,area.height,0,0,area.width,area.height);
    reviewContext={...context,token,image:nearby};syncSplitControls();drawReviewContext();
    const list=$('ocr-candidates');list.replaceChildren();const map=mapping();
    for(const candidate of token.candidates){
      const button=document.createElement('button');button.type='button';button.className='ocr-candidate';button.append(imageElement(candidate.id));
      const caption=document.createElement('span');caption.textContent=`${label(candidate.id)} · ${map[candidate.id]||'未映射'} · ${Math.round(candidate.score*100)} 分`;button.append(caption);
      button.addEventListener('click',()=>{$('ocr-choice').value=candidate.id;showChoice();});list.append(button);
    }
    $('ocr-choice').replaceChildren();
    for(const id of ids){const option=document.createElement('option');option.value=id;option.textContent=`${label(id)} · ${map[id]||'未映射'}`;$('ocr-choice').append(option);}
    $('ocr-choice').value=OCR.tokenGlyph(token)||ids[0];showChoice();
    syncReviewControls();
  }
  function showChoice(){const id=$('ocr-choice').value;$('ocr-choice-image').src=glyphs[id].src;$('ocr-choice-image').alt=label(id);}
  $('ocr-deep').addEventListener('click',async()=>{
    const token=active();if(!token||busy||rebox)return;const signature=JSON.stringify(token),version=++job;setBusy(true);message('正在对当前字形深度比对…');
    try{await loadTemplates();await new Promise(resolve=>setTimeout(resolve,0));if(version!==job)return;
      const answer=BabelianDeep.deep(resultImage,token.box,templates,{threshold:result.threshold,polarity:result.polarity,excludedBoxes:token.excludedBoxes||[],cancelled:()=>version!==job});
      if(version!==job||active()!==token||signature!==JSON.stringify(token))return;
      deepSuggestion={token,signature,answer};renderReview();message('深度候选已列出；选择后点击“确认使用此字形”。原结果未改变。');
    }catch(e){if(version===job)message('深度识别未应用：'+e.message);}finally{if(version===job)setBusy(false);}
  });
  $('ocr-choice').addEventListener('change',showChoice);
  function confirmChoice(advance=false){
    const t=active();if(!t||busy||rebox)return;const position={...selected};t.id=$('ocr-choice').value;t.manual=true;t.certain=false;
    const next=advance?BabelianOCRUI.pendingNeighbor(result,position,1):null;
    if(next){select(next.line,next.token);return;}
    closeReview();renderResults();draw();
    const target=$('ocr-tokens').querySelector(`[data-line="${position.line}"][data-token="${position.token}"]`)||$('ocr-tokens').querySelector('.ocr-token')||$('ocr-review-toggle');
    target.focus({preventScroll:true});
    if(advance)message('待确认项已全部处理。绿色自动匹配项仍可按需复核。');
  }
  $('ocr-confirm').addEventListener('click',()=>confirmChoice());
  $('ocr-confirm-next').addEventListener('click',()=>confirmChoice(true));
  $('ocr-unknown').addEventListener('click',()=>{const t=active();if(!t||busy||rebox)return;endRebox();t.manual=false;t.certain=false;renderResults();draw();});
  $('ocr-edit-map').addEventListener('click',()=>{endRebox();if(active())editMapping($('ocr-choice').value);});
  function imageMask(excludedBoxes=[]){return BabelianOCRCorrection.exclude(OCR.binarize(resultImage,{threshold:result.threshold,polarity:result.polarity}),excludedBoxes);}
  function classify(box,excludedBoxes=BabelianOCRCorrection.exclusionsFor([active()]),preserveBox=false){
    const mask=imageMask(excludedBoxes);
    const tight=OCR.bounds(mask,box.x,box.y,box.x+box.width,box.y+box.height)||box;
    const candidates=OCR.matchDescriptor(OCR.describe(mask,tight),prepared);
    return {box:preserveBox?{...box}:tight,candidates,id:candidates[0]?.id||null,score:candidates[0]?.score||0,certain:false,manual:false,excludedBoxes};
  }
  $('ocr-split').addEventListener('click',()=>{
    const t=active();if(!t||busy||rebox||t.box.width<4)return;
    if(result.lines.reduce((n,row)=>n+row.tokens.length,0)>=1500){message('分割项已达1500项，请分段识别。');return;}
    try{
      const boxes=BabelianOCRCorrection.splitBoxes(t.box,Number($('ocr-split-at').value));
      // Classify both sides before mutating. Failed matching must leave the
      // original result and selection intact.
      const parts=boxes.map(box=>classify(box,BabelianOCRCorrection.exclusionsFor([t]),true));
      result.lines[selected.line].tokens.splice(selected.token,1,...parts);resetSplitPreview();renderResults();draw();message('已拆成两个分割项，请分别确认候选。');
    }catch(error){message('未应用拆分：'+error.message);}
  });
  $('ocr-merge').addEventListener('click',()=>{
    const a=active(),list=result?.lines[selected?.line]?.tokens,b=list?.[selected.token+1];if(!a||!b||busy||rebox)return;
    endRebox();
    const x=Math.min(a.box.x,b.box.x),y=Math.min(a.box.y,b.box.y),right=Math.max(a.box.x+a.box.width,b.box.x+b.box.width),bottom=Math.max(a.box.y+a.box.height,b.box.y+b.box.height);
    list.splice(selected.token,2,classify({x,y,width:right-x,height:bottom-y},BabelianOCRCorrection.exclusionsFor([a,b])));renderResults();draw();message('已合并，请确认新候选。');
  });
  $('ocr-join').addEventListener('change',renderResults);
  function formattingInput(){
    const map=mapping();
    // Word readings and optional game names only affect spacing suggestions,
    // never template recognition or the raw transcription.
    const extraWords=[...Object.values(map).flatMap(value=>value.match(/[A-Za-z]{2,40}/g)||[]),...($('ocr-extra-words').value.match(/[A-Za-z]{2,40}/g)||[])].slice(0,250);
    return {payload:OCR.toWriter(result,map,{joinLines:false}),options:{punctuate:$('ocr-punctuate').checked,extraWords}};
  }
  function renderFormattedState(state){
    if(!state)return;
    if($('ocr-formatted').value!==state.value)$('ocr-formatted').value=state.value;
    $('ocr-formatted-copy').disabled=!!state.error;$('ocr-formatted-append').disabled=!!state.error;
    $('ocr-format-status').textContent=state.error||(
      state.dirty?'已手动调整空格或标点；原文字母与大小写保持不变。':
      '自动整理建议。'+(state.meta.punctuationCount?` ${state.meta.punctuationCount} 处标点/句界由规则推测，不代表剧情书原标点。`:' 本次仅补分词空格，未添加标点。')+
      (state.meta.unknown.length?` ${state.meta.unknown.length} 个片段未在词表中找到，请复核或补充词语。`:''));
    syncTranslation();
  }
  function refreshFormatted(force=false){
    $('ocr-formatted-block').hidden=!$('ocr-format-enabled').checked;
    if(!result||!$('ocr-format-enabled').checked){translation.invalidate('整理文本已关闭，请重新开启后翻译。');return;}
    try{
      const {payload,options}=formattingInput();
      renderFormattedState(force?formattedDraft.generate(payload,options):formattedDraft.update(payload,options));
    }catch(e){$('ocr-format-status').textContent='自动整理失败：'+e.message;$('ocr-formatted-copy').disabled=true;$('ocr-formatted-append').disabled=true;translation.invalidate('请先解决英文整理错误。');$('ocr-translate-run').disabled=true;}
  }
  $('ocr-format-enabled').addEventListener('change',()=>refreshFormatted());
  $('ocr-punctuate').addEventListener('change',()=>refreshFormatted());
  $('ocr-extra-words').addEventListener('change',()=>refreshFormatted());
  $('ocr-format-run').addEventListener('click',()=>{
    if(formattedDraft.state()?.dirty&&!confirm('重新生成会替换手动调整的空格和标点，继续吗？'))return;
    refreshFormatted(true);
  });
  $('ocr-formatted').addEventListener('input',()=>renderFormattedState(formattedDraft.edit($('ocr-formatted').value)));
  $('ocr-formatted-copy').addEventListener('click',async()=>{
    try{
      const payload=formattedDraft.payload();
      try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(payload.text);notify('已复制自动整理建议。');}
      catch(_){$('ocr-formatted').focus();$('ocr-formatted').select();notify(document.execCommand('copy')?'已复制整理文本。':'请全选并复制整理文本。');}
    }catch(e){notify(e.message);}
  });
  $('ocr-formatted-append').addEventListener('click',()=>{try{append(formattedDraft.payload());}catch(e){notify(e.message);}});
  function renderTranslation(state){
    const draft=formattedDraft.state(),running=state.status==='busy';
    $('ocr-translate-run').disabled=running||!$('ocr-translate-consent').checked||!draft||!!draft.error||!draft.value.trim();
    $('ocr-translate-cancel').hidden=!running;$('ocr-translate-copy').disabled=state.status!=='done';
    $('ocr-translation').value=state.value;$('ocr-translate-source').value=state.source;
    $('ocr-translate-source-details').hidden=!state.source;
    $('ocr-translate-status').textContent=running?(state.progress?`正在翻译：${state.progress.done} / ${state.progress.total} 段…`:'正在发送当前整理后的英文…'):
      state.status==='done'?'翻译完成，采用本次点击时的英文（含手动断句和标点）。机翻仅供参考；[?] 和 [未映射] 保留。':state.error||'尚未翻译。先调整上方英文，再点击翻译。';
  }
  function syncTranslation(){
    const draft=formattedDraft.state();translation.sync($('ocr-formatted').value,!!draft&&!draft.error);renderTranslation(translation.state());
  }
  function setTranslationOpen(open){
    $('ocr-translate-panel').hidden=!open;$('ocr-translate-toggle').setAttribute('aria-expanded',String(open));
    $('ocr-translate-toggle').textContent=open?'收起中文机翻':'中文机翻';
    if(!open&&translation.state().status==='busy')translation.cancel();
  }
  $('ocr-translate-toggle').addEventListener('click',()=>setTranslationOpen($('ocr-translate-panel').hidden));
  $('ocr-translate-consent').addEventListener('change',()=>{if(!$('ocr-translate-consent').checked)translation.cancel();renderTranslation(translation.state());});
  $('ocr-translate-run').addEventListener('click',async()=>{
    if(!$('ocr-translate-consent').checked)return;
    try{
      // Read the live edited field, validate it, and never regenerate suggestions.
      if(formattedDraft.state()?.value!==$('ocr-formatted').value)formattedDraft.edit($('ocr-formatted').value);
      const text=formattedDraft.payload().text;
      BabelianTranslation.chunks(text);await translation.run(text);
    }catch(error){$('ocr-translate-status').textContent=error.message;}
  });
  $('ocr-translate-cancel').addEventListener('click',()=>translation.cancel());
  $('ocr-translate-copy').addEventListener('click',async()=>{
    syncTranslation();if(translation.state().status!=='done')return;
    const field=$('ocr-translation');
    try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(field.value);notify('已复制中文译文。');}
    catch(_){field.focus();field.select();notify(document.execCommand('copy')?'已复制中文译文。':'请全选并复制中文译文。');}
  });
  $('ocr-copy').addEventListener('click',async()=>{
    const field=$('ocr-output');try{if(!navigator.clipboard?.writeText)throw Error();await navigator.clipboard.writeText(field.value);notify('已复制识别英文，包含待确认候选。');}
    catch(_){field.focus();field.select();notify(document.execCommand('copy')?'已复制识别英文。':'请在结果框中全选并复制。');}
  });
  $('ocr-append').addEventListener('click',()=>{if(result)append(OCR.toWriter(result,mapping(),outputOptions()));});
  window.addEventListener('babelian-mapping-change',renderResults);
  window.addEventListener('resize',()=>{draw();drawReviewContext();});
  return {refresh:()=>{renderResults();draw();},pause:()=>{loading++;cancel();translation.cancel();},snapshot:()=>JSON.parse(JSON.stringify({crop,result,selected}))};
}};
