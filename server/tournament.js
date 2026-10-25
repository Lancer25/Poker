import { randomInt } from "node:crypto";
export const NEXT_HAND_DELAY_MS = 6000;
export const FRIENDS_NEXT_HAND_DELAY_MS = 5000;
const blinds = [
  [25, 50],
  [50, 100],
  [75, 150],
  [100, 200],
  [150, 300],
  [200, 400],
  [300, 600],
  [400, 800],
  [600, 1200],
  [800, 1600],
  [1000, 2000],
  [1500, 3000],
  [2000, 4000],
  [3000, 6000],
  [4000, 8000],
  [6000, 12000],
  [8000, 16000],
  [12000, 24000],
  [16000, 32000],
  [24000, 48000],
  [32000, 64000],
  [50000, 100000],
  [75000, 150000],
  [100000, 200000],
  [150000, 300000],
  [200000, 400000],
  [300000, 600000],
  [500000, 1000000],
  [1000000, 2000000],
  [2000000, 4000000],
  [4000000, 8000000],
  [8000000, 16000000],
];
const friendBlinds = [
  [10, 20], [15, 30], [25, 50], [40, 80], [75, 150],
  [125, 250], [200, 400], [300, 600], [500, 1000],
  [750, 1500], [1000, 2000],
];
const FRIEND_LEVEL_MS = 180000;
import {chipUnit} from './chips.js';
export const isTournament = (room) =>
  ["friends", "standard", "turbo"].includes(room.gameMode);
