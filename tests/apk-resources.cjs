const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),base=path.join(root,'resources/apk'),data=require('../scripts/apk-resources.cjs').load(root);
const read=name=>fs.readFileSync(path.join(base,name),'utf8'),json=name=>JSON.parse(read(name)),glyphs=require('../src/glyphs.json');
assert.equal(Object.keys(data.manifest.files).length,341);
assert.equal(data.manifest.source.sha256,'4dbb9353e710f508356f633dd5592684f5bea9711b7f75f3f4f302f58ee98bb7');
assert.equal(data.manifest.source.licenseStatus,'not-verified');assert(read('NOTICE.md').includes('Copyright (c) 2023, intot'));
assert.equal(require('../src/babelian-visuals.js').create(glyphs,data.artwork).vectorReady,true);
const groups=require('../src/ocr-engine.js').prepareVectorProfile(data.recognition,Object.keys(glyphs));
assert.equal(groups.size,58);assert([...groups.values()].every(g=>g.length===10));assert.equal(data.recognition.variants.length,580);
const chars=json('babelian/characters.json');assert.equal(chars.glyphs.length,58);
for(const g of chars.glyphs)for(const kind of ['svg','png'])assert(Object.hasOwn(data.manifest.files,g[kind]));
const files=Object.keys(data.manifest.files);assert.equal(files.filter(n=>n.endsWith('.png')).length,274);assert.equal(files.filter(n=>n.endsWith('.svg')).length,58);
for(const name of files){
 assert(!/\.(?:apk|dll|so|exe|dex|pdf|zip|jpe?g)$/i.test(name));
 if(name.endsWith('.png'))assert.equal(fs.readFileSync(path.join(base,name)).subarray(1,4).toString(),'PNG');
 if(name.endsWith('.svg')){const svg=read(name);assert(svg.startsWith('<svg '));assert(!/<(?:script|image|foreignObject)|\bon\w+\s*=|(?:href|url)\s*[=(]/i.test(svg));}
}
const geometry=json('siren/geometry-and-order.json');assert.equal(geometry.letters.length,26);assert.equal(geometry.main.segments_in_reading_order.length,24);
assert.equal(json('icons/index.json').length,189);for(const icon of json('icons/index.json'))assert(Object.hasOwn(data.manifest.files,icon.path));
for(const file of ['index.html','dist/ato/babelian/index.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 for(const [name,expected]of [['BabelianVectorArtwork',data.artwork],['BabelianVectorTemplateProfile',data.recognition]]){
  const match=html.match(new RegExp('globalThis\\.'+name+'=(\\{[^\\n]+\\});'));assert(match,'Missing built-in profile '+name);assert.deepEqual(JSON.parse(match[1]),expected);
 }
 assert(!html.includes('Babelian_Cypher.ttf'),'Font must not be loaded from network');
}
assert.equal(JSON.parse(fs.readFileSync(path.join(root,'dist/ato/babelian/babelian-module.json'))).optionalVectorArtwork.includedInPublicPackage,true);
console.log('PASS APK resources: 341 pinned data files; 58 vector glyphs/580 variants; 27 Siren glyphs/24 regions/189 icons; both builds embed validated profiles; no new native program, screenshot or external font loading.');
