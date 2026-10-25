import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeControls, roomControlsView, roomControlCommand, updateRoomControls,
  canContinueRoom, requestSpectatorAdmission, realtimeAllowed,
  MAX_SPECTATOR_REQUESTS, SPECTATOR_REQUEST_TTL_MS,
} from '../server/room-controls.js';
import {makeTournament, currentLevel} from '../server/tournament.js';
import {addSpectator} from '../server/spectators.js';
import {renderRoomControls} from '../public/room-controls-ui.js';

function table(options = {}) {
  const room = {id: 'local', gameMode: 'friends', phase: 'waiting', roundNumber: 1,
    host: 'a', hand: 0, initial: 10000, players: ['a', 'b', 'c'].map(id =>
      ({id, accountId: `account-${id}`, name: id, stack: 10000, bet: 0, total: 0, cards: []})),
    spectators: [], tournament: makeTournament('friends'), requests: [], log: []};
  if (options.controlled !== false) initializeControls(room, options.settings);
  return room;
}
function context(room, data = {}) { return {round: room.roundNumber, version: room.controls?.version || 0, ...data}; }
function cmd(room, id, type, data = {}, now = 1000) {
  return roomControlCommand(room, id, type, context(room, data), now);
}
function pause(room, now = 1000) {
  cmd(room, 'a', 'pause', {}, now);
  for (const id of ['b', 'c']) cmd(room, id, 'pausevote', {request: room.controls.pause.id, value: true}, now);
}
function allReady(room, now = 1000) {
  for (const p of room.players.filter(p => !p.removed && !p.eliminated && !p.isBot)) cmd(room, p.id, 'ready', {value: true}, now);
}
const watcher = {id: 'watcher', nickname: 'Watcher', secret: 'never copy'};

test('new friend defaults are approval/public with optional readiness; initialize is idempotent', () => {
  const r = table();
  assert.deepEqual(r.controls.settings, {admission: 'approval', reveal: 'public', requireReady: false});
  assert.equal(canContinueRoom(r), true); assert.equal(realtimeAllowed(r), false);
  const before = JSON.stringify(r);
  initializeControls(r, {reveal: 'realtime'});
  assert.equal(JSON.stringify(r), before);
  const cash = {...table({controlled: false}), gameMode: 'cash'};
  assert.equal(initializeControls(cash), null); assert.equal(roomControlsView(cash, 'a'), null);
});

test('legacy rooms stay byte-compatible through reads, ticks, admission and invalid commands', () => {
  const r = table({controlled: false}), before = JSON.stringify(r);
  assert.equal(roomControlsView(r, 'a').enabled, false);
  assert.equal(canContinueRoom(r), true); assert.equal(realtimeAllowed(r), true);
  assert.equal(updateRoomControls(r, 1000), false);
  assert.deepEqual(requestSpectatorAdmission(r, watcher), {status: 'allowed'});
  assert.throws(() => cmd(r, 'a', 'ready', {value: true}), /房主启用/);
  assert.throws(() => cmd(r, 'b', 'settings', {settings: {requireReady: true}}), /房主/);
  assert.throws(() => cmd(r, 'a', 'settings', {settings: {reveal: 'secret'}}));
  assert.throws(() => cmd(r, 'a', 'settings', {settings: {}}));
  assert.equal(JSON.stringify(r), before);
  cmd(r, 'a', 'settings', {settings: {requireReady: true}});
  assert.equal(canContinueRoom(r), false); assert.equal(realtimeAllowed(r), false);
});

test('readiness is optional until enabled and bots are ready without changing player records', () => {
  const r = table(); r.players[2].isBot = true;
  const players = structuredClone(r.players);
  cmd(r, 'a', 'settings', {settings: {requireReady: true}});
  assert.equal(canContinueRoom(r), false);
  cmd(r, 'a', 'ready', {value: true}); cmd(r, 'b', 'ready', {value: true});
  assert.equal(canContinueRoom(r), true);
  assert.equal(roomControlsView(r, 'a').seats[2].ready, true);
  assert.deepEqual(r.players, players);
  cmd(r, 'a', 'ready', {value: false}); assert.equal(canContinueRoom(r), false);
});

