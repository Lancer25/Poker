import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,command} from '../server/game.js';

test("fold settlements preserve exactly the board already dealt, including none preflop", () => {
  for (const count of [0, 3, 4, 5]) {
    const { room } = createRoom("Host");
    joinRoom(room, "Friend");
    startHand(room, room.host);
    let actions = 0;
    while (room.board.length < count) {
      if(completeFlop(room))continue;
      assert.ok(actions++ < 30);
      const player = room.players[room.turn];
      command(room, player.id, player.bet < room.currentBet ? "call" : "check");
    }
    const board = [...room.board];
    command(room, room.players[room.turn].id, "fold");
    assert.equal(room.phase, "showdown");
    assert.equal(room.reveal, false);
    assert.deepEqual(room.history[0].board, board);
    assert.equal(room.history[0].board.length, count);
    startHand(room, room.host);
    assert.deepEqual(room.history[0].board, board);
  }
});
