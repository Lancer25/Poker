import {randomUUID} from 'node:crypto';
import {isRoomKicked} from './friend-room.js';

export const MAX_SPECTATOR_REQUESTS = 50;
export const SPECTATOR_REQUEST_TTL_MS = 10 * 60 * 1000;
const boundary = room => ['waiting', 'showdown'].includes(room.phase);
const activeHand = room => ['preflop', 'flop', 'turn', 'river'].includes(room.phase);
const round = room => room.roundNumber || 1;
const controlled = room => room.gameMode === 'friends' && !!room.controls;
const survivors = room => room.players.filter(p => !p.removed && !p.pendingKick && !p.eliminated &&
  (p.stack > 0 || (activeHand(room) && p.inHand)));
const member = (room, id) => room.players.find(p => p.id === id && !p.removed && !p.pendingKick);
const ready = (controls, player) => !!player.isBot || controls.seats[player.id]?.ready === true;
const seat = (controls, id) => controls.seats[id] ??= {ready: false, away: false, pendingAway: null};
const defaults = {admission: 'approval', reveal: 'public', requireReady: false};

function validateSettings(options) {
  if (options.admission !== undefined && !['approval', 'open', 'closed'].includes(options.admission))
    throw Error('观战准入设置无效');
  if (options.reveal !== undefined && !['public', 'realtime'].includes(options.reveal))
    throw Error('观战亮牌设置无效');
  if (options.requireReady !== undefined && typeof options.requireReady !== 'boolean')
    throw Error('准备设置无效');
}

export function initializeControls(room, options = {}) {
  if (room.gameMode !== 'friends') return null;
  if (room.controls) return room.controls;
  validateSettings(options);
  if (options.autoApproveBots !== undefined &&
      (typeof options.autoApproveBots !== 'boolean' || (options.autoApproveBots && !room.testRound)))
    throw Error('自动测试投票仅可在测试场启用');
  room.controls = {
    version: 1, round: round(room), readyEpoch: 0,
    settings: Object.fromEntries(Object.keys(defaults).map(key => [key, options[key] ?? defaults[key]])),
    seats: {}, pause: null, spectatorRequests: [], autoApproveBots: options.autoApproveBots === true,
  };
  return room.controls;
}

export function realtimeAllowed(room) {
  return !controlled(room) || room.controls.settings.reveal === 'realtime';
}

export function canContinueRoom(room) {
  if (!controlled(room)) return true;
  const c = room.controls;
  if (c.pause?.state === 'active') return false;
  return survivors(room).every(p => {
    const s = c.seats[p.id];
    const away = boundary(room) && typeof s?.pendingAway === 'boolean' ? s.pendingAway : s?.away;
    return !away && (!c.settings.requireReady || ready(c, p));
  });
}

function accountPause(room, now) {
  const pause = room.controls.pause;
  if (pause?.state !== 'active') return false;
  const elapsed = Math.max(0, now - pause.clockAt);
  if (Number.isFinite(room.tournament?.startedAt)) room.tournament.startedAt += elapsed;
  pause.clockAt = Math.max(now, pause.clockAt);
  return elapsed > 0;
}

export function updateRoomControls(room, now = Date.now()) {
  if (!controlled(room)) return false;
  if (!Number.isFinite(now)) throw Error('时间无效');
  const c = room.controls;
  const clockChanged = c.round === round(room) && accountPause(room, now);
  const before = JSON.stringify(c);
  c.readyEpoch ??= 0;
  if (c.round !== round(room)) {
    c.readyEpoch++;
    c.round = round(room); c.seats = {}; c.pause = null; c.spectatorRequests = [];
  }
  const players = survivors(room), ids = players.map(p => p.id);
  for (const id of Object.keys(c.seats)) if (!room.players.some(p => p.id === id && !p.removed)) delete c.seats[id];
  if (boundary(room)) {
    for (const s of Object.values(c.seats)) if (typeof s.pendingAway === 'boolean') {
      s.away = s.pendingAway; s.pendingAway = null;
      if (s.away) s.ready = false;
    }
  }
  c.spectatorRequests = c.spectatorRequests.filter(r => r.round === c.round &&
    now - r.requestedAt < SPECTATOR_REQUEST_TTL_MS && !isRoomKicked(room, r.user.id) &&
    !room.players.some(p => !p.removed && p.accountId === r.user.id) &&
    !(room.spectators || []).some(p => !p.removed && p.accountId === r.user.id));
  const pause = c.pause;
  if (room.phase === 'ended') { c.pause = null; c.spectatorRequests = []; }
  else if (pause?.state === 'active') {
    pause.voters = pause.voters.filter(id => ids.includes(id));
    pause.approvals = pause.approvals.filter(id => pause.voters.includes(id));
  }
  else if (pause && pause.state !== 'active') {
    if (!ids.includes(pause.requestedBy) || !ids.length) c.pause = null;
    else {
      pause.voters = ids;
      pause.approvals = pause.approvals.filter(id => ids.includes(id));
      if (c.autoApproveBots && room.testRound) {
        for (const p of players) if (p.isBot && !pause.approvals.includes(p.id)) pause.approvals.push(p.id);
      }
      pause.state = ids.every(id => pause.approvals.includes(id)) ? 'granted' : 'pending';
      if (pause.state === 'granted' && boundary(room)) {
        c.readyEpoch++;
        pause.state = 'active'; pause.startedAt = now; pause.clockAt = now;
        for (const p of players) seat(c, p.id).ready = !!p.isBot;
      }
    }
  }
  const changed = before !== JSON.stringify(c);
  if (changed) c.version++;
  return changed || !!clockChanged;
}