export function friendBlindCaps(initial, unit = 1) {
  const earlySmall = Math.floor(initial / 20 / unit) * unit, small = Math.floor(initial / 10 / unit) * unit;
  return { earlySmall, earlyBig: earlySmall * 2, small, big: small * 2 };
}
export function makeTournament(gameMode, small = 10, big = 20, blindMinutes = FRIEND_LEVEL_MS / 60000) {
  if (gameMode === "friends" && (!Number.isSafeInteger(blindMinutes) || blindMinutes < 1 || blindMinutes > 30))
    throw Error("升盲间隔需为 1-30 分钟的整数");
  return {
    format: "freezeout",
    levelDurationMs: gameMode === "friends" ? blindMinutes * 60000 : gameMode === "turbo" ? 300000 : 600000,
    ...(gameMode === "friends" ? { baseSmall: small, baseBig: big, blindPolicy: "timed", blindStructure: "gentle3" } : {}),
    startedAt: null,
    level: 1,
    nextHandAt: null,
    completed: false,
    cancelled: false,
    standings: [],
  };
}
export function levelInfo(index) {
  const bounded = Math.max(1, Math.min(index, blinds.length));
  const [small, big] = blinds[bounded - 1];
  return { level: bounded, small, big, ante: bounded <= 2 ? 0 : big };
}
export function currentLevel(room, now) {
  const t = room.tournament;
  if (room.gameMode === "friends") {
    if (t.blindPolicy !== "timed")
      return Math.max(t.level,1 + room.players.filter((p) => p.eliminated).length);
    if (t.blindStructure === "gentle3") {
      const elapsed = t.startedAt === null ? 0 : Math.max(0, now - t.startedAt);
      let level = 1;
      while (level < friendMaxLevel(room) && elapsed >= friendLevelStartsAfter(room, level + 1)) level++;
      return level;
    }
    return Math.min(friendMaxLevel(room), t.startedAt === null ? 1 :
      Math.floor(Math.max(0, now - t.startedAt) / t.levelDurationMs) + 1);
  }
  return t.startedAt === null
    ? 1
    : levelInfo(
        Math.floor(Math.max(0, now - t.startedAt) / t.levelDurationMs) + 1,
      ).level;
}
function friendMaxLevel(room) {
  if (room.tournament.blindPolicy === "timed" && room.tournament.blindStructure === "gentle3")
    return friendBlinds.length;
  return room.tournament.blindPolicy === "timed"
    ? Math.max(1, 1 + Math.floor(Math.log2(100000000 / room.tournament.baseBig))) : 9;
}
function steppedFriendLevel(room, level) {
  const unit = chipUnit(room), caps = friendBlindCaps(room.initial, unit);
  const tableSmall = level === 1 ? 0 : Math.max(unit, Math.floor(friendBlinds[level - 1][0] * room.initial / 10000 / unit) * unit);
  return {
    level,
    small: Math.min(caps.small, Math.max(Math.min(room.tournament.baseSmall, caps.earlySmall), tableSmall)),
    big: Math.min(caps.big, Math.max(Math.min(room.tournament.baseBig, caps.earlyBig), tableSmall * 2)),
    ante: 0,
  };
}
function friendLevelStartsAfter(room, level) {
  const blinds = steppedFriendLevel(room, level), caps = friendBlindCaps(room.initial, chipUnit(room));
  const earlyGate = blinds.small > caps.earlySmall || blinds.big > caps.earlyBig ? 20 * 60000 : 0;
  return Math.max((level - 1) * room.tournament.levelDurationMs, earlyGate);
}
function roomLevelInfo(room, index) {
  if (room.gameMode !== "friends") return levelInfo(index);
  const level = Math.max(1, Math.min(index, friendMaxLevel(room)));
  if (room.tournament.blindPolicy === "timed" && room.tournament.blindStructure === "gentle3")
    return steppedFriendLevel(room, level);
  return { level, small: room.tournament.baseSmall * 2 ** (level - 1), big: room.tournament.baseBig * 2 ** (level - 1), ante: 0 };
}
export function beginTournamentHand(room, now) {
  const t = room.tournament;
  if (t.startedAt === null) {
    t.startedAt = now;
    t.totalChips = room.players.reduce((sum, p) => sum + p.stack, 0);
  }
  const scheduledLevel = currentLevel(room, now);
  t.level = room.gameMode === "friends" && t.blindPolicy === "timed" && t.blindStructure === "gentle3"
    ? Math.min(t.level + 1, scheduledLevel)
    : scheduledLevel;
  t.announcedLevel = t.level;
  t.nextHandAt = null;
  Object.assign(room, roomLevelInfo(room, t.level));
}
function nextAlive(room, from) {
  for (let i = 1; i <= room.players.length; i++) {
    const index = (from + i + room.players.length) % room.players.length;
    if (room.players[index].inHand) return index;
  }
  return -1;
}
export function tournamentPositions(room) {
  const alive = room.players
    .map((p, i) => (p.inHand ? i : -1))
    .filter((i) => i >= 0);
  if (alive.length < 2) throw Error("至少需要两名未淘汰玩家");
  if (!Number.isInteger(room.bigBlindIndex)) {
    const first=room.seating?.status==='ready' ? room.players.findIndex(p=>p.id===room.seating.order[0]) : -1;
    const dealer = alive.includes(first) ? first : alive[randomInt(alive.length)];
    const smallBlind = alive.length === 2 ? dealer : nextAlive(room, dealer);
    return { dealer, smallBlind, bigBlind: nextAlive(room, smallBlind) };
  }
  const bigBlind = nextAlive(room, room.bigBlindIndex);
  if (alive.length === 2) {
    const dealer = nextAlive(room, bigBlind);
    return { dealer, smallBlind: dealer, bigBlind };
  }
  return {
    dealer: room.smallBlindIndex,
    smallBlind: room.bigBlindIndex,
    bigBlind,
  };
}
export function finishTournamentHand(room, now) {
  const t = room.tournament;
  const remainingBefore = room.players.filter((p) => !p.removed && !p.eliminated).length;
  const busted = room.players
    .filter((p) => !p.removed && p.inHand && !p.eliminated && p.stack === 0)
    .sort((a, b) => b.finishStack - a.finishStack);
  let place = remainingBefore - busted.length + 1;
  for (let i = 0; i < busted.length; ) {
    const group = busted.filter((p) => p.finishStack === busted[i].finishStack);
    for (const p of group) {
      p.eliminated = true;
      p.place = place;
      t.standings.push({
        id: p.id,
        name: p.name,
        place,
        tied: group.length > 1,
        eliminatedHand: room.hand,
        rankingStack: p.finishStack,
      });
    }
    place += group.length;
    i += group.length;
  }
  finishTournamentStatus(room,now);
}
export function finishTournamentStatus(room,now) {
  const t=room.tournament;
  if(t.completed || t.cancelled)return;
  const survivors = room.players.filter((p) => !p.removed && !p.eliminated && p.stack > 0);
  if (survivors.length === 1) {
    const champion = survivors[0];
    champion.place = 1;
    t.standings.push({
      id: champion.id,
      name: champion.name,
      place: 1,
      tied: false,
      eliminatedHand: null,
    });
    t.championId = champion.id;
    t.completed = true;
    t.nextHandAt = null;
    t.finishedAt = now;
    room.phase = "ended";
    room.finishedAt = new Date(now).toISOString();
  } else if (t.stopRequested || survivors.length===0) {
    t.cancelled = true;
    t.nextHandAt = null;
    t.finishedAt = now;
    room.phase = "ended";
    room.finishedAt = new Date(now).toISOString();
  } else if(!Number.isFinite(t.nextHandAt))t.nextHandAt = now + (room.gameMode === "friends" ? FRIENDS_NEXT_HAND_DELAY_MS : NEXT_HAND_DELAY_MS);
}
export function recoverFriendCountdown(room, now) {
  const t = room.tournament;
  if (room.gameMode !== "friends" || room.phase !== "showdown" || !t ||
      !Number.isFinite(t.startedAt) || Number.isFinite(t.nextHandAt) ||
      t.completed || t.cancelled || t.stopRequested || room.idleEndRequested)
    return false;
  t.nextHandAt = now + FRIENDS_NEXT_HAND_DELAY_MS;
  return true;
}
export function tournamentView(room, now) {
  if (!isTournament(room)) return null;
  const t = room.tournament;
  const friends = room.gameMode === "friends";
  const timed = !friends || t.blindPolicy === "timed";
  const maxLevel = friends ? friendMaxLevel(room) : blinds.length;
  const running = t.startedAt !== null && !t.completed && !t.cancelled;
  const scheduledLevel = running ? currentLevel(room, now) : t.level;
  const gentle = friends && t.blindPolicy === "timed" && t.blindStructure === "gentle3";
  const pendingLevel = gentle && t.level > Math.min(maxLevel, scheduledLevel)
    ? roomLevelInfo(room, Math.min(maxLevel, scheduledLevel))
    : scheduledLevel > t.level
      ? roomLevelInfo(room, gentle ? t.level + 1 : scheduledLevel)
      : null;
  return {
    format: t.format,
    speed: room.gameMode,
    blindPolicy: timed ? "timed" : "elimination",
    blindStructure: friends ? t.blindStructure || null : null,
    ...(gentle ? { blindCaps: friendBlindCaps(room.initial, chipUnit(room)) } : {}),
    started: t.startedAt !== null,
    level: t.level,
    scheduledLevel,
    pendingLevel,
    levelDurationSeconds: t.levelDurationMs / 1000,
    nextLevelAt:
      timed && running && scheduledLevel < maxLevel
        ? t.startedAt + (gentle ? friendLevelStartsAfter(room, scheduledLevel + 1) : scheduledLevel * t.levelDurationMs)
        : null,
    nextLevel:
      scheduledLevel < maxLevel ? roomLevelInfo(room, scheduledLevel + 1) : null,
    applied: roomLevelInfo(room, t.level),
    ante: room.ante || 0,
    nextHandAt: t.nextHandAt,
    remaining: room.players.filter((p) => !p.removed && !p.eliminated).length,
    entrants: room.players.filter(p=>!p.removed).length,
    completed: t.completed,
    cancelled: t.cancelled,
    championId: t.championId || null,
    stopRequested: !!t.stopRequested,
    deadButton: t.startedAt !== null && !room.players[room.dealer]?.inHand,
    deadSmallBlind:
      t.startedAt !== null && !room.players[room.smallBlindIndex]?.inHand,
    standings: room.players
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar || null,
        stack: p.stack,
        place: p.place || null,
        eliminated: !!p.eliminated,
        ...(p.removed?{removed:true}:{}),
        tied: t.standings.find((s) => s.id === p.id)?.tied || false,
      }))
      .sort((a, b) => (a.place || 0) - (b.place || 0) || b.stack - a.stack),
  };
}
export function announceTournamentLevel(room, now = Date.now()) {
  if (
    !isTournament(room) ||
    (room.gameMode === "friends" && room.tournament.blindPolicy !== "timed") ||
    room.tournament.startedAt === null ||
    room.phase === "ended"
  )
    return false;
  const level = currentLevel(room, now);
  if (level <= (room.tournament.announcedLevel || room.tournament.level))
    return false;
  room.tournament.announcedLevel = level;
  return true;
}
