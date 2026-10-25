import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {beginHandEvents, recordHandEvent, finishHandEvents, publicReplay, MAX_HAND_EVENTS} from '../server/hand-events.js';

function table() {
  return {hand: 1, roundNumber: 1, phase: 'preflop', small: 5, big: 10, board: [], deck: ['Ac', 'Ad'],
    players: [{id: 'a', name: 'Alice', inHand: true, stack: 100, bet: 0, total: 0, folded: false,
      cards: ['As', 'Ah'], accountId: 'account-secret', actionReceipts: ['receipt-secret']},
    {id: 'b', name: 'Bob', inHand: true, stack: 100, bet: 0, total: 0, folded: false, cards: ['Ks', 'Kh']}], pots: []};
}
function finish(room) {
  room.phase = 'showdown'; room.players[0].stack = 200; room.players[1].stack = 0;
  room.pots = [{amount: 200, winners: ['Alice'], winnerIds: ['a'], secret: 'pot-secret'},
    {amount: 5, winners: ['Bob'], winnerIds: ['b'], refund: true}];
  return {hand: room.hand, board: [...room.board], pots: room.pots, results: room.players.map(p => ({id: p.id})),
    shownWinners: [{id: 'a', name: 'Alice', cards: ['As', 'Ah'], won: 200, handLabel: '一对'}],
    shownPlayers: [], replay: finishHandEvents(room, 500)};
}

test('capture uses public state allowlist and immutable snapshots, never caller-supplied fake fields', () => {
  const room = table(), original = JSON.stringify(room);
  beginHandEvents(room, 100);
  const {replayPending, ...gameState} = room;
  assert.equal(JSON.stringify(gameState), original); assert.equal(replayPending.version, 1);
  room.players[0].stack = 95; room.players[0].bet = 5; room.players[0].total = 5;
  recordHandEvent(room, 'blinds', {player: room.players[0], action: 'smallBlind', amount: 5,
    deck: ['2s'], cards: ['2h'], board: ['2d'], players: [{id: 'fake'}], accountId: 'fake-secret'}, 110);
  recordHandEvent(room, 'action', {player: 'b', action: 'fold'}, 120);
  const hand = finish(room), replay = publicReplay(hand), encoded = JSON.stringify(replay);
  assert.equal(replay.complete, true); assert.equal(replay.version, 1);
  assert.equal(replay.events[0].players[0].stack, 100);
  assert.equal(replay.events[1].players[0].stack, 95);
  assert.deepEqual(replay.events[1].board, []); assert.equal(replay.events[1].amount, 5);
  assert.deepEqual(Object.keys(replay.events[0].players[0]), ['id', 'name', 'stack', 'bet', 'total', 'folded']);
  for (const secret of ['deck', 'accountId', 'actionReceipts', 'receipt-secret', 'pot-secret', 'fake-secret', 'Ks', 'Kh', 'Ac', 'Ad']) assert.ok(!encoded.includes(secret), secret);
  assert.ok(hand.replay.events.every(e => !JSON.stringify(e).includes('cards')));
  room.players[0].name = 'changed'; replay.events[0].players[0].stack = 999;
  assert.equal(hand.replay.events[0].players[0].name, 'Alice'); assert.equal(hand.replay.events[0].players[0].stack, 100);
});

test('incremental visible board and streets are preserved; holes exist only at final settlement', () => {
  const room = table(); beginHandEvents(room, 10);
  recordHandEvent(room, 'action', {player: 'a', action: 'call', amount: 10}, 20);
  room.phase = 'flop'; room.board = ['2s']; recordHandEvent(room, 'street', {}, 30);
  room.board.push('3h'); recordHandEvent(room, 'card', {}, 40);
  room.board.push('4d'); recordHandEvent(room, 'card', {}, 50);
  room.phase = 'turn'; room.board.push('5c'); recordHandEvent(room, 'street', {}, 60);
  room.phase = 'river'; room.board.push('6s'); recordHandEvent(room, 'street', {}, 70);
  const replay = publicReplay(finish(room));
  assert.deepEqual(replay.events.map(e => e.board.length), [0, 0, 1, 2, 3, 4, 5, 5]);
  for (const step of replay.events.slice(0, -1)) assert.ok(!JSON.stringify(step).includes('cards'));
  assert.deepEqual(replay.events.at(-1).shownPlayers.map(p => p.cards), [['As', 'Ah']]);
  assert.equal(replay.events.at(-1).pots[1].refund, true);
});

