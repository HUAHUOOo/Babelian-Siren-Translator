const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
for(const file of ['index.html','dist/ato/babelian/index.html']){
  const html=read(file);
  const note=html.match(/<details id="official-terminology-note"[^>]*>[\s\S]*?<\/details>/)?.[0];
  assert(note,`${file}: terminology note present`);
  assert(!/<details[^>]*\bopen\b/.test(note),'terminology note starts collapsed');
  assert(note.includes('官方中文故事集正文称这类生物为“海妖”'));
  assert(note.includes('尚未确认两种密码语言的正式中文名'));
  for(const label of ['巴别语生成','巴别语翻译','塞壬语生成','塞壬语翻译'])assert(html.includes(`<strong>${label}</strong>`));
  for(const id of ['ocr-translate-help','siren-translate-panel']){
    const text=html.slice(html.indexOf(`id="${id}"`)).split('</p>')[0];
    assert(text.includes('不是官方译文'));
    assert(text.includes('官方中文剧情书及规则书'));
  }
}
const integration=read('integration/README.md');
assert(integration.includes('故事集IV、V'));
assert(integration.includes('与当前 `package.json` 一致'));
assert(!integration.includes('`version` 为1.9.10'));
console.log('PASS official terminology: both builds retain four original language entries, collapsed naming note, official-source boundaries and current integration version instructions.');
