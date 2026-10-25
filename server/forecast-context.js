import {forecastKey} from './hand-forecast.js';
export function forecastContext(room,playerId,params) {
  const p=room.players.find(p=>p.id===playerId);
  if(!p || p.removed || !p.inHand || p.folded || p.godMode || room.flopReveal || !['preflop','flop','turn','river'].includes(room.phase))throw Object.assign(Error('当前状态不提供牌面预测'),{status:409});
  if(Number(params.round)!==(room.roundNumber||1) || Number(params.hand)!==room.hand || params.phase!==room.phase || Number(params.boardCount)!==room.board.length)throw Object.assign(Error('牌局状态已更新'),{status:409});
  const input={cards:[...p.cards],board:[...room.board]};
  let key;try{key=forecastKey(input);}catch{throw Object.assign(Error('当前牌面暂不可预测'),{status:409});}
  return {input,key,round:room.roundNumber||1,hand:room.hand,phase:room.phase,boardCount:room.board.length};
}