test('manual public reveal is derived afresh from saved history, validated and restricted to settlement', () => {
  const room = table(); beginHandEvents(room); const hand = finish(room);
  assert.equal(publicReplay(hand).events.at(-1).shownPlayers.length, 1);
  hand.shownPlayers.push({id: 'b', name: 'Bob', cards: ['Ks', 'Kh'], accountId: 'secret'});
  hand.shownPlayers.push({id: 'intruder', cards: ['Qs', 'Qh']}, {id: 'b', cards: ['Js', 'Jh']});
  hand.shownWinners.push({id: 'b', cards: ['Ts', 'Th'], won: 5}); // Refund is not a winning reveal.
  const replay = publicReplay(hand);
  assert.deepEqual(replay.events.at(-1).shownPlayers.map(p => p.cards), [['As', 'Ah'], ['Ks', 'Kh']]);
  assert.ok(!JSON.stringify(replay).includes('accountId'));
  hand.shownPlayers[0].cards = ['Ks', 'Ks']; hand.shownPlayers[2].cards = ['Js', 'Js'];
  assert.equal(publicReplay(hand).events.at(-1).shownPlayers.length, 1);
  hand.shownWinners[0].cards = ['XX', 'Ah']; assert.deepEqual(publicReplay(hand).events.at(-1).shownPlayers, []);
});

test('post-blind begin and flop-phase all-in runout preserve actual public balances and every visible card', () => {
  const room = table();
  Object.assign(room.players[0], {stack: 95, bet: 5, total: 5});
  Object.assign(room.players[1], {stack: 90, bet: 10, total: 10});
  beginHandEvents(room, 10);
  recordHandEvent(room, 'blinds', {player: 'a', action: 'smallBlind', amount: 5}, 11);
  recordHandEvent(room, 'blinds', {player: 'b', action: 'bigBlind', amount: 10}, 12);
  room.phase = 'flop';
  for (const value of ['2s', '3h', '4d', '5c', '6s']) {
    room.board.push(value); recordHandEvent(room, 'card', {}, 20 + room.board.length);
  }
  const replay = publicReplay(finish(room));
  assert.equal(replay.events[0].players[0].stack, 95);
  assert.deepEqual(replay.events.slice(3, 8).map(e => [e.phase, e.board.length]),
    [['flop', 1], ['flop', 2], ['flop', 3], ['turn', 4], ['river', 5]]);
  assert.equal(replay.complete, true);
});

test('JSON midhand restart hydrates on record and finish without losing public action history', () => {
  const room = table(); beginHandEvents(room, 100);
  recordHandEvent(room, 'blinds', {player: 'a', action: 'smallBlind', amount: 5}, 110);
  recordHandEvent(room, 'action', {player: 'b', action: 'call', amount: 5}, 120);
  const savedEvents = structuredClone(room.replayPending.events);
  const restored = JSON.parse(JSON.stringify(room));
  restored.phase = 'flop'; restored.board = ['2s'];
  assert.equal(recordHandEvent(restored, 'card', {}, 200), true);
  assert.deepEqual(restored.replayPending.events.slice(0, 3), savedEvents);
  assert.equal(restored.replayPending.events.at(-1).board.length, 1);
  const pending = JSON.stringify(restored.replayPending);
  for (const secret of ['cards', 'deck', 'accountId', 'actionReceipts', 'account-secret', 'receipt-secret', 'As', 'Ah', 'Ks', 'Kh']) assert.ok(!pending.includes(secret), secret);
  const restoredAgain = JSON.parse(JSON.stringify(restored));
  const hand = finish(restoredAgain); // Hydration directly from finish, no record first.
  assert.equal(hand.replay.startedAt, 100); assert.equal(hand.replay.complete, true);
  assert.deepEqual(hand.replay.events.slice(0, 3), savedEvents);
  assert.deepEqual(hand.replay.events.map(e => e.type), ['start', 'blinds', 'action', 'card', 'settlement']);
  assert.equal(Object.hasOwn(restoredAgain, 'replayPending'), false);
  assert.equal(finishHandEvents(restoredAgain), null);
  assert.equal(recordHandEvent(restoredAgain, 'action', {action: 'check'}), false);
  assert.equal(Object.hasOwn(restoredAgain, 'replayPending'), false);
});

