import assert from 'node:assert/strict';
import test from 'node:test';
import { seatRenderKey, visibleHandTotal } from '../public/keyed-render.js';
import { wagerView } from '../public/table-objects.js';

const player = { id: 'a', stack: 900, bet: 100, totalBet: 100 };
const room = { me: 'b', hand: 1, phase: 'preflop', bigBlind: 0 };

function handTotal(p, r) {
  return visibleHandTotal(p, wagerView(r, p, 0).amount);
}

test('the seat total is absent when the street chips already show the hand total', () => {
  assert.equal(handTotal(player, room), null);
  assert.equal(handTotal({ ...player, folded: true }, room), null);
  assert.equal(handTotal({ ...player, stack: 0 }, room), null);
});

test('the seat total stays visible when it adds information', () => {
  assert.equal(handTotal({ ...player, totalBet: 125 }, room), 125); // includes ante
  assert.equal(handTotal({ ...player, totalBet: 400 }, { ...room, phase: 'turn' }), 400);
  assert.equal(handTotal({ ...player, bet: 0 }, { ...room, phase: 'flop' }), 100);
  assert.equal(handTotal(player, { ...room, phase: 'showdown' }), 100);
  assert.equal(handTotal(player, { ...room, phase: 'ended' }), 100);
});

test('empty or invalid totals never produce a seat label', () => {
  for (const totalBet of [undefined, null, 0, -1, NaN, Infinity]) {
    assert.equal(handTotal({ ...player, totalBet }, room), null);
  }
});

test('the cache tracks total visibility when the street chips disappear and preserves role updates', () => {
  const key = (r, p = player) => {
    const wager = wagerView(r, p, 0);
    return seatRenderKey(p, r, 0, wager.roles, visibleHandTotal(p, wager.amount));
  };
  const before = key(room);
  assert.notEqual(key({ ...room, phase: 'ended' }), before);
  assert.notEqual(key({ ...room, bigBlind: 1 }), before);
  assert.equal(key({ ...room, serverTime: 2000 }, { ...player, connection: { rttMs: 150 } }), before);
});
