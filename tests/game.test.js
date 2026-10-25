import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,action,command,settle,snapshot} from '../server/game.js';
function table(n = 3) {
  const { room } = createRoom("Host");
  for (let i = 1; i < n; i++) joinRoom(room, "P" + i);
  return room;
}
const chips = (r) => r.players.reduce((s, p) => s + p.stack + p.total, 0);
test('settlement identifies winners by stable ID despite duplicate names',()=>{
 const r=table(2);r.players.forEach(p=>p.name='Same');startHand(r,r.host);
 const folding=r.players[r.turn];command(r,folding.id,'fold');
 const pot=r.pots.find(p=>!p.refund);assert.ok(pot);
 assert.deepEqual(pot.winnerIds,[r.players.find(p=>p.id!==folding.id).id]);
 assert.deepEqual(snapshot(r,r.host).pots.find(p=>!p.refund).winnerIds,pot.winnerIds);
});
test("nine seats and capacity; integer validation", () => {
  const r = table(9);
  assert.throws(() => joinRoom(r, "Extra"));
  assert.throws(() => createRoom("x", 1.5));
  assert.equal(r.players.length, 9);
});
test("heads-up dealer posts small blind and acts first", () => {
  const r = table(2);
  startHand(r, r.host);
  assert.equal(r.dealer, 0);
  assert.equal(r.players[0].bet, 5);
  assert.equal(r.turn, 0);
  assert.equal(chips(r), 2000);
});
test("snapshots do not disclose opponents or deck", () => {
  const r = table();
  startHand(r, r.host);
  const s = snapshot(r, r.host);
  assert.equal(s.deck, undefined);
  assert.deepEqual(s.players[1].cards, ["??", "??"]);
  assert.notEqual(s.players[0].cards[0], "??");
});
test("complete passive nine player hand conserves all chips", () => {
  const r = table(9);
  startHand(r, r.host);
  let n = 0;
  while (r.phase !== "showdown" && n++ < 100) {
    if(completeFlop(r))continue;
    const p = r.players[r.turn];
    action(r, p.id, p.bet < r.currentBet ? "call" : "check");
  }
  assert.equal(r.phase, "showdown");
  assert.equal(r.board.length, 5);
  assert.equal(
    r.players.reduce((s, p) => s + p.stack, 0),
    9000,
  );
});
test("short all-in does not reopen prior raiser rights", () => {
  const r = table();
  r.players[2].stack = 130;
  startHand(r, r.host);
  action(r, r.players[0].id, "raise", 100);
  action(r, r.players[1].id, "call");
  action(r, r.players[2].id, "allin");
  assert.equal(r.turn, 0);
  assert.equal(snapshot(r, r.host).canRaise, false);
  assert.throws(() => action(r, r.host, "raise", 250), /加注权/);
  action(r, r.host, "call");
  action(r, r.players[1].id, "call");
  assert.equal(r.phase, "flop");
});
test("side pots and uncalled excess are allocated correctly", () => {
  const r = table();
  r.board = ["2s", "3h", "4d", "8c", "9s"];
  r.dealer = 0;
  const hands = [
    ["As", "Ah"],
    ["Ks", "Kh"],
    ["Qs", "Qh"],
  ];
  r.players.forEach((p, i) =>
    Object.assign(p, {
      cards: hands[i],
      total: [50, 100, 200][i],
      inHand: true,
      folded: false,
      stack: 0,
    }),
  );
  settle(r);
  assert.deepEqual(
    r.players.map((p) => p.stack),
    [150, 100, 100],
  );
  assert.equal(r.pots[2].refund, true);
});
test("tie odd chip awarded clockwise from dealer", () => {
  const r = table();
  delete r.chipUnit;
  r.board = ["As", "Ks", "Qs", "Js", "Ts"];
  r.dealer = 0;
  r.players.forEach((p, i) =>
    Object.assign(p, {
      cards: [
        ["2h", "3h"],
        ["4h", "5h"],
        ["6h", "7h"],
      ][i],
      total: 1,
      inHand: true,
      folded: i === 2,
      stack: 0,
    }),
  );
  settle(r);
  assert.equal(r.players[1].stack, 2);
  assert.equal(r.players[0].stack, 1);
});
test("rebuy host authorization and session totals", () => {
  const r = table(2),
    p = r.players[1];
  command(r, p.id, "rebuy", { amount: 500 });
  assert.throws(() =>
    command(r, p.id, "approve", { request: r.requests[0].id }),
  );
  command(r, r.host, "approve", { request: r.requests[0].id });
  assert.equal(p.buyin, 1500);
  assert.equal(p.stack, 1500);
  command(r, r.host, "end");
  assert.equal(r.phase, "ended");
  assert.equal(snapshot(r, p.id).results[1].net, 0);
});
test("fold wins pot without disclosing winner cards", () => {
  const r = table(2);
  startHand(r, r.host);
  action(r, r.host, "fold");
  assert.equal(r.phase, "showdown");
  assert.equal(
    r.players.reduce((s, p) => s + p.stack, 0),
    2000,
  );
  assert.deepEqual(snapshot(r, r.host).players[1].cards, ["??", "??"]);
});
test("exhaustive all-in smoke keeps chip conservation", () => {
  for (let n = 2; n <= 9; n++) {
    const r = table(n);
    r.players.forEach((p, i) => (p.stack = 20 + i * 85));
    const total = r.players.reduce((s, p) => s + p.stack, 0);
    startHand(r, r.host);
    let limit = 0;
    while (r.phase !== "showdown" && limit++ < 50) {
      if(completeFlop(r))continue;
      const p = r.players[r.turn];
      const s = snapshot(r, p.id);
      action(
        r,
        p.id,
        s.canRaise || p.bet + p.stack <= r.currentBet ? "allin" : "call",
      );
    }
    assert.equal(r.phase, "showdown");
    assert.equal(
      r.players.reduce((s, p) => s + p.stack, 0),
      total,
    );
  }
});
