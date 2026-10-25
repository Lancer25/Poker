import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,command,snapshot} from '../server/game.js';
function roles(room) {
  const { dealer, smallBlind, bigBlind } = snapshot(room, room.host);
  return { dealer, smallBlind, bigBlind };
}
test("roles are absent before the first hand and heads-up dealer is also small blind", () => {
  const { room } = createRoom("Host");
  joinRoom(room, "Guest");
  assert.deepEqual(roles(room), { dealer: -1, smallBlind: -1, bigBlind: -1 });
  startHand(room, room.host);
  assert.deepEqual(roles(room), { dealer: 0, smallBlind: 0, bigBlind: 1 });
  command(room, room.players[room.turn].id, "fold");
  startHand(room, room.host);
  assert.deepEqual(roles(room), { dealer: 1, smallBlind: 1, bigBlind: 0 });
});
test("multiway blind markers remain after folding and ignore mid-hand arrivals", () => {
  const { room } = createRoom("Host");
  joinRoom(room, "SB");
  joinRoom(room, "BB");
  startHand(room, room.host);
  command(room, room.players[0].id, "call");
  command(room, room.players[1].id, "fold");
  joinRoom(room, "Late Arrival");
  assert.deepEqual(roles(room), { dealer: 0, smallBlind: 1, bigBlind: 2 });
  assert.deepEqual(roles(JSON.parse(JSON.stringify(room))), roles(room));
});
test("zero-chip spectators are skipped but players all-in on their blind retain markers", () => {
  const { room } = createRoom("Host");
  const observer = joinRoom(room, "Observer");
  observer.stack = 0;
  const sb = joinRoom(room, "SB");
  sb.stack = 5;
  const bb = joinRoom(room, "BB");
  bb.stack = 10;
  startHand(room, room.host);
  assert.equal(sb.stack, 0);
  assert.equal(bb.stack, 0);
  assert.deepEqual(roles(room), { dealer: 0, smallBlind: 2, bigBlind: 3 });
});
