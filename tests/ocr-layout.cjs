// Static markup contracts only; no browser, screenshots or DOM interaction.
const assert=require('node:assert/strict'),fs=require('node:fs');
const html=fs.readFileSync(require.resolve('../src/ocr-panel.html'),'utf8');
const root={tag:'root',children:[]},stack=[root],ids=new Map();
for(const match of html.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>/gi)){
  const [,closing,tag,attrs]=match;
  if(closing){assert.equal(stack.pop().tag,tag,'unbalanced markup');continue;}
  const node={tag,attrs,index:match.index,parent:stack.at(-1),children:[]};node.parent.children.push(node);
  const id=attrs.match(/\bid="([^"]+)"/)?.[1];
  if(id){assert(!ids.has(id),'duplicate id '+id);ids.set(id,node);}
  if(!['input','img','br','hr','meta','link'].includes(tag))stack.push(node);
}
assert.equal(stack.length,1,'all containers must close');
const get=id=>{assert(ids.has(id),'missing '+id);return ids.get(id);};
const inside=(node,parent)=>{for(let n=node;n;n=n.parent)if(n===parent)return true;return false;};
const decode=get('panel-decode'),inspection=get('ocr-inspection'),results=get('ocr-results');
assert.equal(inspection.parent,decode);assert.equal(results.parent,decode);
assert.equal(decode.children.at(-1),results,'recognized English must be the bottom section');
assert(inside(get('ocr-tokens'),inspection));assert(inside(get('ocr-review'),inspection));
assert.equal(get('ocr-token-details').tag,'div');
assert.equal(get('ocr-review-toggle').tag,'button');assert(/type="button"/.test(get('ocr-review-toggle').attrs));
assert(/aria-expanded="false"/.test(get('ocr-review-toggle').attrs));assert(/aria-controls="ocr-tokens"/.test(get('ocr-review-toggle').attrs));
assert(/\bhidden\b/.test(get('ocr-tokens').attrs));assert(inside(get('ocr-review-toggle'),get('ocr-token-details')));
assert(/\bhidden\b/.test(get('ocr-review').attrs));assert(inside(get('ocr-output-note'),results));
for(const id of ['ocr-confirm-next','ocr-review-close'])assert.equal(get(id).tag,'button');
assert(inside(get('ocr-pending-only'),inspection));assert(inside(get('ocr-filter-empty'),inspection));
assert(inside(get('ocr-review-close'),get('ocr-review')));assert(inside(get('ocr-review-position'),get('ocr-review')));
assert.equal(get('ocr-confirm').parent,get('ocr-confirm-next').parent,'both confirmation actions stay in the fixed footer');
for(const id of ['ocr-summary','ocr-work-save','ocr-work-load','ocr-work-file','ocr-work-status','ocr-undo','ocr-redo','ocr-review-undo','ocr-review-redo','ocr-history-status','ocr-pending-prev','ocr-pending-next','ocr-review-prev','ocr-review-next','ocr-full','ocr-rotate','ocr-forget','ocr-crop-x','ocr-crop-y','ocr-crop-width','ocr-crop-height','ocr-crop-apply','ocr-polarity','ocr-single','ocr-detail','ocr-auto','ocr-threshold','ocr-threshold-value','ocr-review-keyboard-help','ocr-add-sample','ocr-samples'])assert(!ids.has(id),'removed control remains: '+id);
assert(inside(get('ocr-context'),get('ocr-review')));
assert(!/aria-describedby="ocr-review-keyboard-help"/.test(html),'removed keyboard hint must not leave a dangling accessible description');
assert(inspection.index<results.index);assert(inside(get('ocr-output'),results));
const toolbar=get('ocr-formatted-copy').parent;
assert.equal(get('ocr-formatted-append').parent,toolbar);assert.equal(get('ocr-translate-toggle').parent,toolbar);
assert(get('ocr-formatted-copy').index<get('ocr-formatted-append').index&&get('ocr-formatted-append').index<get('ocr-translate-toggle').index);
assert(/aria-expanded="false"/.test(get('ocr-translate-toggle').attrs));
assert(/aria-controls="ocr-translate-panel"/.test(get('ocr-translate-toggle').attrs));
assert(/\bhidden\b/.test(get('ocr-translate-panel').attrs));
assert(inside(get('ocr-translation'),get('ocr-translate-panel')));
const segmentation=get('ocr-segmentation');assert.equal(segmentation.tag,'div');assert(/\bhidden\b/.test(segmentation.attrs));
assert.equal(get('ocr-segmentation-toggle').tag,'button');assert(/type="button"/.test(get('ocr-segmentation-toggle').attrs));
assert(/aria-expanded="false"/.test(get('ocr-segmentation-toggle').attrs));assert(/aria-controls="ocr-segmentation"/.test(get('ocr-segmentation-toggle').attrs));
assert(inside(get('ocr-segmentation-toggle'),get('ocr-review')));
for(const id of ['ocr-split','ocr-merge','ocr-rebox'])assert(inside(get(id),segmentation));
assert(get('ocr-split').index<get('ocr-merge').index&&get('ocr-merge').index<get('ocr-rebox').index);
const ui=fs.readFileSync(require.resolve('../src/ocr-ui.js'),'utf8');
const toggle=ui.slice(ui.indexOf('function setTranslationOpen('),ui.indexOf("$('ocr-translate-consent').addEventListener"));
assert(toggle.includes("setAttribute('aria-expanded',String(open))"));assert(!toggle.includes('translation.run('));
assert(toggle.includes('translation.cancel()'),'collapse should stop future chunks of an active request');
console.log('PASS OCR markup: balanced containers; review before bottom results; real accessible buttons control collapsed review/segmentation panels; translation beside copy/append; rebox after split/merge; expansion cannot send text.');
