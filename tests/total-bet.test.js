import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,command,snapshot} from '../server/game.js';
test("per-hand totals include blinds, survive street changes, retain folds and reset on new hand", () => {
  const { room, player } = createRoom("Host");
  joinRoom(room, "Guest");
  startHand(room, player.id);
  assert.deepEqual(
    snapshot(room, player.id).players.map((p) => p.totalBet),
    [5, 10],
  );
  command(room, room.players[room.turn].id, "call");
  command(room, room.players[room.turn].id, "check");
  let view = snapshot(room, player.id);
  assert.equal(view.phase, "flop");
  assert.deepEqual(
    view.players.map((p) => p.bet),
    [0, 0],
  );
  assert.deepEqual(
    view.players.map((p) => p.totalBet),
    [10, 10],
  );
  completeFlop(room);
  command(room, room.players[room.turn].id, "raise", { amount: 30 });
  command(room, room.players[room.turn].id, "call");
  view = snapshot(room, player.id);
  assert.equal(view.phase, "turn");
  assert.deepEqual(
    view.players.map((p) => p.totalBet),
    [40, 40],
  );
  assert.deepEqual(
    view.players.map((p) => p.bet),
    [0, 0],
  );
  command(room, room.players[room.turn].id, "fold");
  assert.deepEqual(
    snapshot(room, player.id).players.map((p) => p.totalBet),
    [40, 40],
  );
  startHand(room, player.id);
  assert.deepEqual(
    snapshot(room, player.id).players.map((p) => p.totalBet),
    [10, 5],
  );
});
