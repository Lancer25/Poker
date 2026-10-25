import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,command,expireTurn,snapshot,TURN_TIMEOUT_MS} from '../server/game.js';
function table() {
  const { room } = createRoom("Host");
  joinRoom(room, "Guest");
  startHand(room, room.host);
  return room;
}
test("deadline is sixty seconds, with no early expiry and exactly one fold at expiry", () => {
  const room = table();
  assert.ok(
    room.deadline - Date.now() <= TURN_TIMEOUT_MS &&
      room.deadline - Date.now() > TURN_TIMEOUT_MS - 1000,
  );
  const actor = room.players[room.turn];
  const time = room.deadline;
  assert.equal(expireTurn(room, time - 1), false);
  assert.equal(expireTurn(room, time), true);
  assert.equal(actor.folded, true);
  assert.match(room.log.at(-1), /超时自动弃牌/);
  assert.equal(room.phase, "showdown");
  assert.equal(room.deadline, null);
  assert.equal(expireTurn(room, time + 1), false);
});
test("checkable player still folds on timeout instead of silently checking", () => {
  const room = table();
  command(room, room.players[room.turn].id, "call");
  const actor = room.players[room.turn];
  assert.equal(actor.bet, room.currentBet);
  assert.equal(expireTurn(room, room.deadline), true);
  assert.equal(actor.folded, true);
  assert.equal(room.board.length, 0);
  assert.equal(
    room.players.reduce((s, p) => s + p.stack, 0),
    2000,
  );
});
test("non-acting snapshots and reconnects never reset the server deadline", () => {
  const room = table();
  const deadline = room.deadline;
  assert.ok(Number.isFinite(snapshot(room, room.host).serverTime));
  for (const p of room.players)
    assert.equal(snapshot(room, p.id).deadline, deadline);
  command(room, room.players[1].id, "rebuy", { amount: 20 });
  assert.equal(room.deadline, deadline);
});
test("room action time defaults to 60, validates inputs and survives recovery", () => {
  assert.equal(createRoom("Host").room.turnSeconds, 60);
  for (const seconds of [10, 30, 120, 300]) {
    const { room } = createRoom("Host", 1000, 5, 10, seconds);
    joinRoom(room, "Guest");
    startHand(room, room.host);
    assert.ok(
      room.deadline - Date.now() <= seconds * 1000 &&
        room.deadline - Date.now() > seconds * 1000 - 1000,
    );
    const recovered = JSON.parse(JSON.stringify(room));
    command(recovered, recovered.players[recovered.turn].id, "call");
    assert.equal(snapshot(recovered, recovered.host).turnSeconds, seconds);
    assert.ok(
      recovered.deadline - Date.now() <= seconds * 1000 &&
        recovered.deadline - Date.now() > seconds * 1000 - 1000,
    );
  }
  for (const seconds of [0, 9, 301, 30.5, "30", null, NaN])
    assert.throws(() => createRoom("Host", 1000, 5, 10, seconds), /行动时限/);
  const legacy = table();
  delete legacy.turnSeconds;
  command(legacy, legacy.players[legacy.turn].id, "call");
  assert.equal(snapshot(legacy, legacy.host).turnSeconds, 60);
  assert.ok(legacy.deadline - Date.now() > 59000);
});
