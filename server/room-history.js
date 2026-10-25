import {roomMember} from './spectators.js';
import {publicReplay} from './hand-events.js';
export const RECENT_ROOM_LIMIT = 5;
function timestamp(value) {
  if (Number.isFinite(value)) return value;
  const n = Date.parse(value);
  return Number.isFinite(n) ? n : 0;
}
export function recentRooms(rooms, user) {
  const list = [...rooms.values()]
    .map((room, index) => ({
      room,
      index,
      player: roomMember(room, user.id),
    }))
    .filter((item) => item.player);
  list.sort(
    (a, b) =>
      timestamp(b.player.lastVisitedAt) - timestamp(a.player.lastVisitedAt) ||
      timestamp(b.room.createdAt) - timestamp(a.room.createdAt) ||
      b.index - a.index,
  );
  return (user.role === "admin" ? list : list.slice(0, RECENT_ROOM_LIMIT)).map(
    (item) => item.room,
  );
}
export function canViewHistory(room, user, rooms) {
  return (
    room.phase !== "ended" ||
    user.role === "admin" ||
    recentRooms(rooms, user).some((r) => r.id === room.id)
  );
}
export function publicResults(list = []) {
  return list.map((p) => ({
    id: p.id,
    name: p.name,
    buyin: p.buyin,
    stack: p.stack,
    net: p.net,
    ...(p.removed?{removed:true}:{}),
  }));
}
export function publicHistory(list = []) {
  return list.map((hand) => ({
    hand: hand.hand,
    replay:publicReplay(hand),
    ...(hand.testRound?{testRound:true}:{}),
    board: Array.isArray(hand.board) ? [...hand.board] : undefined,
    pots: (hand.pots || []).map((p) => ({
      amount: p.amount,
      winners: [...(p.winners || [])],
      winnerIds: p.winnerIds ? [...p.winnerIds] : undefined,
      refund: !!p.refund,
    })),
    results: publicResults(hand.results),
    ...(Array.isArray(hand.shownWinners)?{shownWinners:publicShownWinners(hand)}:{}),
    ...(Array.isArray(hand.shownPlayers)?{shownPlayers:publicShownPlayers(hand)}:{}),
  }));
}
function publicShownPlayers(hand) {
  const ids=new Set((hand.results||[]).map(player=>player.id)),seen=new Set();
  return hand.shownPlayers.filter(player=>{
    if(!player || !ids.has(player.id) || seen.has(player.id) || !Array.isArray(player.cards) || player.cards.length!==2 ||
      !player.cards.every(card=>typeof card==='string' && /^[2-9TJQKA][shdc]$/.test(card)) || new Set(player.cards).size!==2) return false;
    seen.add(player.id);return true;
  }).slice(0,9).map(player=>({id:player.id,name:typeof player.name==='string'?player.name.slice(0,64):'',cards:[...player.cards],
    handLabel:typeof player.handLabel==='string'?player.handLabel.slice(0,64):null}));
}
function publicShownWinners(hand) {
  const ids=new Set((hand.pots || []).filter(p=>!p.refund).flatMap(p=>p.winnerIds || [])),seen=new Set();
  return hand.shownWinners.filter(w=>{
    if(!w || !ids.has(w.id) || seen.has(w.id) || !Array.isArray(w.cards) || w.cards.length!==2 ||
      !w.cards.every(c=>typeof c==='string'&&/^[2-9TJQKA][shdc]$/.test(c)) || new Set(w.cards).size!==2 ||
      !Number.isSafeInteger(w.won) || w.won<0)return false;
    seen.add(w.id);return true;
  }).slice(0,9).map(w=>({id:w.id,name:typeof w.name==='string'?w.name.slice(0,64):'',cards:[...w.cards],won:w.won,
    handLabel:typeof w.handLabel==='string'?w.handLabel.slice(0,64):null}));
}
function publicRound(r, ended = true) {
  return {
    number: r.number,
    ...(r.testRound?{testRound:true}:{}),
    hand: r.hand,
    gameMode: r.gameMode || "cash",
    chipMode: r.chipMode || "reset",
    initial: r.initial,
    small: r.small,
    big: r.big,
    startedAt: r.startedAt || null,
    finishedAt: r.finishedAt || null,
    endReason: r.endReason || null,
    ended,
    results: publicResults(r.results),
    history: publicHistory(r.history),
    tournament: r.tournament
      ? {
          completed: !!r.tournament.completed,
          cancelled: !!r.tournament.cancelled,
          championId: r.tournament.championId || null,
          standings: (r.tournament.standings || []).map((p) => ({
            id: p.id,
            name: p.name,
            place: p.place,
            tied: !!p.tied,
            stack: p.stack,
          })),
        }
      : null,
  };
}
export function adminHistory(room) {
  const records = new Map();
  for (const r of room.completedRounds || [])
    if (!records.has(r.number)) records.set(r.number, publicRound(r));
  const number = room.roundNumber || 1;
  if (!records.has(number))
    records.set(
      number,
      publicRound(
        {
          number,
          hand: room.hand,
          ...(room.testRound?{testRound:true}:{}),
          gameMode: room.gameMode,
          chipMode: room.roundChipMode,
          initial: room.initial,
          small: room.small,
          big: room.big,
          startedAt: room.roundStartedAt,
          finishedAt: room.finishedAt,
          endReason: room.endReason,
          results: room.players.map((p) => ({
            id: p.id,
            name: p.name,
            buyin: p.buyin,
            stack: p.stack,
            net: p.stack - p.buyin,
          })),
          history: room.history,
        },
        room.phase === "ended",
      ),
    );
  return {
    room: {
      id: room.id,
      hostName: room.players.find((p) => p.id === room.host)?.name || "-",
      gameMode: room.gameMode || "cash",
      phase: room.phase,
      roundNumber: number,
      createdAt: room.createdAt || null,
      lastActivityAt: room.lastActivityAt || null,
    },
    rounds: [...records.values()].sort((a, b) => b.number - a.number),
  };
}
