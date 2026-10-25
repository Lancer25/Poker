import {advanceFlop,startHand as deal} from '../server/game.js';
import {rollSeats,beginSeating} from '../server/friend-room.js';
export function prepareSeating(room){
  if(room.gameMode!=='friends' || room.hand!==0 || room.phase!=='waiting')return;
  if(room.seating?.status==='idle')beginSeating(room,room.host);
  const players=room.players.filter(p=>!p.removed);
  for(let i=0;i<players.length;i++) {
    if(!room.seating?.pending.includes(players[i].id) || room.seating.rolls[players[i].id]?.lastRound===room.seating.rollRound)continue;
    const total=12-i,values=[Math.min(6,total-1),total-Math.min(6,total-1)];let j=0;
    rollSeats(room,players[i].id,{version:room.seating.version,rollRound:room.seating.rollRound},()=>values[j++]);
  }
}
export function startHand(room,...args){prepareSeating(room);return deal(room,...args);}
export async function rollNetworkSeats(peers,until){
  if(peers[0].state.seating?.status==='idle') {
    const host=peers.find(p=>p.state.me===p.state.host);
    host.send('start');await until(()=>peers.every(p=>p.state.seating?.status==='rolling'));
  }
  while(true) {
    await until(()=>peers.every(p=>p.state.seating?.version===peers[0].state.seating?.version && p.state.seating?.rollRound===peers[0].state.seating?.rollRound && p.state.seating?.status===peers[0].state.seating?.status));
    if(peers[0].state.seating?.status!=='rolling')return;
    const s=peers[0].state.seating;
    const sent=new Set();
    for(const p of peers)if(p.state?.seating?.canRoll && !sent.has(p.state.me)){sent.add(p.state.me);p.send('rollseat',{version:s.version,rollRound:s.rollRound});}
    await until(()=>peers.every(p=>p.state.seating?.status==='ready') || peers[0].state.seating.rollRound!==s.rollRound);
  }
}
export function completeFlop(room){
  if(!room.flopReveal)return false;
  while(room.flopReveal)advanceFlop(room,room.flopReveal.nextAt ?? room.flopReveal.startedAt+room.board.length*1000);
  return true;
}
