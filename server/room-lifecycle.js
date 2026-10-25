import { command } from "./game.js";
export const ROOM_IDLE_TIMEOUT_MS = 600000;
function onlineMembers(
  sockets,
  rooms,
  getUser,
  now = Date.now(),
  heartbeatTimeout = 45000,
  spectators = false,
) {
  const map = new Map();
  for (const ws of sockets) {
    if (
      ws.readyState !== 1 ||
      !ws.identity ||
      !Number.isFinite(ws.lastPongAt) ||
      now - ws.lastPongAt > heartbeatTimeout
    )
      continue;
    const room = rooms.get(ws.identity.room),
      user = getUser(ws.authToken);
    const members = spectators
      ? room?.gameMode==='friends' ? room.spectators || [] : []
      : room?.players || [];
    if (
      !room ||
      !user ||
      user.id !== ws.accountId ||
      !members.some(
        (p) => !p.removed && p.id === ws.identity.player && p.accountId === user.id,
      )
    )
      continue;
    if (!map.has(room.id)) map.set(room.id, new Set());
    map.get(room.id).add(ws.identity.player);
  }
  return map;
}
export function onlinePlayers(...args) { return onlineMembers(...args); }
export function onlineSpectators(sockets, rooms, getUser, now = Date.now(), heartbeatTimeout = 45000) {
  return onlineMembers(sockets, rooms, getUser, now, heartbeatTimeout, true);
}
export function updateLifecycle(
  room,
  online,
  now = Date.now(),
  timeout = ROOM_IDLE_TIMEOUT_MS,
) {
  if (room.phase === "ended") return false;
  let changed = false;
  const expired =
    Number.isFinite(room.idleSince) && now - room.idleSince >= timeout;
  if (online.size > 0 && !room.idleEndRequested && !expired) {
    if (room.idleSince !== null) {
      room.idleSince = null;
      changed = true;
    }
    return changed;
  }
  if (!Number.isFinite(room.idleSince)) {
    room.idleSince = now;
    changed = true;
  }
  if (!room.idleEndRequested && now - room.idleSince >= timeout) {
    room.idleEndRequested = true;
    room.endReason = "idle";
    changed = true;
    room.log.push("无人在线已达时限，本场将自动结束");
    if (room.tournament) room.tournament.stopRequested = true;
  }
  if (room.idleEndRequested && ["waiting", "showdown"].includes(room.phase)) {
    command(room, room.host, "end");
    changed = true;
  }
  return changed;
}
export function lifecycleView(
  room,
  online,
  now = Date.now(),
  timeout = ROOM_IDLE_TIMEOUT_MS,
) {
  const status =
    room.phase === "ended"
      ? "ended"
      : room.idleEndRequested
        ? "ending"
        : online.size === 0
          ? "offline"
          : room.phase === "waiting"
            ? "waiting"
            : room.phase === "showdown"
              ? "showdown"
              : "playing";
  const labels = {
    ended: "本场已结束",
    ending: "结算后自动结束",
    offline: "无人在线",
    waiting: "等待开局",
    showdown: "本手已结算",
    playing: "正在打牌",
  };
  const idleSince = Number.isFinite(room.idleSince)
    ? room.idleSince
    : status === "offline"
      ? now
      : null;
  return {
    status,
    statusLabel: labels[status],
    onlineCount: online.size,
    playerCount: room.players.filter(p=>!p.removed).length,
    idleSince,
    idleDeadline:
      status === "offline" && Number.isFinite(idleSince)
        ? idleSince + timeout
        : null,
    endReason: room.endReason || null,
    lastActivityAt: room.lastActivityAt || null,
  };
}
