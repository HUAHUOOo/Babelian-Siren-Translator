// Build-time data loader only. No APK or native program is executed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function load(root){
 const base=path.join(root,'resources/apk'),manifest=JSON.parse(fs.readFileSync(path.join(base,'manifest.json'),'utf8'));
 if(manifest.version!==1||manifest.source?.licenseStatus!=='not-verified')throw Error('Unexpected APK resource manifest');
 for(const [name,record]of Object.entries(manifest.files)){
  if(name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||path.isAbsolute(name))throw Error('Invalid resource path');
  const bytes=fs.readFileSync(path.join(base,name));
  if(bytes.length!==record.bytes||crypto.createHash('sha256').update(bytes).digest('hex')!==record.sha256)throw Error('APK resource checksum mismatch: '+name);
 }
 const read=name=>JSON.parse(fs.readFileSync(path.join(base,name),'utf8'));
 return {manifest,artwork:read('babelian/vector-artwork.json'),recognition:read('babelian/vector-templates.json')};
}
module.exports={load};
