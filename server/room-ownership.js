import { AccountError } from "./accounts.js";

export function recoverUnclaimedHost(room, user) {
  if (!room) throw new AccountError("房间不存在", 404);
  if (room.phase === "ended" && room.endReason !== "idle")
    throw new AccountError("房间已结束，不能恢复房主", 409);
  const previous = room.players.find((p) => p.id === room.host);
  if (!previous) throw new AccountError("房主身份不存在", 409);
  if(previous.isBot)throw new AccountError('测试陪练不能绑定账号或恢复房主',403);
  if (previous.accountId) {
    if (previous.accountId === user.id)
      return { ok: true, hostRecovered: false };
    throw new AccountError("房主已关联其他账号", 409);
  }
  const current = room.players.find((p) => p.accountId === user.id);
  if (current) room.host = current.id;
  else {
    previous.accountId = user.id;
    previous.name = user.nickname;
  }
  return { ok: true, hostRecovered: true };
}

export function bindLegacyPlayer(room, user, playerId) {
  const player = room?.players.find((p) => p.id === playerId);
  if (!player) throw new AccountError("旧玩家不存在", 404);
  if(player.isBot)throw new AccountError('测试陪练不能绑定账号',403);
  if (player.accountId && player.accountId !== user.id)
    throw new AccountError("该玩家已关联其他账号", 409);
  const existing = room.players.find(
    (p) => p.id !== playerId && p.accountId === user.id,
  );
  if (existing) {
    if (room.host === player.id && !player.accountId)
      return recoverUnclaimedHost(room, user);
    throw new AccountError("此账号在房间中已有身份", 409);
  }
  player.accountId = user.id;
  player.name = user.nickname;
  return { ok: true, hostRecovered: false };
}

export function claimLegacyRooms(rooms, sessions, user, tokens) {
  const candidates = new Map();
  for (const token of tokens) {
    const identity = typeof token === "string" && sessions.get(token);
    const room = identity && rooms.get(identity.room);
    const player = room?.players.find((p) => p.id === identity.player);
    if (!player || player.isBot || (player.accountId && player.accountId !== user.id)) continue;
    const list = candidates.get(room.id) || [];
    if (!list.includes(player)) list.push(player);
    candidates.set(room.id, list);
  }
  const claimed = [],
    hostRecovered = [];
  for (const [id, players] of candidates) {
    const room = rooms.get(id);
    const existing = room.players.find((p) => p.accountId === user.id);
    const host = players.find((p) => p.id === room.host && !p.accountId);
    if (existing) {
      // A host token proves ownership even if an earlier migration chose a guest seat.
      if (host && (room.phase !== "ended" || room.endReason === "idle")) {
        recoverUnclaimedHost(room, user);
        hostRecovered.push(id);
      }
      continue;
    }
    const chosen = host || players.find((p) => !p.accountId);
    if (!chosen) continue;
    bindLegacyPlayer(room, user, chosen.id);
    claimed.push(id);
  }
  return { claimed, hostRecovered };
}
