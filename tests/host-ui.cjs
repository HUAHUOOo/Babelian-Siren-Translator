/* Hidden standalone chrome must not hide ATO sync or fatal recovery messages. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../src/host-ui.js'),'utf8');
for(const integrated of [false,true]){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:true,dataset:{},addEventListener(){}});return elements.get(id);};
 let update;
 const window={addEventListener(){}},runtime={integrated,subscribe(fn){update=fn;fn({kind:'local',message:'独立版 · 本机保存'});},storyUrl:()=>null};
 vm.runInNewContext(source,{window,document:{getElementById:get},URL,location:{href:'file:///example/index.html'},setTimeout,clearTimeout});
 const host=window.BabelianHost.connect(runtime);assert.equal(get('host-bar').hidden,!integrated);
 host.ready({restore(){}});assert.equal(get('host-bar').hidden,!integrated);assert.equal(get('tool-surface').inert,false);
 update({kind:'conflict',message:'Do not overwrite',owner:'test',profileId:'campaign'});assert.equal(get('host-bar').hidden,false);assert.equal(get('host-bar').dataset.status,'conflict');assert(get('host-status').textContent.includes('Do not overwrite'));
 update({kind:'local-error',message:'Save failed'});assert.equal(get('host-bar').hidden,false);assert.equal(get('host-status').textContent,'Save failed');
 update({kind:'local',message:'独立版 · 本机保存'});assert.equal(get('host-bar').hidden,!integrated);
 host.fail(Error('Startup failed'));assert.equal(get('host-bar').hidden,false);assert.equal(get('host-status').textContent,'Startup failed');assert.equal(get('host-reload').hidden,false);assert.equal(get('host-reload').disabled,false);
}
const template=fs.readFileSync(require.resolve('../src/template.html'),'utf8');assert(/<section id="host-bar"[^>]*\bhidden\b/.test(template));assert(template.includes("catch(error=>{document.getElementById('host-bar').hidden=false;"));
console.log('PASS standalone backup/status card hidden without changing data; ATO sync and fatal startup recovery remain visible; no initial card flash.');