test('active-hand controls preserve turn, deadlines, cards, bets, stacks and tournament timing', () => {
  const r = table(); Object.assign(r, {phase: 'turn', hand: 7, turn: 1, deadline: 9999,
    board: ['As', 'Kd', '8h', '2c'], currentBet: 200, minRaise: 100});
  r.tournament.startedAt = 0; r.tournament.nextHandAt = null;
  for (const p of r.players) Object.assign(p, {inHand: true, bet: 200, total: 400, cards: ['3s', '4s']});
  r.players[2].stack = 0;
  const {controls, ...before} = structuredClone(r);
  cmd(r, 'b', 'away', {value: true});
  assert.equal(r.controls.seats.b.away, false); assert.equal(r.controls.seats.b.pendingAway, true);
  pause(r); assert.equal(r.controls.pause.state, 'granted');
  updateRoomControls(r, 8000);
  const {controls: afterControls, ...after} = r;
  assert.deepEqual(after, before);
  r.phase = 'showdown'; r.players[2].eliminated = true;
  updateRoomControls(r, 10000);
  assert.equal(r.controls.pause.state, 'active'); assert.equal(r.controls.seats.b.away, true);
  assert.equal(r.deadline, 9999); assert.equal(r.turn, 1);
  assert.equal(canContinueRoom(r), false);
});

test('away changes apply at a boundary and can be withdrawn within an active hand', () => {
  const r = table(); r.phase = 'flop';
  cmd(r, 'b', 'away', {value: true}); cmd(r, 'b', 'away', {value: false});
  r.phase = 'showdown'; updateRoomControls(r);
  assert.equal(canContinueRoom(r), true);
  cmd(r, 'b', 'away', {value: true}); assert.equal(canContinueRoom(r), false);
  assert.throws(() => cmd(r, 'b', 'ready', {value: true}), /返回/);
  cmd(r, 'b', 'away', {value: false}); assert.equal(canContinueRoom(r), true);
});

test('pause needs every survivor, including away/disconnected/folded players, with explicit approvals', () => {
  const r = table(); r.players[1].folded = true; r.players[2].connected = false;
  cmd(r, 'c', 'away', {value: true}); cmd(r, 'a', 'pause');
  cmd(r, 'b', 'pausevote', {request: r.controls.pause.id, value: true});
  assert.equal(r.controls.pause.state, 'pending');
  assert.deepEqual(r.controls.pause.approvals, ['a', 'b']);
  cmd(r, 'c', 'pausevote', {request: r.controls.pause.id, value: true});
  assert.equal(r.controls.pause.state, 'active');
  assert.ok(r.controls.pause.voters.includes('c'));
});

test('negative vote cancels, only proposer/host can cancel, wrong request IDs cannot vote', () => {
  const r = table(); cmd(r, 'b', 'pause');
  assert.throws(() => cmd(r, 'c', 'pausecancel', {request: r.controls.pause.id}), /申请人或房主/);
  assert.throws(() => cmd(r, 'c', 'pausevote', {request: 'wrong', value: true}), /不存在/);
  cmd(r, 'c', 'pausevote', {request: r.controls.pause.id, value: false});
  assert.equal(r.controls.pause, null);
  cmd(r, 'b', 'pause'); cmd(r, 'a', 'pausecancel', {request: r.controls.pause.id});
  assert.equal(r.controls.pause, null);
});

test('voter removal/elimination reconciles a proposal; a departed proposer cancels it', () => {
  const r = table(); cmd(r, 'a', 'pause');
  cmd(r, 'b', 'pausevote', {request: r.controls.pause.id, value: true});
  r.players[2].removed = true; updateRoomControls(r, 2000);
  assert.equal(r.controls.pause.state, 'active');
  const other = table(); cmd(other, 'b', 'pause');
  other.players[1].eliminated = true; updateRoomControls(other);
  assert.equal(other.controls.pause, null);
});

