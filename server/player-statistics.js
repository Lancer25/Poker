export function recordHandStatistics(room,now=Date.now()) {
  if(room.testRound)return;
  const key=`${room.roundNumber||1}:${room.hand}`;
  if(room.statistics?.lastHand===key)return;
  const participants=room.players.filter(p=>p.inHand && p.cards.length===2 && typeof p.accountId==='string');
  if(!participants.length)return;
  const winners=new Set((room.pots||[]).filter(p=>!p.refund).flatMap(p=>p.winnerIds||[]));
  const stats=room.statistics ||= {version:1,since:now,counts:{},lastHand:null};
  const seen=new Set();
  for(const p of participants) {
    if(seen.has(p.accountId))continue;seen.add(p.accountId);
    const count=stats.counts[p.accountId] ||= {hands:0,wins:0};
    count.hands++;if(winners.has(p.id))count.wins++;
  }
  stats.lastHand=key;
}
export function accountStatistics(rooms,accountId) {
  let hands=0,wins=0,since=null;
  const seen=new Set();
  for(const room of rooms) {
    if(seen.has(room.id))continue;seen.add(room.id);
    const stats=room.statistics,count=stats?.version===1?stats.counts?.[accountId]:null;
    if(!count || !Number.isSafeInteger(count.hands) || !Number.isSafeInteger(count.wins) || count.hands<0 || count.wins<0 || count.wins>count.hands)continue;
    hands+=count.hands;wins+=count.wins;
    if(Number.isFinite(stats.since))since=since===null?stats.since:Math.min(since,stats.since);
  }
  return {scope:'server',hands,wins,winRate:hands?Math.round(wins/hands*10000)/100:null,since,available:!!accountId};
}
export function playerProfile(room,id,viewerId,rooms) {
  const p=room.players.find(p=>p.id===id && !p.removed);
  if(!p)throw Object.assign(Error('牌手已离开牌桌'),{status:404});
  return {room:room.id,round:room.roundNumber||1,hand:room.hand,player:{
    id:p.id,name:p.name,avatar:p.avatar||null,seatNumber:room.seating?.status==='ready'?room.seating.order.indexOf(p.id)+1:null,
    isBot:!!p.isBot,
    host:room.host===p.id,stack:p.stack,buyin:p.buyin,net:p.stack-p.buyin,totalBet:p.total||0,
    status:p.pendingKick?'本手后移出':p.eliminated?'已淘汰':p.godMode?'上帝模式':!p.inHand?'等待发牌':p.folded?'已弃牌':p.stack===0?'全下':'在赛',
    pendingKick:!!p.pendingKick,
  },statistics:accountStatistics(rooms,p.accountId),canKick:room.gameMode==='friends' && room.host===viewerId && p.id!==viewerId && !p.pendingKick && room.phase!=='ended',sampledAt:Date.now()};
}
