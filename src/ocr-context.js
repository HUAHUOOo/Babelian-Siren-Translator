/* Shared original-neighbor bounds, independent of legacy work-file utilities. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else {root.BabelianOCRContext=api;root.BabelianOCRWork=api;}})(globalThis,function(){
  'use strict';
  function context(result,position){
    const row=result?.lines[position?.line],current=row?.tokens[position?.token];if(!current)return null;
    const tokens=row.tokens.slice(Math.max(0,position.token-1),position.token+2),boxes=tokens.map(t=>t.box);
    const pad=Math.max(3,Math.round(current.box.height*.12)),x=Math.max(0,Math.min(...boxes.map(b=>b.x))-pad),y=Math.max(0,Math.min(...boxes.map(b=>b.y))-pad);
    const right=Math.min(result.width,Math.max(...boxes.map(b=>b.x+b.width))+pad),bottom=Math.min(result.height,Math.max(...boxes.map(b=>b.y+b.height))+pad);
    return {box:{x,y,width:right-x,height:bottom-y},selected:{...current.box},neighbors:tokens.length-1};
  }
  return {context};
});