test('new survivors must vote even after grant; all-in zero stacks remain voters during a hand', () => {
  const r = table(); r.phase = 'river'; r.players[2].stack = 0; r.players[2].inHand = true;
  cmd(r, 'a', 'pause'); cmd(r, 'b', 'pausevote', {request: r.controls.pause.id, value: true});
  assert.equal(r.controls.pause.state, 'pending');
  cmd(r, 'c', 'pausevote', {request: r.controls.pause.id, value: true});
  assert.equal(r.controls.pause.state, 'granted');
  r.players.push({id: 'd', accountId: 'account-d', name: 'D', stack: 100});
  updateRoomControls(r, 2000); assert.equal(r.controls.pause.state, 'pending');
  assert.ok(r.controls.pause.voters.includes('d'));
});

test('bots auto-ready but never silently approve pause unless test-only option is set', () => {
  const r = table(); r.players[2].isBot = true;
  cmd(r, 'a', 'pause'); cmd(r, 'b', 'pausevote', {request: r.controls.pause.id, value: true});
  assert.equal(r.controls.pause.state, 'pending');
  assert.equal(r.controls.pause.approvals.includes('c'), false);
  const t = table({controlled: false}); t.testRound = true; t.players[2].isBot = true;
  initializeControls(t, {autoApproveBots: true}); cmd(t, 'a', 'pause');
  cmd(t, 'b', 'pausevote', {request: t.controls.pause.id, value: true});
  assert.equal(t.controls.pause.state, 'active');
  const invalid = table({controlled: false});
  assert.throws(() => initializeControls(invalid, {autoApproveBots: true}), /测试场/);
  assert.equal(invalid.controls, undefined);
});

test('pause freezes elapsed blind time, persists clock accounting and resumes with fresh 5s countdown', () => {
  const r = table(); r.phase = 'showdown'; r.tournament.startedAt = 100;
  pause(r, 10000);
  assert.ok(r.controls.pause);
  assert.throws(() => cmd(r, 'a', 'resume', {}, 10000), /返回并准备/);
  assert.equal(updateRoomControls(r, 20000), true);
  assert.equal(r.tournament.startedAt, 10100);
  const elapsed = 20000 - r.tournament.startedAt;
  const level = currentLevel(r, 20000);
  updateRoomControls(r, 300000);
  assert.equal(300000 - r.tournament.startedAt, elapsed);
  assert.equal(currentLevel(r, 300000), level);
  assert.equal(updateRoomControls(r, 300000), false);
  const restored = JSON.parse(JSON.stringify(r));
  allReady(restored, 310000);
  assert.throws(() => cmd(restored, 'b', 'resume', {}, 310000), /房主/);
  cmd(restored, 'a', 'resume', {}, 320000);
  assert.equal(restored.tournament.startedAt, 310100);
  assert.equal(restored.tournament.nextHandAt, 325000);
  assert.equal(restored.controls.pause, null); assert.equal(canContinueRoom(restored), true);
});

test('resume requires fresh ready/no-away from every remaining survivor even if requireReady=false', () => {
  const r = table(); allReady(r); pause(r);
  assert.ok(roomControlsView(r, 'a').seats.every(s => !s.ready));
  cmd(r, 'b', 'away', {value: true});
  cmd(r, 'a', 'ready', {value: true}); cmd(r, 'c', 'ready', {value: true});
  assert.throws(() => cmd(r, 'a', 'resume'), /返回并准备/);
  r.players[1].removed = true; updateRoomControls(r, 1000);
  assert.deepEqual(r.controls.pause.voters, ['a', 'c']);
  cmd(r, 'a', 'resume'); assert.equal(r.controls.pause, null);
});

test('a pre-start pause never starts the tournament clock; backwards ticks never subtract time', () => {
  const r = table(); pause(r, 1000); updateRoomControls(r, 5000); updateRoomControls(r, 4000);
  assert.equal(r.tournament.startedAt, null);
  allReady(r, 5000); cmd(r, 'a', 'resume', {}, 6000);
  assert.equal(r.tournament.startedAt, null); assert.equal(r.tournament.nextHandAt, 11000);
});