test('pending hydration strips malicious fields, bounds entries and carries truncation through restart', () => {
  const room = table(); beginHandEvents(room, 100);
  const restored = JSON.parse(JSON.stringify(room));
  Object.assign(restored.replayPending, {cards: ['As'], deck: ['Ac'], accountId: 'pending-secret'});
  const first = restored.replayPending.events[0];
  Object.assign(first, {cards: ['Ah'], shownPlayers: [{id: 'a', cards: ['As', 'Ah']}], receipts: ['pending-secret']});
  Object.assign(first.players[0], {cards: ['As', 'Ah'], accountId: 'pending-secret'});
  restored.replayPending.events.push(...Array.from({length: 800}, () => ({...first, type: 'action'})));
  assert.equal(recordHandEvent(restored, 'action', {action: 'check'}), false);
  assert.equal(restored.replayPending.events.length, MAX_HAND_EVENTS - 1);
  assert.equal(restored.replayPending.truncated, true);
  const safe = JSON.stringify(restored.replayPending);
  for (const secret of ['cards', 'deck', 'accountId', 'shownPlayers', 'receipts', 'pending-secret']) assert.ok(!safe.includes(secret), secret);
  first.players[0].name = 'tampered old reference';
  assert.equal(restored.replayPending.events[0].players[0].name, 'Alice');
  const next = JSON.parse(JSON.stringify(restored)), hand = finish(next);
  assert.equal(hand.replay.events.length, MAX_HAND_EVENTS);
  assert.equal(hand.replay.truncated, true); assert.equal(hand.replay.complete, false);
  assert.equal(hand.replay.events.at(-1).type, 'settlement');
  assert.equal(Object.hasOwn(next, 'replayPending'), false);
});

test('old, invalid and stale pending records never manufacture a new hand replay', () => {
  const seed = table(); beginHandEvents(seed);
  const valid = JSON.parse(JSON.stringify(seed.replayPending));
  for (const pending of [undefined, {...valid, version: 9}, {...valid, hand: 99}, {...valid, round: 99},
    {...valid, events: []}, {...valid, events: [{...valid.events[0], type: 'action'}]}]) {
    const old = table(); if (pending) old.replayPending = structuredClone(pending);
    assert.equal(recordHandEvent(old, 'action', {player: 'a', action: 'call'}), false);
    assert.equal(finishHandEvents(old), null);
    assert.equal(Object.hasOwn(old, 'replayPending'), false);
  }
  const broken = table(); broken.replayPending = structuredClone(valid);
  broken.replayPending.events.push({type: 'invalid', cards: ['As', 'Ah']});
  const hand = finish(broken);
  assert.equal(hand.replay.truncated, true); assert.equal(hand.replay.complete, false);
  assert.ok(!JSON.stringify(hand.replay).includes('cards'));
});

test('bounds reserve a settlement slot, explicitly mark truncation, and never invent legacy recording', () => {
  const room = table(); assert.equal(finishHandEvents(room), null);
  for (const legacy of [{hand: 1}, {hand: 1, replay: {version: 2}}, {hand: 1, replay: {version: 1, hand: 1, events: []}}]) assert.equal(publicReplay(legacy), null);
  beginHandEvents(room);
  for (let i = 0; i < 900; i++) recordHandEvent(room, 'action', {player: 'a', action: 'check'}, i);
  const hand = finish(room), replay = publicReplay(hand);
  assert.equal(replay.events.length, MAX_HAND_EVENTS); assert.equal(replay.truncated, true); assert.equal(replay.complete, false);
  assert.equal(replay.events.at(-1).type, 'settlement'); assert.equal(finishHandEvents(room), null);
  assert.equal(recordHandEvent(room, 'action'), false);
  const exact = table(); beginHandEvents(exact);
  for (let i = 0; i < MAX_HAND_EVENTS - 2; i++) recordHandEvent(exact, 'action', {action: 'check'});
  assert.equal(publicReplay(finish(exact)).complete, true);
});

test('resanitizes persisted malicious fields, forged early reveals and oversized records', () => {
  const room = table(); beginHandEvents(room); const hand = finish(room);
  Object.assign(hand.replay, {deck: ['Ac'], receipts: ['secret']});
  for (const step of hand.replay.events) {
    Object.assign(step, {cards: ['Ks', 'Kh'], shownPlayers: [{id: 'b', cards: ['Ks', 'Kh']}], deck: ['Ac'], accountId: 'secret'});
    Object.assign(step.players[0], {cards: ['Ks', 'Kh'], accountId: 'secret'});
  }
  const clean = publicReplay(hand);
  assert.ok(!JSON.stringify(clean).includes('Ks')); assert.ok(!JSON.stringify(clean).includes('secret'));
  assert.equal(clean.events[0].shownPlayers, undefined);
  hand.replay.events.splice(1, 0, ...Array.from({length: 800}, () => ({...hand.replay.events[0], type: 'action'})));
  const bounded = publicReplay(hand);
  assert.equal(bounded.events.length, 512); assert.equal(bounded.truncated, true); assert.equal(bounded.complete, false);
  assert.equal(bounded.events.at(-1).type, 'settlement');
  hand.replay.events = [hand.replay.events.at(-1), hand.replay.events[0]];
  assert.equal(publicReplay(hand).complete, false);
  assert.ok(!JSON.stringify(publicReplay(hand)).includes('cards'));
});

