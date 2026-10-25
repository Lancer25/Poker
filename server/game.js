import { randomInt, randomUUID } from "node:crypto";
import solver from "pokersolver";
import {chipUnit,requireChipMultiple,potShare} from './chips.js';
import {actionContext} from './action-protocol.js';
import {beginHandEvents,recordHandEvent,finishHandEvents} from './hand-events.js';
import {updateRoomControls,canContinueRoom,realtimeAllowed,roomControlsView} from './room-controls.js';
import {recordHandStatistics} from './player-statistics.js';
import {showCards,canShowCards,manuallyShown} from './manual-reveal.js';
import { handInsight, callPrice } from "./hand-insight.js";
import { historyVersion,previousRound,tableRounds } from "./history-pages.js";
import {roomSpectator,canTakeSeat} from './spectators.js';
import {canRequestFriendRebuy,hasQueuedFriendRebuy,friendRebuyCommand,applyFriendRebuys,friendRebuyRequests} from './friend-rebuys.js';
import {seatedPlayers,resetSeating,beginSeating,rollSeats,requireSeating,kickMember,applyPendingKicks,seatingView,manageableMembers,isRoomKicked} from './friend-room.js';
import {
  isTournament,
  makeTournament,
  beginTournamentHand,
  tournamentPositions,
  finishTournamentHand,
  finishTournamentStatus,
  tournamentView,
  friendBlindCaps,
} from "./tournament.js";
const { Hand } = solver;
export const TURN_TIMEOUT_MS = 60000;
function actionTimeoutMs(room) {
  return (room.turnSeconds ?? TURN_TIMEOUT_MS / 1000) * 1000;
}
export function integer(value, min = 1, max = 1000000) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw Error("请输入有效的整数筹码");
  return value;
}
export function createRoom(
  name,
  chips,
  small,
  big,
  turnSeconds,
  gameMode = "cash",
  blindMinutes,
) {
  if (!["friends", "cash", "standard", "turbo"].includes(gameMode))
    throw Error("未知玩法");
  if (chips === undefined) chips = gameMode === "friends" ? 10000 : gameMode === "cash" ? 1000 : 5000;
  small ??= gameMode === "friends" ? 10 : 5;
  big ??= gameMode === "friends" ? 20 : 10;
  if (turnSeconds === undefined) turnSeconds = gameMode === "friends" ? 30 : 60;
  integer(chips);
  if (gameMode !== "cash" && chips < 100)
    throw Error("淘汰赛初始筹码不能少于 100");
  integer(small);
  integer(big);
  for (const amount of [chips, small, big]) requireChipMultiple(amount, 5);
  if (
    !Number.isSafeInteger(turnSeconds) ||
    turnSeconds < 10 ||
    turnSeconds > 300
  )
    throw Error("行动时限需为 10–300 秒的整数");
  if (big < small) throw Error("大盲不能小于小盲");
  if (gameMode === "friends") {
    const caps = friendBlindCaps(chips, 5);
    if (small > caps.earlySmall || big > caps.earlyBig)
      throw Error(`好友局初始盲注不能超过 ${caps.earlySmall}/${caps.earlyBig}（初始筹码的 1/20）`);
  }
  const room = {
    id: String(randomInt(100000, 1000000)),
    createdAt: new Date().toISOString(),
    players: [],
    host: "",
    initial: chips,
    chipUnit: 5,
    small,
    big,
    turnSeconds,
    gameMode,
    phase: "waiting",
    board: [],
    flopReveal: null,
    dealer: -1,
    turn: -1,
    hand: 0,
    roundNumber: 1,
    roundChipMode: "reset",
    completedRounds: [],
    requests: [],
    history: [],
    log: [],
  };
  if (isTournament(room)) {
    if (gameMode !== "friends") {
      room.small = 25;
      room.big = 50;
    }
    room.ante = 0;
    room.tournament = makeTournament(gameMode, room.small, room.big, blindMinutes);
  }
  const player = joinRoom(room, name);
  room.host = player.id;
  return { room, player };
}
export function joinRoom(room, name) {
  if (room.phase === "ended") throw Error("房间已结束");
  if (isTournament(room) && room.tournament.startedAt !== null)
    throw Error("比赛已开始，不能新加入或重新参赛");
  if (seatedPlayers(room).length >= 9) throw Error("房间已满");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 16)
    throw Error("昵称需要 1 至 16 个字");
  const player = {
    id: randomUUID(),
    name: name.trim(),
    stack: room.initial,
    buyin: room.initial,
    cards: [],
    folded: false,
    inHand: false,
    bet: 0,
    total: 0,
    actedAt: null,
    showWinningCards: true,
  };
  room.players.push(player);
  resetSeating(room);
  return player;
}
function next(room, from, predicate) {
  for (let step = 1; step <= room.players.length; step++) {
    const i = (from + step + room.players.length) % room.players.length;
    if (predicate(room.players[i])) return i;
  }
  return -1;
}
function pay(player, amount) {
  amount = Math.min(amount, player.stack);
  player.stack -= amount;
  player.bet += amount;
  player.total += amount;
}
const live = (p) => p.inHand && !p.folded;
const acting = (p) => live(p) && p.stack > 0;
function canGodMode(room, player) {
  return (
    !!player &&
    !player.removed &&
    (!isTournament(room) || room.gameMode === "friends") &&
    (room.gameMode !== "friends" || !!player.eliminated) &&
    !hasQueuedFriendRebuy(room,player.id) &&
    player.stack === 0 &&
    room.phase !== "ended" &&
    (["waiting", "showdown"].includes(room.phase) || !player.inHand)
  );
}
function applyApprovedRebuys(room) {
  for (const request of room.requests.filter((r) => r.status === "approved")) {
    const player = room.players.find((p) => p.id === request.player);
    if (!player) throw Error("申请玩家不存在");
    if (player.buyin + request.amount > 100000000)
      throw Error("累计筹码超出上限");
    player.stack += request.amount;
    player.buyin += request.amount;
    player.godMode = false;
  }
  room.requests = room.requests.filter((r) => r.status !== "approved");
}
export function startHand(room, id, now = Date.now()) {
  host(room, id);
  updateRoomControls(room,now);
  if(!canContinueRoom(room))throw Error('请等待牌手返回并准备，或由房主恢复暂停');
  if (room.idleEndRequested) throw Error("本场正在自动结束，请结算后再开一场");
  if (!["waiting", "showdown"].includes(room.phase))
    throw Error("当前手牌尚未结束");
  requireSeating(room);
  if (!isTournament(room)) applyApprovedRebuys(room);
  const rebuyMessages=room.gameMode==='friends' ? applyFriendRebuys(room) : [];
  if (room.players.filter((p) => !p.removed && p.stack > 0).length < 2)
    throw Error("至少需要两名有筹码的玩家");
  if (room.hand === 0) {room.roundStartedAt = new Date(now).toISOString();room.testRound=seatedPlayers(room).some(p=>p.isBot);}
  if (isTournament(room)) beginTournamentHand(room, now);
  const deck = [];
  for (const rank of "23456789TJQKA")
    for (const suit of "shdc") deck.push(rank + suit);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  room.deck = deck;
  room.board = [];
  room.flopReveal = null;
  room.phase = "preflop";
  room.showdownAt = null;
  room.highlightedWinnerIds = [];
  room.hand++;
  room.actionVersion=(room.actionVersion||0)+1;
  room.pots = [];
  room.log = rebuyMessages;
  for (const p of room.players)
    Object.assign(p, {
      inHand: !p.removed && p.stack > 0 && !p.eliminated,
      godMode: (!isTournament(room) || room.gameMode === "friends") && p.stack === 0 && !!p.godMode,
      folded: false,
      bet: 0,
      total: 0,
      antePaid: 0,
      finishStack: p.stack,
      actedAt: null,
      cards: [],
    });
  let positions;
  if (isTournament(room)) {
    positions = tournamentPositions(room);
    room.dealer = positions.dealer;
    room.smallBlindIndex = positions.smallBlind;
    room.bigBlindIndex = positions.bigBlind;
  } else room.dealer = next(room, room.dealer, (p) => p.inHand);
  const dealOrder = isTournament(room)
    ? Array.from(
        { length: room.players.length },
        (_, i) => room.players[(room.dealer + i + 1) % room.players.length],
      )
    : room.players;
  for (let round = 0; round < 2; round++)
    for (const p of dealOrder) if (p.inHand) p.cards.push(deck.pop());
  const headsUp = room.players.filter((p) => p.inHand).length === 2;
  const sb = positions
    ? positions.smallBlind
    : headsUp
      ? room.dealer
      : next(room, room.dealer, live);
  const bb = positions ? positions.bigBlind : next(room, sb, live);
  beginHandEvents(room,now);
  if (room.players[sb].inHand) {pay(room.players[sb], room.small);recordHandEvent(room,'blinds',{player:room.players[sb].id,action:'smallBlind',amount:room.players[sb].bet},now);}
  pay(room.players[bb], room.big);
  recordHandEvent(room,'blinds',{player:room.players[bb].id,action:'bigBlind',amount:room.players[bb].bet},now);
  if (isTournament(room) && room.ante) {
    const payer = room.players[bb];
    payer.antePaid = Math.min(payer.stack, room.ante);
    payer.stack -= payer.antePaid;
    payer.total += payer.antePaid;
    payer.finishStack -= payer.antePaid;
    recordHandEvent(room,'blinds',{player:payer.id,action:'ante',amount:payer.antePaid},now);
  }
  room.currentBet = room.big;
  room.minRaise = room.big;
  room.turn = next(room, bb, acting);
  room.deadline = now + actionTimeoutMs(room);
  advance(room,now);
}
export function host(room, id) {
  if (room.host !== id) throw Error("仅房主可执行此操作");
}
export function action(room, id, type, amount, now = Date.now()) {
  if(room.flopReveal)throw Error('翻牌中，请等待三张公共牌全部翻开');
  const p = room.players[room.turn];
  if (
    !p ||
    p.id !== id ||
    !["preflop", "flop", "turn", "river"].includes(room.phase)
  )
    throw Error("还没轮到你");
  const due = Math.max(0, room.currentBet - p.bet);
  const totalBefore=p.total;
  if (type === "fold") p.folded = true;
  else if (type === "check") {
    if (due) throw Error("需要跟注或弃牌");
  } else if (type === "call") pay(p, due);
  else if (type === "raise" || type === "allin") {
    const target =
      type === "allin" ? p.bet + p.stack : integer(amount, 1, 100000000);
    requireChipMultiple(target, chipUnit(room));
    if (
      isTournament(room) &&
      target > room.currentBet &&
      room.players.filter(acting).length < 2
    )
      throw Error("其他玩家已全下，只能跟注或弃牌");
    if (target > p.bet + p.stack || target <= p.bet)
      throw Error("下注超出可用筹码");
    if (target > room.currentBet) {
      if (p.actedAt !== null && room.currentBet - p.actedAt < room.minRaise)
        throw Error("不足额加注未重新开放加注权");
      const increase = target - room.currentBet;
      if (increase < room.minRaise && target !== p.bet + p.stack)
        throw Error("加注低于最小加注额");
      if (increase >= room.minRaise) {
        room.minRaise = increase;
        for (const other of room.players) if (other !== p) other.actedAt = null;
      }
      room.currentBet = target;
    } else if (type !== "allin") throw Error("加注必须高于当前下注");
    pay(p, target - p.bet);
  } else throw Error("未知操作");
  room.actionVersion=(room.actionVersion||0)+1;
  p.actedAt = room.currentBet;
  room.log.push(
    `${p.name} ${{ fold: "弃牌", check: "过牌", call: "跟注", raise: "加注", allin: "全下" }[type]}${p.folded ? "" : " " + p.bet}`,
  );
  room.log = room.log.slice(-12);
  recordHandEvent(room,'action',{player:p.id,action:type,amount:p.total-totalBefore},now);
  room.turn = next(
    room,
    room.turn,
    (p) => acting(p) && (p.actedAt === null || p.bet < room.currentBet),
  );
  advance(room,now);
  room.deadline = room.turn >= 0 ? now + actionTimeoutMs(room) : null;
}
export function expireTurn(room, now = Date.now()) {
  if (
    room.flopReveal ||
    !["preflop", "flop", "turn", "river"].includes(room.phase) ||
    room.turn < 0 ||
    !Number.isFinite(room.deadline) ||
    now < room.deadline
  )
    return false;
  const player = room.players[room.turn];
  if (!player || !acting(player)) return false;
  action(room, player.id, "fold",undefined,now);
  room.log[room.log.length - 1] = `${player.name} 超时自动弃牌`;
  return true;
}
function beginFlop(room,now,runout=false){
  room.phase='flop';
  if(!runout||isTournament(room))room.deck.pop();
  room.board.push(room.deck.pop());
  room.actionVersion=(room.actionVersion||0)+1;
  if(!runout){for(const p of room.players){p.bet=0;p.actedAt=null;}room.currentBet=0;room.minRaise=room.big;}
  room.turn=-1;room.deadline=null;
  room.flopReveal={startedAt:now,nextAt:now+1000,runout,burnRunout:isTournament(room)};
  recordHandEvent(room,'card',{},now);
}
function finishRunout(room,now,burn=isTournament(room)){
  while(room.board.length<5){if(burn)room.deck.pop();room.board.push(room.deck.pop());recordHandEvent(room,'card',{},now);}
  return settle(room,now);
}
export function advanceFlop(room,now=Date.now()){
  const reveal=room.flopReveal;
  if(!reveal||room.phase!=='flop'||!Number.isFinite(reveal.startedAt))return false;
  const nextAt=reveal.nextAt ?? reveal.startedAt+room.board.length*1000;
  if(room.board.length>=3||now<nextAt)return false;
  room.board.push(room.deck.pop());
  recordHandEvent(room,'card',{},now);
  reveal.nextAt=now+1000;
  if(room.board.length===3){
    room.flopReveal=null;
    if(reveal.runout)finishRunout(room,now,reveal.burnRunout);
    else{room.turn=next(room,room.dealer,acting);room.deadline=room.turn>=0?now+actionTimeoutMs(room):null;}
  }
  return true;
}
function advance(room,now=Date.now()) {
  if (room.players.filter(live).length === 1) return settle(room,now);
  const available = room.players.filter(acting);
  if (isTournament(room) && available.length === 1)
    room.currentBet = Math.min(
      room.currentBet,
      Math.max(...room.players.filter(live).map((p) => p.bet)),
    );
  if (
    available.length <= 1 &&
    (!available.length || available[0].bet >= room.currentBet)
  ) {
    if(!room.board.length)return beginFlop(room,now,true);
    return finishRunout(room,now);
  }
  if (room.turn !== -1) return;
  if (room.phase === "river") return settle(room,now);
  if(room.phase==='preflop')return beginFlop(room,now);
  room.phase = { preflop: "flop", flop: "turn", turn: "river" }[room.phase];
  room.deck.pop();
  for (let i = 0, count = room.phase === "flop" ? 3 : 1; i < count; i++)
    room.board.push(room.deck.pop());
  for (const p of room.players) {
    p.bet = 0;
    p.actedAt = null;
  }
  room.currentBet = 0;
  room.minRaise = room.big;
  room.turn = next(room, room.dealer, acting);
  recordHandEvent(room,'street',{},now);
}
function winnerCardDetails(room,winnerId) {
  const winner=room.players.find(player=>player.id===winnerId);
  const won=(room.pots || []).filter(pot=>!pot.refund).reduce((total,pot)=>{
    const index=pot.winnerIds?.indexOf(winnerId) ?? -1;
    if(index<0)return total;
    return total+potShare(pot.amount,pot.winnerIds.length,index,chipUnit(room));
  },0);
  return {id:winner.id,name:winner.name,cards:[...winner.cards],won,
    handLabel:handInsight({cards:winner.cards,board:room.board,phase:'showdown'})?.label || null};
}
export function settle(room,now=Date.now()) {
  if(room.flopReveal)throw Error('翻牌尚未完成，不能提前结算');
  const contenders = room.players.filter(live);
  const liveTotal = (p) => p.total - (p.antePaid || 0);
  let antePool = room.players.reduce((sum, p) => sum + (p.antePaid || 0), 0);
  const levels = [...new Set(room.players.map(liveTotal).filter(Boolean))].sort(
    (a, b) => a - b,
  );
  const solved = new Map(
    contenders.map((p) => [
      p.id,
      contenders.length > 1 ? Hand.solve([...p.cards, ...room.board]) : null,
    ]),
  );
  let previous = 0;
  room.pots = [];
  const award = (amount, eligible, extra = {}) => {
    const best =
      contenders.length === 1
        ? null
        : Hand.winners(eligible.map((p) => solved.get(p.id)));
    const winners = eligible.filter(
      (p) => best === null || best.includes(solved.get(p.id)),
    );
    winners.sort(
      (a, b) =>
        ((room.players.indexOf(a) - room.dealer - 1 + room.players.length) %
          room.players.length) -
        ((room.players.indexOf(b) - room.dealer - 1 + room.players.length) %
          room.players.length),
    );
    winners.forEach(
      (p, i) =>
        (p.stack +=
          potShare(amount, winners.length, i, chipUnit(room))),
    );
    room.pots.push({
      amount,
      winners: winners.map((p) => p.name),
      winnerIds: winners.map((p) => p.id),
      ...extra,
    });
  };
  for (const level of levels) {
    const contributors = room.players.filter((p) => liveTotal(p) >= level);
    let amount = (level - previous) * contributors.length;
    previous = level;
    const eligible = contributors.filter(live);
    if (contributors.length === 1) {
      if (antePool) {
        award(antePool, contenders, { ante: true });
        antePool = 0;
      }
      contributors[0].stack += amount;
      room.pots.push({
        amount,
        winners: [contributors[0].name],
        winnerIds: [contributors[0].id],
        refund: true,
      });
      continue;
    }
    if (!eligible.length) throw Error("底池无有效争夺者");
    amount += antePool;
    antePool = 0;
    award(amount, eligible);
  }
  if (antePool) award(antePool, contenders, { ante: true });
  room.phase = "showdown";
  room.turn = -1;
  room.deadline = null;
  room.reveal = contenders.length > 1;
  room.showdownAt = now;
  if (room.gameMode === "friends")
    room.highlightedWinnerIds = !room.reveal ? [] : [...new Set(
      room.pots.filter((pot) => !pot.refund).flatMap((pot) => pot.winnerIds || []),
    )].filter((winnerId) => room.players.find((p) => p.id === winnerId)?.showWinningCards !== false);
  recordHandStatistics(room,now);
  applyPendingKicks(room);
  if (isTournament(room)) finishTournamentHand(room, now);
  updateRoomControls(room,now);
  if(room.gameMode==='friends' && room.phase==='ended')room.requests=[];
  room.history.push({
    hand: room.hand,
    replay:finishHandEvents(room,now),
    chipUnit: chipUnit(room),
    ...(room.testRound?{testRound:true}:{}),
    shownPlayers: [],
    board: [...room.board],
    shownWinners: room.gameMode==='friends' && room.reveal
      ? room.highlightedWinnerIds.map(id=>winnerCardDetails(room,id)) : [],
    pots: room.pots,
    results: results(room),
    ...(isTournament(room)
      ? {
          level: room.tournament.level,
          small: room.small,
          big: room.big,
          ante: room.ante,
        }
      : {}),
  });
  if (!isTournament(room)) applyApprovedRebuys(room);
  if (room.phase === "ended") archiveRound(room);
}
export function advanceTournament(room, now = Date.now()) {
  updateRoomControls(room,now);
  if(!canContinueRoom(room))return false;
  if(room.gameMode==='friends' && room.phase==='waiting' && room.hand===0 &&
    room.seating?.status==='ready' && Number.isFinite(room.seating.autoStartAt) &&
    now>=room.seating.autoStartAt && (!Number.isFinite(room.tournament?.nextHandAt)||now>=room.tournament.nextHandAt) && !room.idleEndRequested) {
    startHand(room,room.host,now);
    return true;
  }
  if (
    !isTournament(room) ||
    room.phase !== "showdown" ||
    !Number.isFinite(room.tournament.nextHandAt) ||
    now < room.tournament.nextHandAt
  )
    return false;
  startHand(room, room.host, now);
  return true;
}
export function results(room) {
  return room.players.map((p) => ({
    id: p.id,
    name: p.name,
    buyin: p.buyin,
    stack: p.stack,
    net: p.stack - p.buyin,
    ...(p.removed?{removed:true}:{}),
  }));
}
function archiveRound(room) {
  const number = room.roundNumber || 1;
  room.completedRounds ??= [];
  if (room.completedRounds.some((r) => r.number === number)) return;
  room.completedRounds.push(
    structuredClone({
      number,
      ...(room.testRound?{testRound:true}:{}),
      chipMode: room.roundChipMode || "reset",
      gameMode: room.gameMode || "cash",
      startedAt: room.roundStartedAt || null,
      finishedAt: room.finishedAt || new Date().toISOString(),
      endReason:
        room.endReason || (room.tournament?.completed ? "completed" : "manual"),
      hand: room.hand,
      initial: room.initial,
      chipUnit: chipUnit(room),
      small: room.small,
      big: room.big,
      turnSeconds: room.turnSeconds || 60,
      results: results(room),
      history: room.history,
      tournament: isTournament(room) ? tournamentView(room, Date.now()) : null,
    }),
  );
}
function restartRound(room, id, data) {
  host(room, id);
  if (room.phase !== "ended") throw Error("请先结束本场，再开一场");
  const number = room.roundNumber || 1,
    chipMode = data.chipMode ?? "reset";
  if (data.round !== number) throw Error("场次已更新，请刷新后再试");
  if (!["reset", "carry"].includes(chipMode))
    throw Error("请选择重置或保留筹码");
  if (room.gameMode === "friends") {
    const caps = friendBlindCaps(room.initial, chipUnit(room));
    if (room.tournament.baseSmall > caps.earlySmall || room.tournament.baseBig > caps.earlyBig)
      throw Error(`原房间初始盲注超过 ${caps.earlySmall}/${caps.earlyBig}，请新建好友局`);
  }
  if (
    isTournament(room) &&
    chipMode === "carry" &&
    room.players.some((p) => !p.removed && p.stack === 0)
  )
    throw Error("淘汰赛已有零筹码玩家，请重置筹码再开");
  integer(room.initial);
  archiveRound(room);
  Object.assign(room, {
    roundNumber: number + 1,
    testRound:seatedPlayers(room).some(p=>p.isBot),
    roundChipMode: chipMode,
    idleSince: null,
    idleEndRequested: false,
    endReason: null,
    phase: "waiting",
    hand: 0,
    board: [],
    deck: [],
    pots: [],
    history: [],
    requests: [],
    dealer: -1,
    turn: -1,
    deadline: null,
    reveal: false,
    showdownAt: null,
    highlightedWinnerIds: [],
    flopReveal: null,
    currentBet: 0,
    minRaise: room.big,
    log: [
      `第 ${number + 1} 场 · ${chipMode === "reset" ? "筹码已重置" : "保留筹码"} · 等待发牌`,
    ],
  });
  delete room.finishedAt;
  delete room.roundStartedAt;
  delete room.smallBlindIndex;
  delete room.bigBlindIndex;
  for (const p of room.players) {
    const stack = p.removed ? 0 : chipMode === "reset" ? room.initial : p.stack;
    Object.assign(p, {
      stack,
      buyin: stack,
      cards: [],
      folded: false,
      inHand: false,
      bet: 0,
      total: 0,
      actedAt: null,
      antePaid: 0,
      finishStack: stack,
      godMode: false,
      eliminated: false,
      place: null,
      pendingKick:false,
    });
  }
  if (isTournament(room)) {
    const small = room.gameMode === "friends" ? room.tournament.baseSmall : 25;
    const big = room.gameMode === "friends" ? room.tournament.baseBig : 50;
    if (room.gameMode === "friends" && room.tournament.blindPolicy !== "timed" && (room.turnSeconds === undefined || room.turnSeconds === 60))
      room.turnSeconds = 30;
    const blindMinutes = room.gameMode === "friends" && room.tournament.blindPolicy === "timed" && room.tournament.blindStructure === "gentle3"
      ? room.tournament.levelDurationMs / 60000 : undefined;
    room.tournament = makeTournament(room.gameMode, small, big, blindMinutes);
    room.small = small;
    room.big = big;
    room.ante = 0;
    room.minRaise = big;
  }
  resetSeating(room);
  updateRoomControls(room,Date.now());
}
export function command(room, id, type, data = {}) {
  const member=room.players.find(p=>p.id===id);
  if(member?.removed)throw Error('你已被房主移出牌桌');
  if(type==='showcards')return showCards(room,id,data);
  if(type==='rollseat')return rollSeats(room,id,data);
  if(type==='kick') {
    const immediate=kickMember(room,id,data);
    if(immediate && room.phase==='showdown') {
      finishTournamentStatus(room,Date.now());
      if(room.phase==='ended'){room.requests=[];archiveRound(room);}
    }
    return;
  }
  if(room.gameMode==='friends' && ['rebuy','approve','reject','cancelrebuy'].includes(type))
    return friendRebuyCommand(room,id,type,data);
  if (type === "restart") return restartRound(room, id, data);
  if (type === "winningcards") {
    if (room.gameMode !== "friends") throw Error("仅好友局可设置获胜亮牌");
    const player = room.players.find((p) => p.id === id);
    if (!player) throw Error("玩家身份无效");
    if (typeof data.enabled !== "boolean") throw Error("亮牌设置无效");
    player.showWinningCards = data.enabled;
    return;
  }
  if (type === "godmode") {
    if (isTournament(room) && room.gameMode !== "friends" && data.enabled)
      throw Error("淘汰赛不开放实时看底牌");
    const player = room.players.find((p) => p.id === id);
    if (!player) throw Error("玩家身份无效");
    if (typeof data.enabled !== "boolean") throw Error("旁观模式参数无效");
    if (data.enabled && !canGodMode(room, player))
      throw Error("仅筹码为 0 且不在当前手牌中的玩家可开启上帝模式");
    player.godMode = data.enabled;
    return;
  }
  if (type === "start") {
    updateRoomControls(room,Date.now());
    if(!canContinueRoom(room))throw Error('请等待牌手返回并准备，或由房主恢复暂停');
    if (isTournament(room) && room.tournament.startedAt !== null)
      throw Error("赛事由系统自动继续，不能手动重新发牌");
    if(room.gameMode==='friends' && room.hand===0 && room.phase==='waiting' &&
      (room.seating?.status!=='ready' || Number.isFinite(room.seating?.autoStartAt)))
      return beginSeating(room,id);
    return startHand(room, id);
  }
  if (type === "rebuy") {
    if (isTournament(room)) throw Error("淘汰赛不能补充筹码或复活");
    integer(data.amount);
    requireChipMultiple(data.amount, chipUnit(room));
    if (room.phase === "ended") throw Error("房间已结束");
    if (room.requests.some((r) => r.player === id))
      throw Error("已有待处理或待到账的申请");
    room.requests.push({
      id: randomUUID(),
      player: id,
      amount: data.amount,
      status: "pending",
    });
    return;
  }
  if (type === "approve" || type === "reject") {
    if (isTournament(room)) throw Error("淘汰赛不能补充筹码或复活");
    host(room, id);
    if (room.phase === "ended") throw Error("房间已结束");
    const r = room.requests.find((r) => r.id === data.request);
    if (!r) throw Error("申请不存在");
    if (type === "approve") {
      const p = room.players.find((p) => p.id === r.player);
      if (!p) throw Error("申请玩家不存在");
      if (p.buyin + r.amount > 100000000) throw Error("累计筹码超出上限");
      r.status = "approved";
      if (["waiting", "showdown"].includes(room.phase))
        applyApprovedRebuys(room);
      return;
    }
    room.requests = room.requests.filter((x) => x.id !== r.id);
    return;
  }
  if (type === "end") {
    host(room, id);
    if (
      isTournament(room) &&
      !["waiting", "showdown", "ended"].includes(room.phase)
    ) {
      if (!room.idleEndRequested) room.endReason = "manual";
      room.tournament.stopRequested = true;
      return;
    }
    if (!["waiting", "showdown"].includes(room.phase))
      throw Error("请在手牌结束后结束房间");
    if (!room.idleEndRequested) room.endReason = "manual";
    room.phase = "ended";
    if(room.gameMode==='friends')room.requests=[];
    room.finishedAt = new Date().toISOString();
    if (isTournament(room)) {
      room.tournament.cancelled = true;
      room.tournament.nextHandAt = null;
    }
    archiveRound(room);
    return;
  }
  return action(room, id, type, data.amount);
}
export function snapshot(room, id, {compact = false, now = Date.now()} = {}) {
  updateRoomControls(room,now);
  if(room.players.find(p=>p.id===id)?.removed || isRoomKicked(room,id))throw Error('你已被房主移出牌桌');
  const p = room.players.find((p) => p.id === id);
  const spectator = roomSpectator(room, id);
  const turn = room.players[room.turn];
  const participating = room.players.filter((player) => player.inHand).length;
  const hasDealer = participating >= 2 && !!room.players[room.dealer]?.inHand;
  const smallBlind =
    isTournament(room) && room.hand > 0
      ? room.smallBlindIndex
      : !hasDealer
        ? -1
        : participating === 2
          ? room.dealer
          : next(room, room.dealer, (player) => player.inHand);
  const bigBlind =
    isTournament(room) && room.hand > 0
      ? room.bigBlindIndex
      : hasDealer
        ? next(room, smallBlind, (player) => player.inHand)
        : -1;
  const godMode = (!!spectator && realtimeAllowed(room) && room.phase !== 'ended') || (!!p?.godMode && canGodMode(room, p));
  const publicShowdown =
    room.phase === "showdown" ||
    (isTournament(room) && room.tournament.completed);
  const actualWinners = [...new Set(
    (room.pots || []).filter((pot) => !pot.refund).flatMap((pot) => pot.winnerIds || []),
  )];
  const highlightedWinners = new Set(room.highlightedWinnerIds ?? actualWinners.filter(
    (winnerId) => room.players.find((player) => player.id === winnerId)?.showWinningCards !== false,
  ));
  const winnerFocus = room.gameMode === "friends" &&
    room.reveal &&
    ["showdown", "ended"].includes(room.phase) &&
    Number.isFinite(room.showdownAt) && Date.now() < room.showdownAt + 5000
      ? actualWinners.filter((winnerId) => {
          const winner = room.players.find((player) => player.id === winnerId);
          return winner && live(winner) && (winnerId === id || highlightedWinners.has(winnerId));
        }).map(winnerId=>winnerCardDetails(room,winnerId))
      : [];
  const insight = p && !room.flopReveal
    ? handInsight({
        cards: p.cards,
        board: room.board,
        phase: room.phase,
        folded: p.folded,
      })
    : null;
  if (insight)
    insight.callPrice = callPrice({
      pot: room.players.reduce((sum, player) => sum + player.total, 0),
      toCall: Math.max(0, (room.currentBet || 0) - p.bet),
      stack: p.stack,
      actionable: turn?.id === id,
      headsUp:
        room.players.filter((player) => player.inHand && !player.folded)
          .length === 2,
      covered: room.players.every(
        (player) =>
          player.total - (player.antePaid || 0) <=
          p.total -
            (p.antePaid || 0) +
            Math.max(0, (room.currentBet || 0) - p.bet),
      ),
    });
  return {
    serverTime: now,
    actionVersion: room.actionVersion || 0,
    actionContext: actionContext(room,id),
    roomControls:roomControlsView(room,id),
    turnSeconds: actionTimeoutMs(room) / 1000,
    gameMode: room.gameMode || "cash",
    tournament: tournamentView(room, now),
    godMode,
    spectating: !!spectator,
    spectator: spectator ? {id:spectator.id,name:spectator.name,avatar:spectator.avatar||null} : null,
    canTakeSeat: !!spectator && canTakeSeat(room),
    showWinningCards: p?.showWinningCards !== false,
    canShowCards: canShowCards(room,p),
    hasShownCards: !!p && manuallyShown(room,p),
    winnerFocus,
    showdownAt: room.showdownAt || null,
    canGodMode: canGodMode(room, p),
    canRequestRebuy: canRequestFriendRebuy(room,id),
    insight,
    id: room.id,
    ...(room.testRound?{testRound:true}:{}),
    host: room.host,
    me: id,
    initial: room.initial,
    chipUnit: chipUnit(room),
    seating:seatingView(room,id),
    manageableMembers:manageableMembers(room,id),
    seatedCount:seatedPlayers(room).length,
    small: room.small,
    big: room.big,
    phase: room.phase,
    flopReveal: room.flopReveal ? {revealed:room.board.length,total:3,
      startedAt:room.flopReveal.startedAt,nextAt:room.flopReveal.nextAt ?? room.flopReveal.startedAt+room.board.length*1000,
      endsAt:(room.flopReveal.nextAt ?? room.flopReveal.startedAt+room.board.length*1000)+(2-room.board.length)*1000} : null,
    hand: room.hand,
    roundNumber: room.roundNumber || 1,
    previousRoundNumber: previousRound(room)?.number || null,
    roundChipMode: room.roundChipMode || "reset",
    canCarryRound:
      !isTournament(room) || seatedPlayers(room).every((p) => p.stack > 0),
    ...(compact ? {transportVersion:2,historyVersion:historyVersion(room),historyCount:room.history.length,
      completedRoundCount:room.completedRounds?.length || 0} : {completedRounds:tableRounds(room)}),
    dealer: room.dealer,
    smallBlind,
    bigBlind,
    turn: room.turn,
    deadline: room.deadline,
    board: room.board,
    pot: ["waiting", "showdown", "ended"].includes(room.phase)
      ? 0
      : room.players.reduce((s, p) => s + p.total, 0),
    currentBet: room.currentBet || 0,
    minRaise: room.minRaise || room.big,
    toCall: p ? Math.max(0, (room.currentBet || 0) - p.bet) : 0,
    canRaise:
      !room.flopReveal &&
      !!p &&
      (!isTournament(room) || room.players.filter(acting).length > 1) &&
      turn?.id === id &&
      (p.actedAt === null || room.currentBet - p.actedAt >= room.minRaise),
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      ...(p.isBot?{isBot:true}:{}),
      avatar: p.avatar || null,
      stack: p.stack,
      buyin: p.buyin,
      bet: p.bet,
      totalBet: p.total || 0,
      antePaid: p.antePaid || 0,
      eliminated: !!p.eliminated,
      removed:!!p.removed,
      pendingKick:!!p.pendingKick,
      seatNumber:room.seating?.status==='ready' && !p.removed ? room.seating.order.indexOf(p.id)+1 : null,
      place: p.place || null,
      folded: p.folded,
      inHand: p.inHand,
      godMode: !!p.godMode && canGodMode(room, p),
      handLabel:
        (publicShowdown && room.reveal && live(p)) || manuallyShown(room,p)
          ? handInsight({
              cards: p.cards,
              board: room.board,
              phase: "showdown",
            })?.label || null
          : null,
      cards:
        p.id === id || godMode || (publicShowdown && room.reveal && live(p)) || manuallyShown(room,p)
          ? p.cards
          : p.cards.map(() => "??"),
    })),
    requests: room.gameMode==='friends' ? friendRebuyRequests(room,id) : room.requests.filter((r) => id === room.host || r.player === id),
    pots: room.pots || [],
    log: compact ? room.log.slice(-6) : room.log,
    results: results(room),
    ...(compact ? {} : {history:room.history}),
  };
}
