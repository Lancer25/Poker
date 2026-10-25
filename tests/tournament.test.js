import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {completeFlop} from './game-helpers.js';
import {createRoom,joinRoom,command,settle,snapshot,advanceTournament} from '../server/game.js';
import {
  levelInfo,
  tournamentPositions,
  NEXT_HAND_DELAY_MS,
  announceTournamentLevel,
} from "../server/tournament.js";
function table(count = 3, mode = "standard", chips = 5000) {
  const { room } = createRoom("Host", chips, 5, 10, 60, mode);
  for (let i = 1; i < count; i++) joinRoom(room, "P" + i);
  return room;
}
function passive(room) {
  for (
    let steps = 0;
    room.phase !== "showdown" && room.phase !== "ended";
    steps++
  ) {
    assert.ok(steps < 100);
    if(completeFlop(room))continue;
    const p = room.players[room.turn];
    command(room, p.id, p.bet < room.currentBet ? "call" : "check");
  }
}
const total = (room) => room.players.reduce((sum, p) => sum + p.stack, 0);
test("formats default to cash, freeze roster at first deal, block rebuys and hidden-card spectators", () => {
  assert.equal(createRoom("Host").room.gameMode, "cash");
  assert.throws(() => createRoom("Host", 5000, 5, 10, 60, "unknown"));
  const room = table();
  assert.deepEqual([room.small, room.big, room.ante], [25, 50, 0]);
  command(room, room.host, "godmode", { enabled: false });
  for (const type of ["rebuy", "approve", "reject"])
    assert.throws(
      () => command(room, room.host, type, { amount: 1 }),
      /不能补充/,
    );
  startHand(room, room.host);
  assert.throws(() => joinRoom(room, "Late"), /比赛已开始/);
  assert.throws(
    () => command(room, room.host, "godmode", { enabled: true }),
    /不开放/,
  );
  const p = room.players[0];
  p.godMode = true;
  assert.equal(snapshot(room, p.id).godMode, false);
  assert.ok(
    snapshot(room, p.id)
      .players.slice(1)
      .every((p) => p.cards.every((c) => c === "??")),
  );
});
test("timed levels change only next hand; BBA starts at level three and remains dead money", () => {
  const room = table();
  const now = Date.now();
  startHand(room, room.host, now);
  room.tournament.startedAt = now - 1200000;
  const mid = snapshot(room, room.host).tournament;
  assert.equal(mid.level, 1);
  assert.equal(mid.scheduledLevel, 3);
  assert.equal(mid.pendingLevel.big, 150);
  assert.equal(announceTournamentLevel(room, now), true);
  assert.equal(announceTournamentLevel(room, now), false);
  assert.equal(room.big, 50);
  assert.equal(room.ante, 0);
  passive(room);
  const nextAt = room.tournament.nextHandAt;
  assert.throws(() => command(room, room.host, "start"), /自动继续/);
  assert.equal(advanceTournament(room, nextAt - 1), false);
  assert.equal(advanceTournament(room, nextAt), true);
  assert.equal(room.tournament.level, 3);
  const bb = room.players[room.bigBlindIndex];
  assert.equal(bb.bet, 150);
  assert.equal(bb.antePaid, 150);
  assert.equal(bb.total, 300);
  passive(room);
  assert.equal(total(room), 15000);
  assert.equal(advanceTournament(room, room.tournament.nextHandAt), true);
  assert.equal(room.hand, 3);
});
test("turbo level length and recovered scheduler preserve structure and action deadlines", () => {
  const room = table(2, "turbo");
  startHand(room, room.host);
  room.tournament.startedAt -= 300001;
  passive(room);
  const recovered = JSON.parse(JSON.stringify(room));
  assert.equal(recovered.tournament.levelDurationMs, 300000);
  assert.equal(
    advanceTournament(recovered, recovered.tournament.nextHandAt),
    true,
  );
  assert.equal(recovered.tournament.level, 2);
  assert.equal(recovered.big, 100);
  assert.equal(
    total(recovered) + recovered.players.reduce((s, p) => s + p.total, 0),
    10000,
  );
  assert.equal(levelInfo(100000).big, 16000000);
});
test("dead button/absent SB and heads-up transition never repeat a surviving player's big blind", () => {
  const room = table(5);
  room.players.forEach((p) => (p.inHand = true));
  room.smallBlindIndex = 1;
  room.bigBlindIndex = 2;
  room.players[2].inHand = false;
  assert.deepEqual(tournamentPositions(room), {
    dealer: 1,
    smallBlind: 2,
    bigBlind: 3,
  });
  room.players[1].inHand = false;
  assert.deepEqual(tournamentPositions(room), {
    dealer: 1,
    smallBlind: 2,
    bigBlind: 3,
  });
  room.players[0].inHand = false;
  assert.deepEqual(tournamentPositions(room), {
    dealer: 4,
    smallBlind: 4,
    bigBlind: 3,
  });
  room.bigBlindIndex = 3;
  room.smallBlindIndex = 4;
  assert.deepEqual(tournamentPositions(room), {
    dealer: 3,
    smallBlind: 3,
    bigBlind: 4,
  });
});
function prepared(liveBets, ante, starts = liveBets.map(() => 1000)) {
  const room = table(3);
  room.hand = 1;
  room.phase = "river";
  room.dealer = 0;
  room.tournament.startedAt = Date.now();
  room.tournament.level = 3;
  room.ante = ante;
  room.board = ["2h", "3d", "7c", "8d", "Jh"];
  const holes = [
    ["As", "Ad"],
    ["Ks", "Kd"],
    ["Qs", "Qd"],
  ];
  room.players.forEach((p, i) => {
    p.inHand = true;
    p.cards = holes[i];
    p.antePaid = i === 2 ? ante : 0;
    p.total = liveBets[i] + p.antePaid;
    p.stack = starts[i] - p.total;
    p.finishStack = starts[i] - p.antePaid;
  });
  room.tournament.totalChips = starts.reduce((a, b) => a + b, 0);
  return room;
}
test("BBA goes to main pot, not payer's wager tier, and uncalled live excess is refunded", () => {
  const room = prepared([200, 100, 100], 100);
  settle(room);
  assert.equal(room.pots[0].amount, 400);
  assert.equal(room.pots[1].amount, 100);
  assert.equal(room.pots[1].refund, true);
  assert.equal(total(room), 3000);
  const short = prepared([50, 100, 100], 100, [50, 1000, 1000]);
  settle(short);
  assert.equal(short.pots[0].amount, 250);
  assert.equal(short.players[0].stack, 250);
  assert.equal(short.pots[1].amount, 100);
  assert.deepEqual(short.pots[1].winners, ["P1"]);
  assert.equal(total(short), 2050);
});
test("ante is never returned as an unmatched bet when only the blind contributed", () => {
  const room = prepared([0, 0, 50], 50);
  room.players[0].folded = room.players[1].folded = true;
  settle(room);
  assert.equal(room.pots.find((p) => p.ante).amount, 50);
  assert.equal(room.pots.find((p) => p.refund).amount, 50);
  assert.equal(total(room), 3000);
});
test("short BBA payer posts blind first, may win all dead ante, and cannot invent a raise", () => {
  const room = table(3);
  startHand(room, room.host);
  passive(room);
  room.tournament.startedAt -= 1200000;
  const willBeBB = (room.bigBlindIndex + 1) % 3;
  room.players[willBeBB].stack = 175;
  startHand(room, room.host);
  const bb = room.players[room.bigBlindIndex];
  assert.equal(bb.bet, 150);
  assert.equal(bb.antePaid, 25);
  assert.equal(bb.stack, 0);
  assert.equal(bb.finishStack, 150);
  const heads = table(2);
  startHand(heads, heads.host);
  passive(heads);
  heads.tournament.startedAt -= 1200000;
  const nextBB = heads.players[heads.smallBlindIndex];
  nextBB.stack = 30;
  startHand(heads, heads.host);
  assert.equal(nextBB.antePaid, 0);
  assert.ok(heads.flopReveal);
  completeFlop(heads);
  assert.ok(["showdown", "ended"].includes(heads.phase)); // SB already covers short BB; winning may finish event
});
test("simultaneous busts rank by post-ante start stack, identical amounts tie, champion ends event", () => {
  const room = prepared([1000, 500, 300], 0, [1000, 500, 300]);
  settle(room);
  assert.equal(room.phase, "ended");
  assert.equal(room.tournament.completed, true);
  assert.equal(room.tournament.championId, room.players[0].id);
  assert.deepEqual(
    room.players.map((p) => p.place),
    [1, 2, 3],
  );
  assert.equal(total(room), 1800);
  assert.equal(
    advanceTournament(room, Date.now() + NEXT_HAND_DELAY_MS * 2),
    false,
  );
  assert.ok(
    snapshot(room, room.players[1].id).players[0].cards.every(
      (c) => c !== "??",
    ),
  );
  const tie = prepared([1000, 300, 300], 0, [1000, 300, 300]);
  settle(tie);
  assert.deepEqual(
    tie.players.map((p) => p.place),
    [1, 2, 2],
  );
  assert.ok(
    tie.tournament.standings.filter((s) => s.place === 2).every((s) => s.tied),
  );
});
test("stop request completes current hand and cancels without awarding a fake champion", () => {
  const room = table();
  startHand(room, room.host);
  command(room, room.host, "end");
  assert.equal(room.phase, "preflop");
  passive(room);
  assert.equal(room.phase, "ended");
  assert.equal(room.tournament.cancelled, true);
  assert.equal(room.tournament.completed, false);
  assert.equal(room.tournament.championId, undefined);
});
test("7/9-player all-in tournaments terminate with strict chip conservation and unique champion", () => {
  for (const count of [7, 9])
    for (let run = 0; run < 15; run++) {
      const room = table(count, "turbo", 1000);
      if (run % 2) {
        room.tournament.startedAt = Date.now() - 600001;
        room.tournament.totalChips = count * 1000;
      }
      startHand(room, room.host);
      for (let actions = 0; room.phase !== "ended"; actions++) {
        assert.ok(actions < 300);
        if(room.flopReveal)completeFlop(room);
        else if (room.phase === "showdown")
          advanceTournament(room, room.tournament.nextHandAt);
        else {
          const p = room.players[room.turn];
          command(
            room,
            p.id,
            room.players.filter((p) => p.inHand && !p.folded && p.stack > 0)
              .length > 1
              ? "allin"
              : "call",
          );
        }
        const conservation =
          total(room) +
          (room.phase === "showdown" || room.phase === "ended"
            ? 0
            : room.players.reduce((s, p) => s + p.total, 0));
        assert.equal(conservation, count * 1000);
      }
      assert.equal(room.players.filter((p) => p.place === 1).length, 1);
      assert.equal(room.tournament.standings.length, count);
      assert.equal(total(room), count * 1000);
    }
});
