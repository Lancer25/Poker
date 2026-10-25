import {publicHistory,publicResults} from './room-history.js';
export function historyVersion(room) {
  return `${room.roundNumber || 1}:${room.history?.length || 0}:${room.completedRounds?.length || 0}${room.historyRevision ? ':'+room.historyRevision : ''}`;
}
function summary(round) {
  return {number:round.number,hand:round.hand,finishedAt:round.finishedAt || null,
    ...(round.testRound?{testRound:true}:{}),
    gameMode:round.gameMode || 'cash',chipMode:round.chipMode || 'reset',
    initial:round.initial,small:round.small,big:round.big,results:publicResults(round.results)};
}
export function previousRound(room) {
  const current=room.roundNumber || 1;
  return (room.completedRounds || []).reduce((latest,r)=>r.number<current && (!latest || r.number>latest.number)?r:latest,null);
}
export function tableRounds(room) {
  const current=room.roundNumber || 1, previous=previousRound(room)?.number;
  return (room.completedRounds || []).filter(r=>r.number===current || r.number===previous);
}
export function historyPage(room,{round='current',offset=0,limit=50}={}, {allowOlder=false}={}) {
  if(!Number.isSafeInteger(offset)||offset<0||offset>1000000||
    !Number.isSafeInteger(limit)||limit<1||limit>50||
    (round!=='current'&&(!Number.isSafeInteger(Number(round))||Number(round)<1)))
    throw Error('历史分页参数无效');
  const current=room.roundNumber || 1;
  const number=round==='current'?current:Number(round);
  const archived=room.completedRounds || [];
  const selected=archived.find(r=>r.number===number) || (number===current?{
    number:current,hand:room.hand,finishedAt:room.finishedAt,gameMode:room.gameMode,
    ...(room.testRound?{testRound:true}:{}),
    history:room.history,results:room.players.map(p=>({id:p.id,name:p.name,buyin:p.buyin,stack:p.stack,net:p.stack-p.buyin})),
  }:null);
  if(!selected) return null;
  const previous=previousRound(room);
  if(!allowOlder && number!==current && number!==previous?.number) {
    const error=Error('仅可查看当前场和上一场，更早记录请通过管理员后台查看');error.status=403;throw error;
  }
  const total=selected.history?.length || 0;
  const end=Math.max(0,total-offset);
  const hands=publicHistory((selected.history || []).slice(Math.max(0,end-limit),end).reverse());
  return {roomId:room.id,version:historyVersion(room),currentRound:current,roundNumber:number,offset,limit,total,hands,
    ...(selected.testRound?{testRound:true}:{}),
    rounds:previous?[summary(previous)]:[]};
}