function checkContext(room, type, data) {
  const c = room.controls;
  if (data.round !== round(room) || !Number.isSafeInteger(data.version) || data.version < 0)
    throw Error('房间控制状态已更新，请重新确认');
  const readyIntent = (type === 'ready' || type === 'away') && data.readyEpoch !== undefined;
  if (readyIntent || type === 'pausevote') {
    if (!c || data.version > c.version || (readyIntent &&
        (!Number.isSafeInteger(data.readyEpoch) || data.readyEpoch < 0 || data.readyEpoch !== (c.readyEpoch ?? 0))))
      throw Error('房间控制状态已更新，请重新确认');
    if (type === 'pausevote' && (!c.pause || !['pending', 'granted'].includes(c.pause.state) ||
        c.pause.id !== data.request || c.pause.round !== data.round))
      throw Error('暂停申请不存在或已生效');
  } else if (data.version !== (c?.version || 0)) throw Error('房间控制状态已更新，请重新确认');
}
function requireHost(room, id) {
  if (room.host !== id || !member(room, id)) throw Error('仅房主可以执行此操作');
}
function bool(data) {
  const value = data.value ?? data.enabled;
  if (typeof value !== 'boolean') throw Error('需要明确的开启或关闭值');
  return value;
}

export function roomControlCommand(room, id, type, data = {}, now = Date.now()) {
  if (room.gameMode !== 'friends') throw Error('仅好友局支持房间控制');
  if (!Number.isFinite(now)) throw Error('时间无效');
  if (room.phase === 'ended') throw Error('本场已结束');
  if (!member(room, id)) throw Error('仅在座成员可以操作');
  // Recheck after maintenance: a hand boundary can activate pause and advance the ready epoch.
  checkContext(room, type, data);
  if (type === 'settings') {
    requireHost(room, id);
    const settings = data.settings || data;
    validateSettings(settings);
    if (!Object.keys(defaults).some(key => settings[key] !== undefined)) throw Error('请指定房间设置');
    const c = initializeControls(room, {autoApproveBots: room.testRound === true});
    for (const key of Object.keys(defaults)) if (settings[key] !== undefined) c.settings[key] = settings[key];
    c.spectatorRequests = []; c.version++;
    updateRoomControls(room, now);
    return {status: 'updated'};
  }
  if (!controlled(room)) throw Error('请先由房主启用房间控制');
  const c = room.controls;
  updateRoomControls(room, now);
  checkContext(room, type, data);
  let result = {status: 'updated'};
  if (type === 'ready' || type === 'away') {
    if (!survivors(room).some(p => p.id === id)) throw Error('仅未淘汰牌手可设置状态');
    const value = bool(data), s = seat(c, id);
    if (type === 'ready') {
      if (value && (s.away || s.pendingAway === true)) throw Error('请先返回牌桌');
      s.ready = value;
    } else if (boundary(room)) {
      s.away = value; s.pendingAway = null;
      if (value) s.ready = false;
    } else s.pendingAway = value;
  } else if (type === 'pause') {
    if (!survivors(room).some(p => p.id === id)) throw Error('仅未淘汰牌手可申请暂停');
    if (c.pause) throw Error('已有暂停申请或牌桌已暂停');
    c.pause = {id: randomUUID(), round: round(room), requestedBy: id, requestedAt: now,
      state: 'pending', voters: survivors(room).map(p => p.id), approvals: [id]};
  } else if (type === 'pausevote' || type === 'pausecancel') {
    const p = c.pause;
    if (!p || p.state === 'active' || data.request !== p.id) throw Error('暂停申请不存在或已生效');
    if (type === 'pausecancel') {
      if (p.requestedBy !== id && room.host !== id) throw Error('仅申请人或房主可撤销暂停');
      c.pause = null;
    } else {
      if (!p.voters.includes(id)) throw Error('你不在本次投票名单中');
      if (!bool(data)) c.pause = null;
      else if (!p.approvals.includes(id)) p.approvals.push(id);
    }
  } else if (type === 'resume') {
    requireHost(room, id);
    if (c.pause?.state !== 'active' || !boundary(room)) throw Error('牌桌当前未暂停');
    const players = survivors(room);
    if (!players.length || players.some(p => !ready(c, p) || seat(c, p.id).away || seat(c, p.id).pendingAway === true))
      throw Error('请等待所有剩余牌手返回并准备');
    accountPause(room, now); c.pause = null;
    if (room.tournament) room.tournament.nextHandAt = now + 5000;
  } else if (type === 'spectatorapprove' || type === 'spectatorreject') {
    requireHost(room, id);
    const request = c.spectatorRequests.find(r => r.id === data.request && r.round === data.round);
    if (!request || c.settings.admission !== 'approval') throw Error('观战申请不存在或已过期');
    c.spectatorRequests = c.spectatorRequests.filter(r => r !== request);
    result = {status: type === 'spectatorapprove' ? 'approved' : 'rejected',
      request: request.id, round: request.round, user: {...request.user}};
  } else throw Error('未知房间控制命令');
  c.version++;
  updateRoomControls(room, now);
  return result;
}

