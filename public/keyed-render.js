export function visibleHandTotal(player, streetWager) {
  const total = player.totalBet;
  return Number.isFinite(total) && total > 0 && total !== streetWager ? total : null;
}

export function seatRenderKey(p,room,index,roles,handTotal=p.totalBet){
 return JSON.stringify([room.me,index,room.turn===index,room.turn===index?room.deadline:null,
  room.phase==='showdown'||!!room.tournament?.completed,roles,handTotal,
  ...['id','name','avatar','isBot','seatNumber','stack','bet','folded','godMode','handLabel','eliminated','inHand'].map(k=>p[k]),p.cards]);
}
export function reconcileChildren(parent,nodes){
 const wanted=new Set(nodes);
 for(const old of [...parent.children])if(!wanted.has(old))parent.removeChild(old);
 nodes.forEach((node,index)=>{if(parent.children[index]!==node)parent.insertBefore(node,parent.children[index]||null);});
}