test('admission is idempotent, bounded, sanitized and gives pending viewers no room state', () => {
  const r = table(); const players = structuredClone(r.players);
  const a = requestSpectatorAdmission(r, watcher, 1000);
  assert.equal(a.status, 'pending');
  assert.deepEqual(a, requestSpectatorAdmission(r, watcher, 2000));
  assert.deepEqual(Object.keys(a.request).sort(), ['id', 'requestedAt', 'round']);
  assert.equal(roomControlsView(r, watcher.id), null);
  assert.equal(roomControlsView(r, 'b').spectatorRequests, undefined);
  const host = roomControlsView(r, 'a');
  assert.deepEqual(host.spectatorRequests[0].user, {id: watcher.id, nickname: watcher.nickname});
  host.spectatorRequests[0].user.nickname = 'altered'; host.settings.reveal = 'realtime';
  assert.equal(r.controls.spectatorRequests[0].user.nickname, 'Watcher'); assert.equal(realtimeAllowed(r), false);
  for (let i = 1; i < MAX_SPECTATOR_REQUESTS; i++) requestSpectatorAdmission(r, {id: `w${i}`, nickname: 'W'}, 2000);
  assert.throws(() => requestSpectatorAdmission(r, {id: 'overflow', nickname: 'O'}, 2000), /上限/);
  assert.deepEqual(r.players, players); assert.deepEqual(r.spectators, []);
  assert.deepEqual(requestSpectatorAdmission(r, watcher, 2001), a);
});

test('host approves exactly one pinned request and main alone adds authenticated spectator identity', () => {
  const r = table(); const a = requestSpectatorAdmission(r, watcher, 1000);
  assert.throws(() => cmd(r, 'b', 'spectatorapprove', {request: a.request.id}), /房主/);
  const result = cmd(r, 'a', 'spectatorapprove', {request: a.request.id});
  assert.equal(result.status, 'approved'); assert.deepEqual(result.user, {id: watcher.id, nickname: watcher.nickname});
  assert.equal(result.request, a.request.id); assert.deepEqual(r.spectators, []);
  assert.throws(() => cmd(r, 'a', 'spectatorapprove', {request: a.request.id}), /不存在/);
  const s = addSpectator(r, result.user);
  assert.equal(s.accountId, watcher.id); assert.ok(roomControlsView(r, s.id));
  assert.deepEqual(requestSpectatorAdmission(r, watcher), {status: 'allowed'});
});

test('closed/open admission is independent from card reveal; existing observers may reconnect', () => {
  const r = table(); cmd(r, 'a', 'settings', {settings: {admission: 'open'}});
  assert.deepEqual(requestSpectatorAdmission(r, watcher), {status: 'allowed'});
  assert.equal(realtimeAllowed(r), false); addSpectator(r, watcher);
  cmd(r, 'a', 'settings', {settings: {admission: 'closed', reveal: 'realtime'}});
  assert.equal(realtimeAllowed(r), true);
  assert.throws(() => requestSpectatorAdmission(r, {id: 'other', nickname: 'Other'}), /关闭/);
  assert.deepEqual(requestSpectatorAdmission(r, watcher), {status: 'allowed'});
  cmd(r, 'a', 'settings', {settings: {reveal: 'public'}});
  assert.equal(realtimeAllowed(r), false);
});

test('approval packets fail across versions, setting changes, rounds, expiry and kicked identities', () => {
  const r = table(); const a = requestSpectatorAdmission(r, watcher, 1000);
  const packet = context(r, {request: a.request.id});
  cmd(r, 'b', 'ready', {value: true});
  assert.throws(() => roomControlCommand(r, 'a', 'spectatorapprove', packet, 1000), /更新/);
  cmd(r, 'a', 'settings', {settings: {reveal: 'realtime'}});
  assert.throws(() => cmd(r, 'a', 'spectatorapprove', {request: a.request.id}), /不存在/);
  const expiring = requestSpectatorAdmission(r, watcher, 1000);
  updateRoomControls(r, 1000 + SPECTATOR_REQUEST_TTL_MS);
  assert.throws(() => cmd(r, 'a', 'spectatorapprove', {request: expiring.request.id}, 1000 + SPECTATOR_REQUEST_TTL_MS));
  requestSpectatorAdmission(r, watcher, 700000);
  r.spectators.push({id: 'old', accountId: watcher.id, removed: true, kickedRound: 1});
  updateRoomControls(r, 700000); assert.equal(r.controls.spectatorRequests.length, 0);
  assert.throws(() => requestSpectatorAdmission(r, watcher, 700000), /移出/);
});

