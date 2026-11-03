/* Read-only view of the current first-contact order, not APK polygon order. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SirenReadingGuide=api;})(globalThis,function(){
 function plan(group,analysis){
  const metrics=new Map((analysis?.items||[]).map(m=>[m.id,m]));
  const all=(group?.items||[]).map((item,index)=>({item,index,...metrics.get(item.id),at:metrics.get(item.id)?.at??null})).sort((a,b)=>(a.at??Infinity)-(b.at??Infinity)||a.index-b.index);
  const placed=all.filter(e=>e.at!==null);return {entries:placed.map((e,i)=>({id:e.item.id,letter:e.item.letter||e.item.fit?.candidates?.[0]?.letter||'?',unconfirmed:!e.item.letter,at:e.at,point:e.first||e.hits?.[0]||null,x:e.item.x,y:e.item.y,tied:placed.some((p,j)=>j!==i&&Math.abs(p.at-e.at)<1),sensitive:!!e.orderSensitive})),missing:all.length-placed.length,points:analysis?.points||[]};
 }
 return {plan};
});
