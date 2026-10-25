import {randomUUID} from 'node:crypto';

const activeHand = room => ['preflop','flop','turn','river'].includes(room.phase);
function running(room) {
  const t=room.tournament;
  return room.gameMode==='friends' && !!t && t.startedAt!==null &&
    !t.completed && !t.cancelled && !t.stopRequested && !room.idleEndRequested &&
    room.phase!=='ended' && room.phase!=='waiting';
}
export function hasQueuedFriendRebuy(room,id) {
  return room.gameMode==='friends' && room.requests.some(r=>r.kind==='friend-rebuy' && r.player===id && r.status==='approved');
}
export function canRequestFriendRebuy(room,id) {
  const p=room.players.find(p=>p.id===id);
  return running(room) && !!p && !p.removed && !p.pendingKick && p.eliminated===true && p.stack===0 &&
    !room.requests.some(r=>r.player===id);
}
function log(room,message) { room.log.push(message);room.log=room.log.slice(-12); }
export function friendRebuyCommand(room,id,type,data) {
  if(!running(room))throw Error('本场未开始或已结束，不能补充筹码');
  const player=room.players.find(p=>p.id===id);
  if(type==='rebuy') {
    if(!player || player.removed || player.pendingKick || !player.eliminated || player.stack!==0)throw Error('仅结算后已淘汰且筹码为 0 的牌手可申请');
    if(room.requests.some(r=>r.player===id))throw Error('已有待处理或待到账的申请');
    if(data.amount!==undefined && data.amount!==room.initial)throw Error('只能申请开局时的初始筹码');
    if(player.buyin+room.initial>100000000)throw Error('累计筹码超出上限');
    const voters=room.players.filter(p=>p.id!==id && !p.removed && !p.eliminated && (p.stack>0 || (activeHand(room) && p.inHand))).map(p=>p.id);
    if(!voters.length)throw Error('没有可审批的牌手');
    room.requests.push({id:randomUUID(),kind:'friend-rebuy',player:id,amount:room.initial,status:'pending',voters,approvals:[],requestedHand:room.hand});
    log(room,`${player.name} 申请补充 ${room.initial} 筹码，等待全员同意`);
    return;
  }
  const request=room.requests.find(r=>r.id===data.request && r.kind==='friend-rebuy');
  if(!request)throw Error('申请不存在或已处理');
  if(type==='cancelrebuy') {
    if(request.player!==id)throw Error('仅申请人本人可撤销');
    room.requests=room.requests.filter(r=>r!==request);
    log(room,`${player.name} 撤销了补筹码申请`);
    return;
  }
  if(!player || !request.voters.includes(id))throw Error('你不在本次审批名单中');
  if(type==='approve' && request.approvals.includes(id))return;
  if(request.status!=='pending' || request.approvals.includes(id))throw Error('本次申请已审批');
  if(type==='reject') {
    room.requests=room.requests.filter(r=>r!==request);
    log(room,`${player.name} 拒绝了补筹码申请`);
    return;
  }
  const applicant=room.players.find(p=>p.id===request.player);
  if(!applicant || applicant.buyin+request.amount>100000000)throw Error('申请玩家无效或累计筹码超出上限');
  request.approvals.push(id);
  if(request.voters.every(v=>request.approvals.includes(v))) {
    request.status='approved';applicant.godMode=false;
    log(room,`${applicant.name} 补筹码申请全员通过，下一手到账`);
  }
}
export function refreshFriendPlaces(room) {
  const remaining=room.players.filter(p=>!p.removed && !p.eliminated).length;
  const standings=room.tournament.standings.filter(s=>{const p=room.players.find(p=>p.id===s.id);return p && !p.removed && p.eliminated;})
    .sort((a,b)=>b.eliminatedHand-a.eliminatedHand || b.rankingStack-a.rankingStack);
  let place=remaining+1;
  for(let i=0;i<standings.length;) {
    let end=i+1;
    while(end<standings.length && standings[end].eliminatedHand===standings[i].eliminatedHand && standings[end].rankingStack===standings[i].rankingStack)end++;
    for(let j=i;j<end;j++) {
      standings[j].place=place;standings[j].tied=end-i>1;
      room.players.find(p=>p.id===standings[j].id).place=place;
    }
    place+=end-i;i=end;
  }
  room.tournament.standings=standings;
}
export function applyFriendRebuys(room) {
  if(!running(room))return [];
  const queued=room.requests.filter(r=>r.kind==='friend-rebuy' && r.status==='approved');
  for(const req of queued) {
    const p=room.players.find(p=>p.id===req.player);
    if(!p || p.removed || p.pendingKick || !p.eliminated || p.stack!==0 || req.amount!==room.initial || p.buyin+req.amount>100000000 ||
       !req.voters.length || !req.voters.every(id=>req.approvals.includes(id)))throw Error('待到账的补筹码申请无效');
  }
  const messages=[];
  if(queued.length && !Number.isSafeInteger(room.tournament.totalChips))
    room.tournament.totalChips=room.players.reduce((sum,p)=>sum+p.stack,0);
  for(const req of queued) {
    const p=room.players.find(p=>p.id===req.player);
    p.stack+=req.amount;p.buyin+=req.amount;p.eliminated=false;p.place=null;p.godMode=false;
    room.tournament.totalChips+=req.amount;
    messages.push(`${p.name} 补充 ${req.amount} 筹码，累计投入 ${p.buyin}`);
  }
  if(queued.length)refreshFriendPlaces(room);
  room.requests=room.requests.filter(r=>!queued.includes(r));
  return messages;
}
export function friendRebuyRequests(room,id) {
  return room.requests.filter(r=>r.kind==='friend-rebuy').map(r=>({
    id:r.id,kind:r.kind,player:r.player,amount:r.amount,status:r.status,
    voters:[...r.voters],approvals:[...r.approvals],
    votes:r.voters.map(v=>({id:v,name:room.players.find(p=>p.id===v)?.name || '',approved:r.approvals.includes(v)})),
    canApprove:running(room) && r.status==='pending' && r.voters.includes(id) && !r.approvals.includes(id),
    canCancel:running(room) && r.player===id,
  }));
}
