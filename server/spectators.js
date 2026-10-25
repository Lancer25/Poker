import {randomUUID} from 'node:crypto';
import {isRoomKicked,seatedPlayers} from './friend-room.js';

export function roomMember(room, accountId) {
  return room?.players.find(p=>p.accountId===accountId && !p.removed) ||
    (room?.gameMode==='friends' ? room.spectators?.find(p=>p.accountId===accountId && !p.removed) : undefined) ||
    room?.players.find(p=>p.accountId===accountId);
}
export function roomSpectator(room, id) {
  const spectator=room.gameMode==='friends' ? room.spectators?.find(p=>p.id===id) : undefined;
  return spectator && !spectator.removed && !room.players.some(p=>p.accountId===spectator.accountId && !p.removed) ? spectator : undefined;
}
export function addSpectator(room, user) {
  if (room.gameMode!=='friends') throw Error('仅好友局支持观战');
  if(isRoomKicked(room,user.id))throw Error('你已被房主移出本场');
  if (room.players.some(p=>p.accountId===user.id && !p.removed)) throw Error('已入座的账号请重连牌桌，淘汰后可开启上帝模式');
  const existing=room.spectators?.find(p=>p.accountId===user.id);
  if(existing){existing.removed=false;return existing;}
  if(room.phase==='ended')throw Error('本场已结束，暂不能新加入观战');
  if((room.spectators?.length||0)>=50)throw Error('房间观战人数已达上限');
  const spectator={id:randomUUID(),accountId:user.id,name:user.nickname,avatar:user.avatar||null};
  (room.spectators??=[]).push(spectator);
  return spectator;
}
export function canTakeSeat(room) {
  return room.gameMode==='friends' && room.phase==='waiting' && room.hand===0 &&
    room.tournament?.startedAt===null && seatedPlayers(room).length<9 && !room.idleEndRequested;
}