test('rejects stale round/hand state, unknown events, unsafe numbers and future phase board', () => {
  const room = table(); beginHandEvents(room);
  assert.equal(recordHandEvent(room, 'deck', {cards: ['Ac']}), false);
  assert.equal(recordHandEvent(room, 'settlement'), false);
  room.board = ['Ac', 'Ad']; recordHandEvent(room, 'action', {amount: Infinity, action: 'account-secret'});
  const hand = finish(room); assert.deepEqual(hand.replay.events[1].board, []);
  assert.equal(hand.replay.events[1].amount, undefined); assert.equal(hand.replay.events[1].action, undefined);
  for (const change of [r => r.hand++, r => r.roundNumber++]) {
    const next = table(); beginHandEvents(next); change(next);
    assert.equal(recordHandEvent(next, 'action'), false); assert.equal(finishHandEvents(next), null);
  }
  hand.replay.hand = 99; assert.equal(publicReplay(hand), null);
});

// Minimal DOM exercises rendering and cancellation without an extra test dependency.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.className = ''; this.value = ''; this.open = false; this.isConnected = true;
    this.classList = {add: value => { this.className += ' ' + value; }, remove: value => { this.className = this.className.split(' ').filter(v => v !== value).join(' '); }}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(c => c.textContent).join(''); }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.text = ''; this.children = items; }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  remove() { this.isConnected = false; }
  focus() { this.focused = true; }
}
function find(root, predicate) { if (predicate(root)) return root; for (const child of root.children) { const result = find(child, predicate); if (result) return result; } }
test('dialog final-only reveal, step/scrub, legacy label, singleton, playback and close cancellation', async () => {
  const previous = globalThis.document, oldInterval = globalThis.setInterval, oldClear = globalThis.clearInterval;
  const focus = new Element('button'), body = new Element('body'); let tick = null, cancelled = 0;
  globalThis.document = {body, activeElement: focus, createElement: tag => new Element(tag)};
  globalThis.setInterval = fn => { tick = fn; return 1; }; globalThis.clearInterval = () => { tick = null; cancelled++; };
  const {openReplay, closeReplay} = await import('../public/replay-ui.js');
  try {
    const room = table(); beginHandEvents(room); recordHandEvent(room, 'action', {player: 'a', action: 'call'});
    const hand = finish(room); hand.replay = publicReplay(hand);
    hand.replay.events[0].shownPlayers = [{id: 'b', cards: ['Ks', 'Kh']}];
    let dialog = openReplay(hand);
    assert.ok(!find(dialog, e => e.attributes['aria-label'] === '黑桃 A'));
    const next = find(dialog, e => e.title === '下一步'); next.listeners.click(); next.listeners.click();
    assert.ok(find(dialog, e => e.attributes['aria-label'] === '黑桃 A'));
    const slider = find(dialog, e => e.type === 'range'); slider.value = '0'; slider.listeners.input();
    assert.ok(!find(dialog, e => e.attributes['aria-label'] === '黑桃 A'));
    const play = find(dialog, e => e.title === '播放');
    assert.equal(play.children[0].tagName, 'img'); assert.equal(play.children[0].src, '/assets/icons/play.svg');
    play.listeners.click(); assert.equal(play.attributes['aria-pressed'], 'true');
    assert.equal(play.children[0].src, '/assets/icons/pause.svg');
    play.listeners.click(); assert.equal(play.children[0].src, '/assets/icons/play.svg');
    assert.equal(play.attributes['aria-pressed'], 'false'); play.listeners.click();
    tick(); assert.equal(slider.value, '1');
    const staleTick = tick, prior = dialog;
    dialog = openReplay({hand: 9}); assert.equal(prior.isConnected, false); assert.equal(tick, null);
    assert.ok(dialog.textContent.includes('此手未记录过程')); staleTick(); assert.equal(slider.value, '1');
    dialog.listeners.cancel({preventDefault() {}}); assert.equal(dialog.isConnected, false); assert.equal(focus.focused, true);
    closeReplay(); assert.ok(cancelled > 0);
    const css = await readFile(new URL('../public/replay-ui.css', import.meta.url), 'utf8');
    assert.ok(css.includes('width: 44px; height: 44px')); assert.ok(css.includes('var(--surface'));
    assert.ok(!css.includes('replay-play-mark'));
  } finally { closeReplay(); globalThis.document = previous; globalThis.setInterval = oldInterval; globalThis.clearInterval = oldClear; }
});