test('round change clears ready/away/proposals/requests without moving new tournament clock', () => {
  const r = table(); pause(r); requestSpectatorAdmission(r, watcher, 1000);
  r.roundNumber++; r.tournament = makeTournament('friends'); r.tournament.startedAt = 2000;
  updateRoomControls(r, 9000);
  assert.equal(r.tournament.startedAt, 2000); assert.equal(r.controls.pause, null);
  assert.deepEqual(r.controls.spectatorRequests, []); assert.deepEqual(r.controls.seats, {});
  assert.equal(r.controls.settings.admission, 'approval');
  assert.throws(() => roomControlCommand(r, 'a', 'settings', {round: 1, version: r.controls.version, reveal: 'realtime'}));
});

test('host rejection removes only its request; invalid accounts, members, nonfriends and ended rooms fail', () => {
  const r = table(); const first = requestSpectatorAdmission(r, watcher, 1000);
  requestSpectatorAdmission(r, {id: 'other', nickname: 'Other'}, 1000);
  assert.equal(cmd(r, 'a', 'spectatorreject', {request: first.request.id}).status, 'rejected');
  assert.equal(r.controls.spectatorRequests.length, 1);
  assert.throws(() => requestSpectatorAdmission(r, {id: 'account-a', nickname: 'A'}), /入座/);
  assert.throws(() => requestSpectatorAdmission(r, {id: '', nickname: 'A'}));
  assert.throws(() => requestSpectatorAdmission({...r, gameMode: 'cash'}, watcher));
  assert.throws(() => cmd(r, 'forged', 'settings', {settings: {reveal: 'realtime'}}));
  const s = addSpectator(r, {id: 'observer', nickname: 'Observer'});
  assert.throws(() => cmd(r, s.id, 'ready', {value: true}), /在座/);
  r.players[1].eliminated = true;
  assert.throws(() => cmd(r, 'b', 'ready', {value: true}), /未淘汰/);
  assert.throws(() => cmd(r, 'b', 'pause'), /未淘汰/);
  r.phase = 'ended';
  assert.throws(() => cmd(r, 'a', 'settings', {settings: {reveal: 'realtime'}}), /结束/);
  assert.throws(() => requestSpectatorAdmission(r, watcher), /结束/);
});

test('unknown commands and invalid boolean/settings inputs cannot touch game state', () => {
  const r = table(); const before = JSON.stringify(r);
  for (const [type, data] of [['ready', {value: 'true'}], ['away', {}], ['nope', {}],
    ['settings', {settings: {requireReady: 1}}], ['settings', {settings: {admission: 'yes'}}]])
    assert.throws(() => cmd(r, 'a', type, data));
  // A rejected flag must not create an otherwise invisible seat record.
  assert.equal(JSON.stringify(r), before);
});

test('public view is detached, contains no deck/cards/accounts and advertises exact policy', () => {
  const r = table(); r.deck = ['secret']; r.players[0].cards = ['As', 'Ah']; cmd(r, 'a', 'pause');
  const view = roomControlsView(r, 'b');
  assert.equal(view.settings.reveal, 'public'); assert.equal(view.realtimeAllowed, false);
  assert.equal(view.pause.approved, 1); assert.equal(view.pause.required, 3);
  assert.ok(!JSON.stringify(view).includes('account-a')); assert.ok(!JSON.stringify(view).includes('As'));
  view.pause.approvals.push('b'); view.seats[0].ready = true;
  assert.deepEqual(r.controls.pause.approvals, ['a']); assert.equal(r.controls.seats.a, undefined);
});

test('repeated approvals cannot create quorum and unready/away flags never imply a pause vote', () => {
  const r = table(); r.phase = 'river'; r.deadline = 5000;
  cmd(r, 'a', 'pause');
  const request = r.controls.pause.id;
  cmd(r, 'b', 'pausevote', {request, value: true});
  cmd(r, 'b', 'pausevote', {request, value: true});
  cmd(r, 'c', 'ready', {value: true}); cmd(r, 'c', 'away', {value: true});
  assert.deepEqual(r.controls.pause.approvals, ['a', 'b']);
  assert.equal(r.controls.pause.state, 'pending'); assert.equal(r.deadline, 5000);
  cmd(r, 'c', 'pausevote', {request, value: true});
  updateRoomControls(r, 9000);
  assert.equal(r.controls.pause.state, 'granted'); assert.equal(r.deadline, 5000);
});

