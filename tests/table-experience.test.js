import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const context = { module: { exports: {} } };
vm.runInNewContext(
  readFileSync("miniprogram/utils/table-experience.js", "utf8"),
  context,
);
const {
  preferences,
  betOptions,
  decisionKey,
  transitions,
  WarningClock,
  winnerIds,
} = context.module.exports;
const room = (extra = {}) => ({
  id: "r",
  me: "a",
  hand: 1,
  phase: "flop",
  turn: 0,
  deadline: 60000,
  serverTime: 1000,
  currentBet: 300,
  minRaise: 300,
  toCall: 300,
  canRaise: true,
  pot: 1200,
  board: ["Ah", "9c", "4d"],
  players: [
    {
      id: "a",
      name: "A",
      bet: 0,
      stack: 5000,
      totalBet: 150,
      cards: ["As", "Kd"],
    },
    { id: "b", name: "B", bet: 300, stack: 4700, totalBet: 450 },
  ],
  pots: [],
  ...extra,
});
test("winner identity never confuses identical nicknames or refunds", () => {
  const r = room({
    players: [
      { id: "a", name: "Same" },
      { id: "b", name: "Same" },
    ],
    pots: [
      { winners: ["Same"], winnerIds: ["b"], amount: 100 },
      { winners: ["Same"], winnerIds: ["a"], amount: 30, refund: true },
    ],
  });
  assert.equal(winnerIds(r).join(","), "b");
  assert.equal(
    winnerIds({ ...r, pots: [{ winners: ["Same"], amount: 100 }] }).length,
    0,
  );
});
test("local preferences are bounded and safe by default", () => {
  assert.equal(preferences(null).sound, false);
  assert.equal(preferences({ sound: "false", volume: NaN }).sound, false);
  assert.equal(preferences({ volume: 9 }).volume, 1);
  assert.equal(preferences({ volume: -1 }).volume, 0);
  assert.equal(preferences({ motion: false, fourColor: true }).motion, false);
});
test("presets use raise-to plus post-call pot and clamp legal values", () => {
  const b = betOptions(room());
  assert.equal(b.min, 600);
  assert.equal(b.max, 5000);
  assert.equal(b.half, 1050);
  assert.equal(b.pot, 1800);
  const short = betOptions(
    room({ players: [{ id: "a", bet: 100, stack: 200 }] }),
  );
  assert.equal(short.max, 300);
  assert.equal(short.canRaise, false);
  assert.equal(short.canAllin, true);
  assert.equal(betOptions(room({ canRaise: false })).canAllin, false);
});
test("decision identity survives unrelated logs but changes on new turn", () => {
  assert.equal(decisionKey(room()), decisionKey(room({ log: ["joined"] })));
  assert.notEqual(decisionKey(room()), decisionKey(room({ deadline: 61000 })));
});
test("new rounds create fresh decisions and do not replay old bets or folds", () => {
  const a = room({ roundNumber: 1, hand: 12, phase: "ended" }),
    b = room({ roundNumber: 2, hand: 1, phase: "preflop" });
  assert.notEqual(decisionKey(a), decisionKey(b));
  assert.equal(transitions(a, b).filter((e) => e.kind === "deal").length, 1);
  assert.equal(
    transitions(a, b).filter((e) => ["bet", "fold", "settle"].includes(e.kind))
      .length,
    0,
  );
  assert.equal(transitions(b, a).length, 0);
});
test("no replay on baseline, reconnect, stale or identical snapshots", () => {
  assert.equal(transitions(null, room()).length, 0);
  assert.equal(transitions(room(), room()).length, 0);
  assert.equal(
    transitions(
      room(),
      room({ serverTime: 500, board: ["Ah", "9c", "4d", "Ts"] }),
    ).length,
    0,
  );
  assert.equal(transitions(room(), room({ id: "other" })).length, 0);
});
test("only authorized board, bet, fold and turn transitions create feedback", () => {
  const a = room(),
    b = room({
      turn: 1,
      deadline: 61000,
      serverTime: 2000,
      players: [{ ...a.players[0], totalBet: 450, stack: 4700 }, a.players[1]],
    });
  assert.equal(transitions(a, b).filter((e) => e.kind === "bet").length, 1);
  assert.equal(
    transitions(b, room({ ...b, turn: 0, deadline: 62000 })).filter(
      (e) => e.kind === "turn",
    ).length,
    1,
  );
  assert.equal(
    transitions(a, room({ phase: "turn", board: [...a.board, "Ts"] })).filter(
      (e) => e.kind === "board",
    ).length,
    1,
  );
});
test('check sound follows a real zero-price turn transition, not board reveal or baseline',()=>{
 const a=room({currentBet:0,players:[{id:'a',stack:100,bet:0,totalBet:0,inHand:true},{id:'b',stack:100,bet:0,totalBet:0,inHand:true}]});
 const b={...a,turn:1,deadline:61000,serverTime:2000};
 assert.equal(transitions(a,b).filter(e=>e.kind==='check').length,1);
 assert.equal(transitions(a,{...b,flopReveal:{}}).filter(e=>e.kind==='check').length,0);
 assert.equal(transitions(a,{...b,phase:'turn',board:[...a.board,'Ts']}).filter(e=>e.kind==='check').length,0);
});
test("settlement excludes refunds and warnings occur once only on own active turn", () => {
  const a = room(),
    b = room({
      phase: "showdown",
      turn: -1,
      pots: [
        { winners: ["B"], amount: 1200 },
        { winners: ["A"], amount: 100, refund: true },
      ],
    });
  const event = transitions(a, b).find((e) => e.kind === "settle");
  assert.equal(event.winners[0], "b");
  assert.equal(event.winners.length, 1);
  const clock = new WarningClock();
  assert.equal(clock.tick(a, 11), false);
  assert.equal(clock.tick(a, 10), true);
  assert.equal(clock.tick(a, 9), false);
  assert.equal(clock.tick(room({ deadline: 61000 }), 8), true);
  assert.equal(clock.tick(room({ turn: 1 }), 5), false);
  clock.reset();
  assert.equal(clock.tick(a, 0), false);
});
