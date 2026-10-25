import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,command,snapshot,settle} from '../server/game.js';
function ended(mode = "cash") {
  const { room } = createRoom("Host", 1000, 5, 10, 60, mode);
  joinRoom(room, "Guest");
  room.players[0].accountId = "owner";
  room.players[0].avatar = "/avatars/example.jpg";
  startHand(room, room.host);
  command(room, room.players[room.turn].id, "fold");
  if (room.phase !== "ended") command(room, room.host, "end");
  return room;
}
test("default rematch resets stacks, preserves identities and archives immutable previous results", () => {
  const r = ended(),
    ids = r.players.map((p) => p.id),
    old = snapshot(r, r.host);
  command(r, r.host, "restart", { round: 1 });
  assert.equal(r.phase, "waiting");
  assert.equal(r.roundNumber, 2);
  assert.equal(r.hand, 0);
  assert.equal(r.history.length, 0);
  assert.deepEqual(
    r.players.map((p) => p.id),
    ids,
  );
  assert.equal(r.players[0].accountId, "owner");
  assert.equal(r.players[0].avatar, "/avatars/example.jpg");
  assert.ok(
    r.players.every(
      (p) =>
        p.stack === 1000 && p.buyin === 1000 && !p.inHand && !p.cards.length,
    ),
  );
  assert.deepEqual(r.completedRounds[0].results, old.results);
  assert.equal(r.completedRounds.length, 1);
  r.players[0].name = "Renamed";
  startHand(r, r.host);
  assert.equal(r.completedRounds[0].results[0].name, "Host");
  assert.equal(r.completedRounds[0].history.length, 1);
  assert.equal(r.completedRounds[0].history[0].hand, 1);
});
test("carry preserves stacks, gives a fresh buy-in baseline and clears stale requests/deadlines/roles", () => {
  const r = ended();
  r.players[1].stack = 0;
  r.requests = [
    { id: "pending", status: "pending", player: r.players[0].id, amount: 100 },
  ];
  const stacks = r.players.map((p) => p.stack);
  command(r, r.host, "restart", { round: 1, chipMode: "carry" });
  assert.deepEqual(
    r.players.map((p) => p.stack),
    stacks,
  );
  assert.ok(snapshot(r, r.host).results.every((p) => p.net === 0));
  assert.equal(r.requests.length, 0);
  assert.equal(r.turn, -1);
  assert.equal(r.deadline, null);
  assert.equal(r.dealer, -1);
  assert.equal(r.players[1].godMode, false);
  command(r, r.players[1].id, "rebuy", { amount: 100 });
  assert.equal(r.requests.length, 1);
});
test("unauthorized, wrong phase/mode and stale round are mutation-free; reopening is not duplicated", () => {
  const r = ended(),
    before = JSON.stringify(r);
  assert.throws(() => command(r, r.players[1].id, "restart", { round: 1 }));
  assert.throws(() =>
    command(r, r.host, "restart", { round: 1, chipMode: "invalid" }),
  );
  assert.throws(() => command(r, r.host, "restart", { round: 0 }));
  assert.equal(JSON.stringify(r), before);
  command(r, r.host, "restart", { round: 1 });
  const fresh = JSON.stringify(r);
  assert.throws(() => command(r, r.host, "restart", { round: 1 }));
  assert.equal(JSON.stringify(r), fresh);
  command(r, r.host, "end");
  assert.throws(() => command(r, r.host, "restart", { round: 1 }));
  command(r, r.host, "restart", { round: 2 });
  assert.equal(r.completedRounds.length, 2);
  assert.equal(r.roundNumber, 3);
});
test("legacy ended rooms recover and archives never expose private cards or account credentials", () => {
  const r = ended();
  delete r.roundNumber;
  delete r.completedRounds;
  delete r.roundChipMode;
  const recovered = JSON.parse(JSON.stringify(r));
  command(recovered, recovered.host, "restart", { round: 1 });
  const archive = snapshot(recovered, recovered.host).completedRounds[0];
  assert.equal(archive.number, 1);
  assert.equal(archive.history.length, 1);
  const text = JSON.stringify(archive);
  assert.ok(!text.includes("accountId"));
  assert.ok(!text.includes('"deck"'));
  assert.ok(!text.includes('"cards"'));
});
test("new tournament round clears champion/elimination/schedules; carry cannot revive zero-stack entrants", () => {
  const r = ended("turbo");
  assert.equal(r.tournament.completed, false);
  command(r, r.host, "restart", { round: 1 });
  assert.equal(r.tournament.startedAt, null);
  assert.equal(r.tournament.nextHandAt, null);
  assert.equal(r.tournament.completed, false);
  assert.deepEqual(r.tournament.standings, []);
  assert.equal(r.small, 25);
  assert.equal(r.big, 50);
  startHand(r, r.host);
  command(r, r.host, "end");
  while (r.phase !== "ended") command(r, r.players[r.turn].id, "fold");
  r.players[1].stack = 0;
  const old = JSON.stringify(r);
  assert.throws(() =>
    command(r, r.host, "restart", { round: 2, chipMode: "carry" }),
  );
  assert.equal(JSON.stringify(r), old);
  command(r, r.host, "restart", { round: 2 });
  assert.ok(
    r.players.every(
      (p) => !p.eliminated && p.place === null && p.stack === 1000,
    ),
  );
});
test("automatic tournament finish archives its final hand and restarts with fresh entrants", () => {
  const { room: r } = createRoom("Host", 1000, 5, 10, 60, "standard");
  joinRoom(r, "Guest");
  startHand(r, r.host);
  r.phase = "river";
  r.board = ["2h", "3d", "7c", "8d", "Jh"];
  r.players.forEach((p, i) =>
    Object.assign(p, {
      stack: 0,
      total: 1000,
      antePaid: 0,
      cards: i === 0 ? ["As", "Ad"] : ["Ks", "Kd"],
      inHand: true,
      folded: false,
    }),
  );
  settle(r);
  assert.equal(r.phase, "ended");
  assert.equal(r.completedRounds.length, 1);
  assert.equal(r.completedRounds[0].history.length, 1);
  assert.equal(r.completedRounds[0].tournament.championId, r.players[0].id);
  assert.equal(snapshot(r, r.host).canCarryRound, false);
  command(r, r.host, "restart", { round: 1 });
  assert.equal(r.phase, "waiting");
  assert.equal(r.tournament.completed, false);
  assert.ok(r.players.every((p) => p.stack === 1000 && !p.eliminated));
});
