/* Public Translator release boundary. Pinned bytes come from public 3b9a96f.
 * Uses only the already-public glyph assets and fixture hashes, never private inputs. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const pinned={
 'src/glyphs.json':'5fe4311dcb49349e15d37c2c03d6908cbb605b3bf9cfa16902c7bab2c121d0de',
 'src/parts.json':'7ca44d9ab31601cfd3f3616080e172ce963a35d6bd68928a459b50aea41f624a',
 'src/siren-glyphs.json':'d8f803c9832a1845f3054219bb89ea325f89978a35b54a1fb6dca2e0abe25fb9',
 'src/siren-path.json':'aa1c055826d9fd13f57db17509aa36658378e7fa35d9afe3a8b5415bcc4a8329',
 'tests/fixtures/babelian-350x.json':'38ee8433d52ac7602ccac3fc7a868ddeac03ccabc6cb3799ee194c1e542cd389',
 'tests/fixtures/siren-3491.json':'aea19d0d501c39fcb5873ff9a2b481a300979235d5cb79d0d0360b320cb868fb'
};
for(const [file,digest] of Object.entries(pinned))assert.equal(hash(fs.readFileSync(path.join(root,file))),digest,`Public baseline asset/fixture changed: ${file}`);
assert.deepEqual(fs.readdirSync(path.join(root,'tests/fixtures')).sort(),['babelian-350x.json','siren-3491.json'],'Only existing public fixtures belong in this release');
function walk(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)]);}
const rootEntries=fs.readdirSync(root,{withFileTypes:true});
const publicRoots=new Set(['.gitignore','README.md','BABELIAN.md','SIREN.md','package.json','package-lock.json','index.html']);
const allowedDirectories=new Set(['.git','src','scripts','integration','tests','dist','node_modules','test-results','playwright-report']);
for(const entry of rootEntries)assert(entry.isDirectory()?allowedDirectories.has(entry.name):publicRoots.has(entry.name),`Unexpected release-root input or payload: ${entry.name}`);
const published=[...walk('src'),...walk('scripts'),...walk('integration'),...rootEntries.filter(entry=>entry.isFile()).map(entry=>entry.name)];
const excluded=/CipherProofreading|\bproof-(?:open|home|queue|import|feedback)\b|__PROOFREADING_[A-Z_]+__|\bindexedDB\b|ato-cipher-(?:proofreading|collection)|\bproofreading\s*[:.]|proofreading[-.]|import-feedback-workbench/i;
for(const file of published){
 assert(!excluded.test(file),`Private feature filename in public release: ${file}`);
 if(/\.(?:js|cjs|py|html|css|md|json|txt|patch)$/i.test(file))assert(!excluded.test(read(file)),`Private feature code, hooks, payload or docs in ${file}`);
}
for(const file of [...walk('tests'),...published]){
 if(file.startsWith('tests/qa/'))continue;
 assert(!/(?:proofreading|feedback-workbench|private[-_](?:fixture|story|feedback))/i.test(path.basename(file)),`Private test/helper in public release: ${file}`);
 assert(!/\.(?:png|jpe?g|webp|gif|zip|pdf)$/i.test(file),`Unexpected bundled input image/archive: ${file}`);
}
const glyphs=JSON.parse(read('src/glyphs.json')),parts=JSON.parse(read('src/parts.json')),siren=JSON.parse(read('src/siren-glyphs.json'));
const assets=[...Object.values(glyphs),...parts.components,siren.base,...Object.values(siren.letters)];
const imageHashes=assets.map(asset=>hash(Buffer.from(asset.src.split(',')[1],'base64'))).sort();
assert.equal(assets.length,91);
assert.equal(hash(JSON.stringify(imageHashes)),'5d1a37431015e76aff327138d046db4a0059ad0f631ec5e1620f9ccee267227e','The public 91 PNG payloads must remain unchanged');
const embedded=(read('index.html').match(/data:image\/png;base64,[A-Za-z0-9+/=]+/g)||[]).map(src=>hash(Buffer.from(src.split(',')[1],'base64'))).sort();
assert.deepEqual(embedded,imageHashes,'Standalone must contain exactly the same 91 public PNGs, with no input screenshots');
// Keep Translator's original single-image manual review, save/load and sample library.
for(const file of ['src/ocr-work.js','src/glyph-samples.js','src/siren-core.js'])assert(fs.existsSync(path.join(root,file)),`Missing established Translator feature: ${file}`);
for(const id of ['ocr-work-save','ocr-work-load','ocr-review'])assert(read('src/ocr-panel.html').includes(`id="${id}"`),`Missing existing public control ${id}`);
for(const id of ['siren-save','siren-load','siren-samples','siren-contact'])assert(read('src/siren-panel.html').includes(`id="${id}"`),`Missing existing public control ${id}`);
assert(!/number[s]?-(?:toggle|display)|numeric-(?:toggle|display)/i.test(read('src/siren-panel.html')),'No unrequested numeric-display toggle');
const dist='dist/ato/babelian';
if(fs.existsSync(path.join(root,dist))){
 const files=walk(dist).map(file=>path.relative(dist,file)).sort(),manifest=JSON.parse(read(path.join(dist,'babelian-module.json')));
 const expected=['babelian-module.json',...Object.keys(manifest.files)].sort();
 assert.deepEqual(files,expected,'ATO package must contain only its declared public module files');
 assert.equal(Object.keys(manifest.files).length,92,'ATO package is one page and 91 assets');
 const images=files.filter(file=>file.endsWith('.png')).map(file=>hash(fs.readFileSync(path.join(root,dist,file)))).sort();
 assert.deepEqual(images,imageHashes,'ATO PNG bytes must match the established public assets');
 assert(!excluded.test(read(path.join(dist,'index.html'))),'Private feature code in ATO build');
 for(const [file,entry] of Object.entries(manifest.files))assert.equal(hash(fs.readFileSync(path.join(root,dist,file))),entry.sha256,`ATO manifest mismatch: ${file}`);
}
console.log('PASS public release scope: no private workbench/hooks/storage/payloads/tests; original manual review/save/samples preserved; 91 public PNGs and existing fixtures unchanged; standalone and available ATO package audited.');
