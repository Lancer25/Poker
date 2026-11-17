import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRoomControls, renderTablePendingBadge} from '../public/room-controls-ui.js';

class Element {
  children = [];
  attributes = new Map();
  classList = {add() {}};
  dataset = {};
  textContent = '';
  hidden = false;
  disabled = false;

  constructor(tag) { this.tag = tag; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  getAttribute(name) { return this.attributes.get(name); }
  setAttribute(name, value) { this.attributes.set(name, value); }
  querySelectorAll(tags) {
    return this.children.flatMap(node => [
      ...(tags.split(',').includes(node.tag) ? [node] : []), ...node.querySelectorAll(tags)
    ]);
  }
}

function fixture(t) {
  const tab = new Element('button');
  const badge = new Element('span');
  const panel = new Element('div');
  const settings = new Element('div');
  const nodes = {'tab-chips': tab, requestBadge: badge, roomControls: panel, roomControlSettings: settings};
  const originalDocument = globalThis.document;
  globalThis.document = {getElementById: id => nodes[id] ?? null, createElement: tag => new Element(tag)};
  t.after(() => { globalThis.document = originalDocument; });
  const room = {
    id: 'room', phase: 'flop', gameMode: 'friends', me: 'a', host: 'b',
    requests: [
      {status: 'pending', canApprove: true},
      {status: 'pending', canApprove: false},
      {status: 'approved', canApprove: false},
    ],
    roomControls: {
      enabled: true, round: 2, version: 7, seats: [],
      settings: {admission: 'approval', reveal: 'public', requireReady: false},
      pause: {id: 'pause', state: 'pending', voters: ['a', 'b'], approvals: ['b'], approved: 1, required: 2},
    },
  };
  return {room, panel, settings, tab, badge};
}

test('chips tab counts only outstanding votes for the current player and resets on leaving', t => {
  const {room, tab, badge} = fixture(t);
  renderRoomControls(room);
  assert.equal(badge.hidden, false);
  assert.equal(badge.textContent, '2');
  assert.equal(tab.getAttribute('aria-label'), '筹码，1 项待审批筹码申请，1 项待表决暂停申请');

  // Chip-only updates must still render when the room controls themselves are unchanged.
  room.requests[0].canApprove = false;
  renderRoomControls(room);
  assert.equal(badge.textContent, '1');
  assert.equal(tab.getAttribute('aria-label'), '筹码，1 项待表决暂停申请');
  room.roomControls.pause.approvals.push('a');
  renderRoomControls(room);
  assert.equal(badge.hidden, true);

  room.requests[0].canApprove = true;
  renderRoomControls(room);
  renderTablePendingBadge(null);
  assert.equal(badge.textContent, '');
  assert.equal(badge.hidden, true);
  assert.equal(tab.getAttribute('aria-label'), '筹码');
});

test('cash approvals count for the host only, and ended rooms clear pending counts', t => {
  const {room, badge} = fixture(t);
  room.gameMode = 'cash';
  renderRoomControls(room);
  assert.equal(badge.hidden, true);
  room.me = room.host;
  renderRoomControls(room);
  assert.equal(badge.textContent, '2');
  room.phase = 'ended';
  renderRoomControls(room);
  assert.equal(badge.hidden, true);
});

test('pause actions follow voting eligibility and resume can move to the action dock', async t => {
  const {room, panel, badge} = fixture(t);
  const sent = [];
  const options = {connected: true, send: (...args) => sent.push(args)};
  const command = label => panel.querySelectorAll('button').find(node => node.getAttribute('aria-label') === label);
  renderRoomControls(room, options);
  await command('同意暂停').onclick();
  assert.deepEqual(sent, [['pausevote', {request: 'pause', value: true, round: 2, version: 7}]]);

  room.requests = [];
  room.roomControls.pause.state = 'granted';
  renderRoomControls(room, options);
  assert.equal(command('同意暂停'), undefined);
  assert.equal(badge.hidden, true);
  room.roomControls.canManage = true;
  room.roomControls.pause.state = 'active';
  renderRoomControls(room, options);
  assert.ok(command('恢复牌桌'));
  renderRoomControls(room, {...options, resumeInActionDock: true});
  assert.equal(command('恢复牌桌'), undefined);
});

test('management settings report command failures inside the management panel', async t => {
  const {room, settings, panel} = fixture(t);
  room.roomControls.canManage = true;
  room.roomControls.enabled = false;
  renderRoomControls(room, {connected: true, send: () => { throw new Error('连接中断'); }});
  await settings.querySelectorAll('button')[0].onclick();
  assert.equal(settings.children[0].getAttribute('role'), 'alert');
  assert.equal(settings.children[0].textContent, '连接中断');
  assert.equal(panel.children.find(node => node.getAttribute('role') === 'alert').textContent, '');
});
