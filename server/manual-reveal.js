import {handInsight} from './hand-insight.js';

const settled = room => ['showdown','ended'].includes(room.phase);
function currentHand(room) {
  const record=room.history?.at(-1);
  return record?.hand===room.hand ? record : null;
}
function eligible(room,player) {
  return room.gameMode==='friends' && settled(room) && room.hand>0 && !!currentHand(room) &&
    !!player && !player.removed && player.inHand && Array.isArray(player.cards) && player.cards.length===2 &&
    player.cards.every(card=>typeof card==='string' && /^[2-9TJQKA][shdc]$/.test(card));
}
export function manuallyShown(room,player) {
  return settled(room) && !!currentHand(room)?.shownPlayers?.some(entry=>entry.id===player?.id);
}
export function canShowCards(room,player) {
  return !!eligible(room,player) && !manuallyShown(room,player) && !(room.reveal && !player.folded);
}
export function showCards(room,id,data) {
  if(data.round!==(room.roundNumber||1) || data.hand!==room.hand) throw Error('手牌已更新，不能补亮上一手');
  const player=room.players.find(p=>p.id===id);
  if(!eligible(room,player)) throw Error('仅本手结算后的在桌牌手可以亮牌');
  if(manuallyShown(room,player)) return;
  if(room.reveal && !player.folded) throw Error('手牌已公开');
  const record=currentHand(room);
  const entry={id:player.id,name:player.name,cards:[...player.cards],
    handLabel:handInsight({cards:player.cards,board:room.board,phase:'showdown'})?.label||null};
  record.shownPlayers ??=[];
  record.shownPlayers.push(entry);
  const archive=room.completedRounds?.find(round=>round.number===(room.roundNumber||1));
  const archivedHand=archive?.history?.find(hand=>hand.hand===room.hand);
  if(archivedHand && archivedHand!==record) archivedHand.shownPlayers=structuredClone(record.shownPlayers);
  room.historyRevision=(room.historyRevision||0)+1;
}
