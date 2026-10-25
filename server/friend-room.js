import {randomInt,randomUUID} from 'node:crypto';
import {refreshFriendPlaces} from './friend-rebuys.js';
export const seatedPlayers=room=>room.players.filter(p=>!p.removed);
const inProgress=room=>['preflop','flop','turn','river'].includes(room.phase);
export function isRoomKicked(room,identity) {
  return room?.gameMode==='friends' && [...room.players,...(room.spectators||[])].some(p=>
    p.removed && p.kickedRound===(room.roundNumber||1) && (p.id===identity || (!!p.accountId && p.accountId===identity)));
}
export function resetSeating(room) {
  if(room.gameMode!=='friends' || room.phase!=='waiting' || room.hand!==0)return;
  room.seating={version:randomUUID(),status:'idle',rollRound:0,rolls:{},pending:seatedPlayers(room).map(p=>p.id),order:[]};
}
export function beginSeating(room,id) {
  if(room.host!==id)throw Error('仅房主可以开始比赛');
  if(room.phase!=='waiting' || room.hand!==0 || room.idleEndRequested)throw Error('当前不能开始排座');
  if(seatedPlayers(room).filter(p=>p.stack>0).length<2)throw Error('至少需要两名有筹码的玩家');
  if(!room.seating)resetSeating(room);
  if(room.seating.status==='idle')room.seating.status='rolling';
}
function compareRolls(a,b) {
  for(let i=0;i<Math.min(a.length,b.length);i++) {
    const difference=b[i].reduce((x,y)=>x+y,0)-a[i].reduce((x,y)=>x+y,0);
    if(difference)return difference;
  }
  return 0;
}
export function rollSeats(room,id,data,draw=randomInt,now=Date.now()) {
  if(room.gameMode!=='friends' || room.phase!=='waiting' || room.hand!==0 || room.tournament.startedAt!==null || room.idleEndRequested)throw Error('仅开局前可以掷骰排座');
  const s=room.seating;
  if(!s || data.version!==s.version || data.rollRound!==s.rollRound)throw Error('掷骰状态已过期，请刷新后重试');
  if(seatedPlayers(room).length<2)throw Error('至少两名牌手入座后才能掷骰');
  if(s.status!=='rolling' || !s.pending.includes(id))throw Error('当前无需你掷骰');
  const entry=s.rolls[id] || {history:[],lastRound:-1};
  if(entry.lastRound===s.rollRound)throw Error('本轮已掷骰，请等待其他牌手');
  entry.history.push([draw(1,7),draw(1,7)]);entry.lastRound=s.rollRound;entry.rolledAt=now;s.rolls[id]=entry;
  if(!s.pending.every(p=>s.rolls[p]?.lastRound===s.rollRound))return;
  const sorted=seatedPlayers(room).sort((a,b)=>compareRolls(s.rolls[a.id].history,s.rolls[b.id].history));
  const ties=[];
  for(let i=0;i<sorted.length;) {
    let end=i+1;
    while(end<sorted.length && compareRolls(s.rolls[sorted[i].id].history,s.rolls[sorted[end].id].history)===0)end++;
    if(end-i>1)ties.push(...sorted.slice(i,end).map(p=>p.id));
    i=end;
  }
  if(ties.length){s.pending=ties;s.rollRound++;return;}
  s.status='ready';s.pending=[];s.order=sorted.map(p=>p.id);s.autoStartAt=now+2400;
}
export function requireSeating(room) {
  if(room.gameMode!=='friends' || room.hand!==0)return;
  const s=room.seating,players=seatedPlayers(room);
  if(!s || s.status!=='ready' || players.length!==s.order.length || !players.every(p=>s.order.includes(p.id)))
    throw Error('请等待所有牌手完成掷骰排座');
  room.players=[...s.order.map(id=>players.find(p=>p.id===id)),...room.players.filter(p=>p.removed)];
}
export function seatingView(room,id) {
  if(room.gameMode!=='friends' || !room.seating)return null;
  const s=room.seating;
  return {version:s.version,status:s.status,rollRound:s.rollRound,autoStartAt:s.autoStartAt??null,
    canRoll:room.phase==='waiting' && room.hand===0 && seatedPlayers(room).length>=2 && s.status==='rolling' && s.pending.includes(id) && s.rolls[id]?.lastRound!==s.rollRound,
    entries:seatedPlayers(room).map(p=>({id:p.id,name:p.name,dice:s.rolls[p.id]?.history.at(-1)||[],
      totals:s.rolls[p.id]?.history.map(d=>d[0]+d[1])||[],rolledAt:s.rolls[p.id]?.rolledAt??null,
      needsRoll:s.status==='rolling' && s.pending.includes(p.id) && s.rolls[p.id]?.lastRound!==s.rollRound,
      seatNumber:s.status==='ready'?s.order.indexOf(p.id)+1:null})),
  };
}
function applyKick(room,target) {
  target.removed=true;target.pendingKick=false;target.kickedRound=room.roundNumber||1;target.godMode=false;
  target.place=null;
  if(room.tournament?.startedAt!==null)refreshFriendPlaces(room);
  room.requests=room.requests.filter(r=>r.player!==target.id && !r.voters?.includes(target.id));
  room.log.push(`${target.name} 已被房主移出本场`);room.log=room.log.slice(-12);
  resetSeating(room);
}
export function kickMember(room,id,data) {
  if(room.gameMode!=='friends')throw Error('仅好友局可移出成员');
  if(room.host!==id)throw Error('仅房主可移出成员');
  if(data.round!==(room.roundNumber||1))throw Error('场次已更新，请重新确认');
  if(room.phase==='ended')throw Error('本场已结束');
  if(data.player===id)throw Error('房主不能移出自己');
  const target=[...room.players,...(room.spectators||[])].find(p=>p.id===data.player && !p.removed);
  if(!target)throw Error('成员不存在或已移出');
  if(target.pendingKick)return false;
  if(inProgress(room) && room.players.includes(target)) {
    target.pendingKick=true;
    room.log.push(`${target.name} 将在本手结算后移出`);room.log=room.log.slice(-12);return false;
  }
  applyKick(room,target);return true;
}
export function applyPendingKicks(room) {
  if(room.gameMode!=='friends')return;
  for(const p of room.players)if(p.pendingKick && !p.removed)applyKick(room,p);
}
export function rejoinRemoved(room,player) {
  if(isRoomKicked(room,player.id))throw Error('你已被房主移出本场');
  if(room.phase!=='waiting' || room.hand!==0 || room.tournament?.startedAt!==null || seatedPlayers(room).length>=9)
    throw Error('只能在新一场开局前且有空位时重新入座');
  Object.assign(player,{removed:false,pendingKick:false,eliminated:false,place:null,stack:room.initial,buyin:room.initial,cards:[],inHand:false,folded:false,bet:0,total:0,antePaid:0,actedAt:null,godMode:false});
  resetSeating(room);return player;
}
export function manageableMembers(room,id) {
  if(room.gameMode!=='friends' || room.host!==id || room.phase==='ended')return [];
  return [...seatedPlayers(room),...(room.spectators||[]).filter(p=>!p.removed)].filter(p=>p.id!==id)
    .map(p=>({id:p.id,name:p.name,spectating:!room.players.includes(p),pendingKick:!!p.pendingKick}));
}
