import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,command} from '../server/game.js';

test("mid-hand approval waits for settlement, survives repeated approval and permits another hand", () => {
  const { room, player: host } = createRoom("Host", 10, 5, 10);
  const guest = joinRoom(room, "Guest");
  const id = room.id;
  startHand(room, host.id);
  const before = room.players.map((p) => ({
    stack: p.stack,
    buyin: p.buyin,
    bet: p.bet,
    total: p.total,
    cards: [...p.cards],
  }));
  const turn = room.turn,
    deadline = room.deadline;
  command(room, guest.id, "rebuy", { amount: 100 });
  const guestRequest = room.requests[0].id;
  command(room, host.id, "approve", { request: guestRequest });
  command(room, host.id, "approve", { request: guestRequest });
  command(room, host.id, "rebuy", { amount: 100 });
  const hostRequest = room.requests.find((r) => r.player === host.id).id;
  command(room, host.id, "approve", { request: hostRequest });
  assert.deepEqual(
    room.players.map((p) => ({
      stack: p.stack,
      buyin: p.buyin,
      bet: p.bet,
      total: p.total,
      cards: [...p.cards],
    })),
    before,
  );
  assert.equal(room.turn, turn);
  assert.equal(room.deadline, deadline);
  assert.ok(room.requests.every((r) => r.status === "approved"));
  command(room, host.id, "call");
  assert.ok(room.flopReveal);assert.equal(room.requests.length,2);
  completeFlop(room);
  assert.equal(room.phase, "showdown");
  assert.equal(room.requests.length, 0);
  assert.ok(room.players.every((p) => p.stack >= 100));
  assert.equal(
    room.players.reduce((sum, p) => sum + p.stack, 0),
    220,
  );
  assert.equal(
    room.players.reduce((sum, p) => sum + p.buyin, 0),
    220,
  );
  assert.equal(
    room.history[0].results.reduce((sum, p) => sum + p.buyin, 0),
    20,
  );
  startHand(room, host.id);
  assert.equal(room.id, id);
  assert.equal(room.hand, 2);
  assert.equal(room.players.length, 2);
  assert.equal(
    room.players.reduce((sum, p) => sum + p.stack + p.total, 0),
    220,
  );
});

test("host can reject pending or queued requests during play; guests cannot approve", () => {
  const { room, player: host } = createRoom("Host");
  const guest = joinRoom(room, "Guest");
  startHand(room, host.id);
  const initial = room.players.map((p) => [p.stack, p.buyin]);
  command(room, guest.id, "rebuy", { amount: 500 });
  const first = room.requests[0].id;
  assert.throws(
    () => command(room, guest.id, "approve", { request: first }),
    /房主/,
  );
  command(room, host.id, "reject", { request: first });
  assert.equal(room.requests.length, 0);
  command(room, guest.id, "rebuy", { amount: 500 });
  const second = room.requests[0].id;
  command(room, host.id, "approve", { request: second });
  command(room, host.id, "reject", { request: second });
  assert.equal(room.requests.length, 0);
  assert.deepEqual(
    room.players.map((p) => [p.stack, p.buyin]),
    initial,
  );
});
