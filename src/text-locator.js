/* Source indices are attached to pixels, never inferred from English meaning. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BabelianTextLocator=api;})(globalThis,function(){
 function payload(result,mapping,OCR,joinLines=false){
  let text='';const spans=[];
  result.lines.forEach((row,line)=>{if(line&&!joinLines)text+='\n';row.tokens.forEach((t,token)=>{const start=text.length;text+=OCR.tokenReading(t,mapping);spans.push({start,end:text.length,line,token});});});return {text,spans};
 }
 function range(text,start,end=start,word=true){
  start=Math.max(0,Math.min(text.length,start??0));end=Math.max(start,Math.min(text.length,end??start));
  if(end>start)return {start,end};if(start>=text.length||/\s/.test(text[start]))return null;
  for(const m of text.matchAll(/\[\?\]|\[未映射\]|[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g))if(start>=m.index&&start<m.index+m[0].length)return word?{start:m.index,end:m.index+m[0].length}:{start,end:start+1};return null;
 }
 function locate(projected,start,end=start,word=true){const target=range(projected.text,start,end,word);if(!target)return [];return projected.spans.filter(s=>s.start<target.end&&s.end>target.start).map(s=>({line:s.line,token:s.token}));}
 return {payload,range,locate};
});
