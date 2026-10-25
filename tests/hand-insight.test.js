import test from "node:test";
import assert from "node:assert/strict";
import { handInsight, callPrice } from "../server/hand-insight.js";
import { createRoom, joinRoom, snapshot } from "../server/game.js";
const hint = (
  cards,
  board,
  phase = board.length === 3 ? "flop" : board.length === 4 ? "turn" : "river",
) => handInsight({ cards, board, phase });

test("current best hand uses the established solver, including wheel and royal flush", () => {
  const cases = [
    [["As", "Kd"], ["Qc", "9h", "7s"], "高牌"],
    [["As", "Ad"], ["Qc", "9h", "7s"], "一对"],
    [["As", "Ad"], ["Qc", "Qh", "7s"], "两对"],
    [["As", "Ad"], ["Ac", "9h", "7s"], "三条"],
    [["As", "2d"], ["3c", "4h", "5s"], "顺子"],
    [["As", "Ts"], ["3s", "7s", "9s"], "同花"],
    [["As", "Ad"], ["Ac", "9h", "9s"], "葫芦"],
    [["As", "Ad"], ["Ac", "Ah", "9s"], "四条"],
    [["9s", "Ts"], ["Js", "Qs", "Ks"], "同花顺"],
    [["As", "Ts"], ["Js", "Qs", "Ks"], "皇家同花顺"],
  ];
  cases.forEach(([cards, board, label]) => {
    const result = hint(cards, board);
    assert.equal(result.label, label);
    assert.equal(result.bestCards.length, 5);
    assert.ok(result.bestCards.every((c) => [...cards, ...board].includes(c)));
  });
});

test("draws calculate next card only, include wheel and deduplicate combination outs", () => {
  const flush = hint(["As", "Ks"], ["2s", "7s", "Qd"]);
  assert.deepEqual(flush.draws, [
    { label: "同花听牌", outs: 9, nextProbability: 19.1 },
  ]);
  const straight = hint(["8h", "9d"], ["Ts", "Jc", "2h"]);
  assert.equal(straight.draws[0].outs, 8);
  const wheel = hint(["As", "2d"], ["3c", "4h", "Kh"]);
  assert.equal(wheel.draws[0].outs, 4);
  const combined = hint(["8s", "9s"], ["Ts", "Js", "2h"]);
  assert.equal(combined.combined.outs, 15);
  assert.equal(combined.combined.nextProbability, 31.9);
  assert.equal(
    hint(["As", "Ks"], ["2s", "7s", "Qd", "3h"]).draws[0].nextProbability,
    19.6,
  );
  assert.equal(
    hint(["As", "Ks"], ["2s", "7s", "Qd", "3h", "4c"]).draws.length,
    0,
  );
  assert.equal(
    hint(["As", "Ks"], ["2s", "7s", "Qd"], "showdown").draws.length,
    0,
  );
});

test("shared board, preflop, missing or folded cards produce appropriate hints", () => {
  assert.match(
    hint(["2h", "3d"], ["As", "Ks", "Qs", "Js", "Ts"]).note,
    /公共牌相同/,
  );
  assert.equal(hint(["As", "Ad"], [], "preflop").label, "手持对子");
  assert.equal(hint(["??", "Ad"], ["Qc", "9h", "7s"]), null);
  assert.equal(
    handInsight({
      cards: ["As", "Ad"],
      board: ["Qc", "9h", "7s"],
      phase: "flop",
      folded: true,
    }),
    null,
  );
});

test("call reference suppresses incomplete calls, multiway and inaccessible side pots", () => {
  const input = {
    pot: 150,
    toCall: 50,
    stack: 100,
    actionable: true,
    covered: true,
    headsUp: true,
  };
  assert.equal(callPrice(input).percent, 25);
  for (const patch of [
    { headsUp: false },
    { covered: false },
    { actionable: false },
    { stack: 49 },
    { toCall: 0 },
  ])
    assert.equal(callPrice({ ...input, ...patch }), null);
});

test("opponent labels appear only when showdown actually reveals their cards", () => {
  const { room, player } = createRoom("Host");
  const other = joinRoom(room, "Guest");
  Object.assign(room, {
    phase: "river",
    board: ["2s", "7s", "Qd", "3h", "4c"],
    reveal: false,
  });
  Object.assign(player, { cards: ["As", "Ks"], inHand: true });
  Object.assign(other, { cards: ["Qh", "Qc"], inHand: true });
  assert.equal(snapshot(room, player.id).players[1].handLabel, null);
  room.phase = "showdown";
  assert.equal(snapshot(room, player.id).players[1].handLabel, null);
  room.reveal = true;
  assert.equal(snapshot(room, player.id).players[1].handLabel, "三条");
  other.folded = true;
  assert.equal(snapshot(room, player.id).players[1].handLabel, null);
});

test("snapshot hints are recipient-specific, independent of hidden deck and never mutate game", () => {
  const { room, player } = createRoom("Host");
  const other = joinRoom(room, "Guest");
  Object.assign(room, {
    phase: "flop",
    board: ["2s", "7s", "Qd"],
    turn: 0,
    currentBet: 10,
    deck: ["8s"],
  });
  Object.assign(player, { cards: ["As", "Ks"], inHand: true });
  Object.assign(other, { cards: ["Qh", "Qc"], inHand: true });
  const before = JSON.stringify(room);
  const first = snapshot(room, player.id).insight;
  assert.equal(JSON.stringify(room), before);
  other.cards = ["Ah", "Ad"];
  room.deck = ["3h", "4c"];
  assert.deepEqual(snapshot(room, player.id).insight, first);
  assert.notDeepEqual(snapshot(room, other.id).insight, first);
  assert.ok(
    snapshot(room, player.id).players[1].cards.every((c) => c === "??"),
  );
});