test('unadmitted account projection stays null and settings cannot enable test bot consent', () => {
  const r = table(); requestSpectatorAdmission(r, watcher, 1000);
  assert.equal(roomControlsView(r, 'account-a'), null);
  assert.equal(roomControlsView(r, watcher.id), null);
  cmd(r, 'a', 'settings', {settings: {requireReady: true, autoApproveBots: true}});
  assert.equal(r.controls.autoApproveBots, false);
  assert.equal(canContinueRoom(r), false);
  cmd(r, 'a', 'settings', {settings: {requireReady: false}});
  assert.equal(canContinueRoom(r), true);
});

test('seating or admitting a pending identity removes its request and old approvals fail', () => {
  for (const kind of ['seated', 'spectator']) {
    const r = table(), pending = requestSpectatorAdmission(r, watcher, 1000);
    if (kind === 'seated') r.players.push({id: 'new-seat', accountId: watcher.id, name: 'Watcher', stack: 100});
    else addSpectator(r, watcher);
    updateRoomControls(r, 1000);
    assert.equal(r.controls.spectatorRequests.length, 0);
    assert.throws(() => cmd(r, 'a', 'spectatorapprove', {request: pending.request.id}), /不存在/);
  }
});

function sevenPlayerTable() {
  const r = table();
  for (const id of ['d', 'e', 'f', 'g'])
    r.players.push({id, accountId: `account-${id}`, name: id, stack: 10000, bet: 0, total: 0, cards: []});
  return r;
}

test('seven modern ready intents from one snapshot all succeed; away intents remain boundary-deferred', () => {
  const r = sevenPlayerTable();
  assert.equal(r.controls.readyEpoch, 0);
  assert.equal(roomControlsView(r, 'a').readyEpoch, 0);
  cmd(r, 'a', 'settings', {settings: {requireReady: true}});
  const packet = context(r, {readyEpoch: 0, value: true});
  for (const p of r.players) roomControlCommand(r, p.id, 'ready', packet, 1000);
  assert.equal(canContinueRoom(r), true);
  assert.ok(roomControlsView(r, 'a').seats.every(s => s.ready));
  r.phase = 'river'; r.deadline = 9000;
  const awayPacket = context(r, {readyEpoch: 0, value: true});
  for (const p of r.players) roomControlCommand(r, p.id, 'away', awayPacket, 2000);
  assert.ok(Object.values(r.controls.seats).every(s => !s.away && s.pendingAway === true));
  assert.equal(r.deadline, 9000);
  r.phase = 'showdown'; updateRoomControls(r, 3000);
  assert.equal(canContinueRoom(r), false);
  const returnPacket = context(r, {readyEpoch: 0, value: false});
  for (const p of r.players) roomControlCommand(r, p.id, 'away', returnPacket, 3000);
  assert.ok(Object.values(r.controls.seats).every(s => !s.away));
});

test('seven independent pause votes share one version and UUID; activation rejects further votes', () => {
  const r = sevenPlayerTable();
  cmd(r, 'a', 'pause');
  const packet = context(r, {request: r.controls.pause.id, value: true});
  for (const p of r.players.slice(1)) roomControlCommand(r, p.id, 'pausevote', packet, 2000);
  assert.equal(r.controls.pause.state, 'active');
  assert.equal(r.controls.pause.approvals.length, 7);
  assert.equal(r.controls.readyEpoch, 1);
  assert.equal(roomControlsView(r, 'b').readyEpoch, 1);
  for (const value of [true, false]) {
    assert.throws(() => roomControlCommand(r, 'b', 'pausevote', {...packet, value}, 2000), /已生效/);
    assert.throws(() => cmd(r, 'b', 'pausevote', {request: packet.request, value}, 2000), /已生效/);
  }
  const readyPacket = context(r, {readyEpoch: 1, value: true});
  for (const p of r.players) roomControlCommand(r, p.id, 'ready', readyPacket, 3000);
  cmd(r, 'a', 'resume', {}, 4000);
  assert.equal(r.controls.pause, null); assert.equal(r.tournament.nextHandAt, 9000);
});

