/* Optional display-only vector artwork. Recognition always receives its own
   original raster assets. No font, extracted paths or network calls included. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BabelianVisuals=api;})(globalThis,function(){
  'use strict';
  const INK='#243d35';
  function xml(value){
    const text=String(value);
    for(const char of text){const n=char.codePointAt(0);if(n<32&&![9,10,13].includes(n)||n>=0xd800&&n<=0xdfff||n===0xfffe||n===0xffff)throw Error('文本含SVG不支持的控制字符，请先移除。');}
    return text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  }
  function pathMarkup(vector){return '<path fill="'+INK+'" transform="matrix('+vector.matrix.join(' ')+')" d="'+vector.d+'"/>';}
  function readArtwork(profile,original){
    if(!profile||profile.version!==1||!profile.glyphs||typeof profile.glyphs!=='object'||Array.isArray(profile.glyphs))throw Error('矢量显示素材格式不支持。');
    const ids=Object.keys(original);if(Object.keys(profile.glyphs).length!==ids.length)throw Error('矢量显示素材不完整，已保留原素材。');
    const vectors=new Map();let total=0;
    for(const id of ids){
      const v=Object.hasOwn(profile.glyphs,id)&&profile.glyphs[id];
      if(!v||!Array.isArray(v.viewBox)||v.viewBox.length!==4||!v.viewBox.every(n=>Number.isFinite(n)&&Math.abs(n)<=100000)||v.viewBox[2]<=0||v.viewBox[3]<=0||!Array.isArray(v.matrix)||v.matrix.length!==6||!v.matrix.every(n=>Number.isFinite(n)&&Math.abs(n)<=100000)||typeof v.d!=='string'||v.d.length>300000||!/[Mm]/.test(v.d)||!/^[MmZzLlHhVvCcSsQqTtAaEe0-9.,+\s-]+$/.test(v.d))throw Error('矢量显示素材包含无效路径。');
      total+=v.d.length;if(total>4000000)throw Error('矢量显示素材过大。');
      vectors.set(id,{viewBox:[...v.viewBox],matrix:[...v.matrix],d:v.d});
    }
    return vectors;
  }
  function create(original,profile){
    let vectors=new Map(),error='';
    if(profile)try{vectors=readArtwork(profile,original);}catch(e){error=e.message;}
    const assets=Object.fromEntries(Object.entries(original).map(([id,asset])=>{
      const v=vectors.get(id);if(!v)return [id,asset];
      const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+asset.width+'" height="'+asset.height+'" viewBox="'+v.viewBox.join(' ')+'" preserveAspectRatio="xMidYMid meet">'+pathMarkup(v)+'</svg>';
      return [id,{...asset,src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)}];
    }));
    const canExport=lines=>vectors.size>0&&lines.every(line=>line.every(token=>vectors.has(token.glyph)));
    function layout(lines,text,measure){
      if(!Array.isArray(lines)||lines.length>6001||typeof text!=='string'||text.length>6000||typeof measure!=='function')throw Error('导出内容不支持，请分段导出。');
      const width=1600,margin=78,right=width-margin,glyphHeight=64,placements=[];let x=margin,y=146;
      for(const line of lines){
        if(!Array.isArray(line))throw Error('导出字形行格式不正确。');
        for(const token of line){
          const glyph=original[token.glyph];if(!glyph)throw Error('导出包含未知字形。');
          const w=glyph.width/glyph.height*glyphHeight;
          if(x+w>right){x=margin;y+=86;}
          placements.push({letter:token.glyph,x,y,width:w});x+=w+5;
          if(placements.length>6000)throw Error('字形过多，请分段导出。');
        }
        x=margin;y+=86;
      }
      const separatorY=y+17,englishRows=[];
      for(const line of text.split('\n')){
        let row='';
        for(const letter of line.replace(/\t/g,'    ')){
          if(row&&measure(row+letter)>width-2*margin){englishRows.push(row);row='';}row+=letter;
        }
        englishRows.push(row);
      }
      const englishY=separatorY+86,height=englishY+englishRows.length*42+68;
      if(height>30000)throw Error('文字较长，请分段导出。');
      return {width,height,margin,right,glyphHeight,placements,separatorY,englishY,englishRows};
    }
    function toSVG(page){
      if(!page||!['width','height','margin','right','glyphHeight','separatorY','englishY'].every(key=>typeof page[key]==='number'&&Number.isFinite(page[key])&&page[key]>0)||page.width>1600||page.height>30000||!Array.isArray(page.placements)||page.placements.length>6000||!page.placements.every(p=>p&&['x','y','width'].every(key=>typeof p[key]==='number'&&Number.isFinite(p[key])&&p[key]>=0))||!Array.isArray(page.englishRows)||page.englishRows.length>6001||!page.englishRows.every(row=>typeof row==='string'&&row.length<=24000))throw Error('SVG导出版式无效。');
      if(!vectors.size||!page.placements.length||page.placements.some(p=>!vectors.has(p.letter)))throw Error('SVG导出需要完整的矢量显示素材。');
      const used=[...new Set(page.placements.map(p=>p.letter))],ids=new Map(used.map((id,i)=>[id,'glyph-'+i]));
      const defs=used.map(id=>{const v=vectors.get(id);return '<symbol id="'+ids.get(id)+'" viewBox="'+v.viewBox.join(' ')+'" preserveAspectRatio="xMidYMid meet">'+pathMarkup(v)+'</symbol>';}).join('');
      const glyphs=page.placements.map(p=>'<use href="#'+ids.get(p.letter)+'" x="'+p.x+'" y="'+p.y+'" width="'+p.width+'" height="'+page.glyphHeight+'"/>').join('');
      const english=page.englishRows.map((row,i)=>'<text x="'+page.margin+'" y="'+(page.englishY+i*42)+'" xml:space="preserve">'+xml(row)+'</text>').join('');
      const result='<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="'+page.width+'" height="'+page.height+'" viewBox="0 0 '+page.width+' '+page.height+'"><title>巴别语与英文</title><defs>'+defs+'</defs><rect width="100%" height="100%" fill="#fffdf7"/><g font-family="sans-serif"><text x="'+page.margin+'" y="64" fill="'+INK+'" font-size="20">ATO  /  BABELIAN</text><text x="'+page.margin+'" y="113" fill="#7b806f" font-size="17">BABELIAN</text></g>'+glyphs+'<path d="M'+page.margin+' '+page.separatorY+'H'+page.right+'" stroke="#d9ddcf"/><text x="'+page.margin+'" y="'+(page.separatorY+43)+'" fill="#7b806f" font-family="sans-serif" font-size="17">ENGLISH</text><g fill="#35473d" font-family="Consolas, monospace" font-size="27">'+english+'</g></svg>';
      if(new TextEncoder().encode(result).length>8*1024*1024)throw Error('SVG超过8MB，请分段导出。');
      return result;
    }
    return {assets,vectorReady:vectors.size===Object.keys(original).length&&vectors.size>0,error,canExport,layout,toSVG};
  }
  return {create};
});