export function requestSpectatorAdmission(room, user, now = Date.now()) {
  if (room.gameMode !== 'friends') throw Error('仅好友局支持观战');
  if (!user || typeof user.id !== 'string' || !user.id || user.id.length > 128 ||
      typeof user.nickname !== 'string' || !user.nickname || user.nickname.length > 128 || !Number.isFinite(now))
    throw Error('观战身份无效');
  if (isRoomKicked(room, user.id)) throw Error('你已被房主移出本场');
  if (room.players.some(p => !p.removed && p.accountId === user.id)) throw Error('已入座账号请重连牌桌');
  if ((room.spectators || []).some(p => !p.removed && p.accountId === user.id)) return {status: 'allowed'};
  if (room.phase === 'ended') throw Error('本场已结束');
  if (!controlled(room)) return {status: 'allowed'};
  updateRoomControls(room, now);
  const c = room.controls;
  if (c.settings.admission === 'closed') throw Error('房主已关闭观战申请');
  if (c.settings.admission === 'open') return {status: 'allowed'};
  let request = c.spectatorRequests.find(r => r.user.id === user.id);
  if (!request) {
    if (c.spectatorRequests.length >= MAX_SPECTATOR_REQUESTS) throw Error('观战申请已达上限');
    request = {id: randomUUID(), round: round(room), requestedAt: now,
      user: {id: user.id, nickname: user.nickname}};
    c.spectatorRequests.push(request); c.version++;
  }
  return {status: 'pending', request: {id: request.id, round: request.round, requestedAt: request.requestedAt}};
}

export function roomControlsView(room, id) {
  if (room.gameMode !== 'friends') return null;
  if (!controlled(room)) return {enabled: false, version: 0, round: round(room), readyEpoch: 0, settings: null,
    realtimeAllowed: true, seats: [], pause: null, canManage: room.host === id && !!member(room, id)};
  // Snapshot callers must authenticate membership; pending viewers have no control view at all.
  if (!member(room, id) && !(room.spectators || []).some(p => p.id === id && !p.removed)) return null;
  const c = room.controls, canManage = room.host === id && !!member(room, id);
  return {enabled: true, version: c.version, round: round(room), readyEpoch: c.readyEpoch ?? 0, settings: {...c.settings},
    realtimeAllowed: realtimeAllowed(room), canManage, canContinue: canContinueRoom(room),
    seats: room.players.filter(p => !p.removed).map(p => ({id: p.id, name: p.name,
      ready: ready(c, p), away: !!c.seats[p.id]?.away, pendingAway: c.seats[p.id]?.pendingAway ?? null,
      eligible: survivors(room).some(s => s.id === p.id), isBot: !!p.isBot})),
    pause: c.pause ? {...c.pause, voters: [...c.pause.voters], approvals: [...c.pause.approvals],
      approved: c.pause.approvals.length, required: c.pause.voters.length} : null,
    ...(canManage ? {spectatorRequests: c.spectatorRequests.map(r => ({...r, user: {...r.user}}))} : {}),
  };
}