test('granted active-hand votes stay independent and never change the live deadline or create consent', () => {
  const r = sevenPlayerTable(); r.phase = 'turn'; r.deadline = 9000;
  const players = structuredClone(r.players);
  cmd(r, 'a', 'pause');
  const packet = context(r, {request: r.controls.pause.id, value: true});
  for (const p of r.players.slice(1)) roomControlCommand(r, p.id, 'pausevote', packet, 2000);
  assert.equal(r.controls.pause.state, 'granted'); assert.equal(r.controls.readyEpoch, 0);
  roomControlCommand(r, 'b', 'pausevote', packet, 2500);
  assert.equal(r.controls.pause.approvals.length, 7);
  assert.deepEqual(r.players, players); assert.equal(r.deadline, 9000);
  roomControlCommand(r, 'g', 'pausevote', {...packet, value: false}, 3000);
  assert.equal(r.controls.pause, null); assert.equal(r.deadline, 9000);
  cmd(r, 'a', 'pause');
  assert.throws(() => roomControlCommand(r, 'b', 'pausevote', packet, 3000), /不存在/);
  assert.deepEqual(r.controls.pause.approvals, ['a']);
});

test('pre-pause ready/away intents cannot satisfy or alter fresh resume readiness even with a current version', () => {
  const r = table(); const packet = context(r, {readyEpoch: 0, value: true});
  allReady(r); pause(r, 2000);
  assert.equal(r.controls.readyEpoch, 1);
  for (const type of ['ready', 'away']) {
    assert.throws(() => roomControlCommand(r, 'b', type, packet, 2000), /更新/);
    assert.throws(() => cmd(r, 'b', type, {readyEpoch: 0, value: true}, 2000), /更新/);
  }
  assert.ok(roomControlsView(r, 'a').seats.every(s => !s.ready && !s.away));
  assert.throws(() => cmd(r, 'a', 'resume', {}, 2000), /返回并准备/);
});

test('maintenance revalidates epochs and proposal state if pause activates between snapshot and command', () => {
  for (const type of ['ready', 'away', 'pausevote']) {
    const r = table(); r.phase = 'river'; pause(r);
    const packet = context(r, {readyEpoch: 0, request: r.controls.pause.id, value: true});
    assert.equal(r.controls.pause.state, 'granted');
    r.phase = 'showdown';
    assert.throws(() => roomControlCommand(r, 'b', type, packet, 2000), /更新|已生效/);
    assert.equal(r.controls.readyEpoch, 1); assert.equal(r.controls.pause.state, 'active');
    assert.equal(r.controls.seats.b.ready, false); assert.equal(r.controls.seats.b.away, false);
  }
});

test('rematch increments ready epoch once, preserves it over reload, and rejects old round or old epoch', () => {
  const r = table(); pause(r); const before = r.controls.readyEpoch;
  const packet = context(r, {readyEpoch: before, value: true});
  r.roundNumber++; updateRoomControls(r, 2000);
  assert.equal(r.controls.readyEpoch, before + 1);
  updateRoomControls(r, 3000); assert.equal(r.controls.readyEpoch, before + 1);
  const restored = JSON.parse(JSON.stringify(r));
  assert.equal(roomControlsView(restored, 'a').readyEpoch, before + 1);
  assert.throws(() => roomControlCommand(restored, 'b', 'ready', packet, 3000), /更新/);
  assert.throws(() => cmd(restored, 'b', 'ready', {readyEpoch: before, value: true}, 3000), /更新/);
  cmd(restored, 'b', 'ready', {readyEpoch: before + 1, value: true}, 3000);
  assert.equal(restored.controls.seats.b.ready, true);
});

test('absent epoch keeps ready/away strict CAS; settings and watch approvals remain strict with an epoch', () => {
  const r = table(); const old = context(r, {value: true});
  cmd(r, 'a', 'ready', {value: true, readyEpoch: 0});
  for (const type of ['ready', 'away']) {
    assert.throws(() => roomControlCommand(r, 'b', type, old, 1000), /更新/);
    roomControlCommand(r, 'b', type, {...old, readyEpoch: 0}, 1000);
  }
  assert.throws(() => roomControlCommand(r, 'a', 'settings',
    {...old, readyEpoch: 0, settings: {reveal: 'realtime'}}, 1000), /更新/);
  const pending = requestSpectatorAdmission(r, watcher, 1000);
  const approval = context(r, {request: pending.request.id, readyEpoch: 0});
  cmd(r, 'c', 'ready', {value: true, readyEpoch: 0});
  for (const type of ['spectatorapprove', 'spectatorreject'])
    assert.throws(() => roomControlCommand(r, 'a', type, approval, 1000), /更新/);
  assert.equal(r.controls.spectatorRequests.length, 1);
});

test('relaxed intents reject future, missing or malformed versions and invalid epochs', () => {
  const r = table(); cmd(r, 'a', 'pause');
  const before = JSON.stringify(r);
  for (const type of ['ready', 'away', 'pausevote']) {
    for (const version of [undefined, '1', -1, 1.5, NaN, Infinity, r.controls.version + 1])
      assert.throws(() => roomControlCommand(r, 'b', type,
        {round: 1, version, readyEpoch: 0, request: r.controls.pause.id, value: true}, 1000), /更新/);
  }
  for (const type of ['ready', 'away']) {
    for (const readyEpoch of [null, '0', -1, 0.5, NaN, Infinity, 1])
      assert.throws(() => cmd(r, 'b', type, {readyEpoch, value: true}), /更新/);
  }
  assert.equal(JSON.stringify(r), before);
});

test('independent vote contexts retain explicit consent and seated surviving membership checks', () => {
  const r = table(); cmd(r, 'a', 'pause');
  const packet = context(r, {request: r.controls.pause.id, value: true});
  const s = addSpectator(r, {id: 'observer', nickname: 'Observer'});
  for (const id of ['forged', s.id]) assert.throws(() => roomControlCommand(r, id, 'pausevote', packet, 1000), /在座/);
  assert.throws(() => roomControlCommand(r, 'b', 'pausevote', {...packet, value: undefined}, 1000), /明确/);
  r.players[1].pendingKick = true;
  assert.throws(() => roomControlCommand(r, 'b', 'pausevote', packet, 1000), /在座/);
  r.players[1].pendingKick = false; r.players[1].eliminated = true;
  assert.throws(() => roomControlCommand(r, 'b', 'pausevote', packet, 1000), /投票名单/);
  assert.deepEqual(r.controls.pause.approvals, ['a']);
});

test('UI ready/away dispatch includes the projected epoch while settings stays on strict context', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.classList = {add() {}}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = [...nodes]; }
    setAttribute(key, value) { this[key] = value; }
    querySelectorAll(selector) {
      return this.children.flatMap(node => [
        ...(selector.split(',').includes(node.tag) ? [node] : []), ...node.querySelectorAll(selector),
      ]);
    }
  }
  const panel = new Node('div'), settings = new Node('div');
  globalThis.document = {createElement: tag => new Node(tag),
    getElementById: id => id === 'roomControls' ? panel : id === 'roomControlSettings' ? settings : null};
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const r = table(); pause(r);
  const view = roomControlsView(r, 'a'), packets = [];
  renderRoomControls({id: r.id, gameMode: r.gameMode, phase: r.phase, me: 'a', roomControls: view},
    {connected: true, send: (type, data) => { packets.push({type, ...data}); }});
  const [readyInput, awayInput] = panel.querySelectorAll('input');
  readyInput.checked = true; readyInput.onchange(); await Promise.resolve();
  awayInput.checked = true; awayInput.onchange(); await Promise.resolve();
  const settingInput = settings.querySelectorAll('input')[0];
  settingInput.checked = true; settingInput.onchange(); await Promise.resolve();
  assert.deepEqual(packets.slice(0, 2), ['ready', 'away'].map(type =>
    ({type, value: true, round: view.round, version: view.version, readyEpoch: 1})));
  assert.equal(packets[2].type, 'settings'); assert.equal(packets[2].version, view.version);
  assert.equal(Object.hasOwn(packets[2], 'readyEpoch'), false);
});
