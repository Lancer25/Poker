import test from "node:test";
import assert from "node:assert/strict";
import {
  recentRooms,
  canViewHistory,
  adminHistory,
} from "../server/room-history.js";
const user = { id: "u", role: "user" },
  admin = { id: "a", role: "admin" };
const room = (id, time = 0) => ({
  id,
  phase: "ended",
  host: "p",
  initial: 1000,
  small: 5,
  big: 10,
  hand: 1,
  roundNumber: 1,
  players: [
    {
      id: "p",
      accountId: "u",
      lastVisitedAt: time,
      name: "Name",
      stack: 1010,
      buyin: 1000,
      cards: ["As", "Ad"],
    },
  ],
  history: [
    {
      hand: 1,
      board: ["2h", "3d", "4c"],
      pots: [{ amount: 20, winners: ["Name"] }],
      results: [
        {
          id: "p",
          name: "Name",
          stack: 1010,
          buyin: 1000,
          net: 10,
          cards: ["As", "Ad"],
        },
      ],
    },
  ],
  completedRounds: [],
  deck: ["Ks"],
  requests: [{ secret: "private" }],
});
test("ordinary lists have five most recently visited own rooms; no data is removed", () => {
  const all = Array.from({ length: 8 }, (_, i) => room(String(i), i + 1));
  const map = new Map(all.map((r) => [r.id, r]));
  assert.deepEqual(
    recentRooms(map, user).map((r) => r.id),
    ["7", "6", "5", "4", "3"],
  );
  assert.equal(map.size, 8);
  const ownedAdmin = { ...user, role: "admin" };
  assert.equal(recentRooms(map, ownedAdmin).length, 8);
});
test("legacy insertion order is deterministic and active games are never forbidden", () => {
  const all = Array.from({ length: 7 }, (_, i) => room(String(i)));
  const map = new Map(all.map((r) => [r.id, r]));
  assert.equal(recentRooms(map, user)[0].id, "6");
  assert.equal(canViewHistory(all[0], user, map), false);
  all[0].phase = "flop";
  assert.equal(canViewHistory(all[0], user, map), true);
  assert.equal(canViewHistory({ ...all[1], phase: "ended" }, admin, map), true);
});
test("admin history is an immutable public projection and prefers archived final scores", () => {
  const r = room("r");
  r.completedRounds = [
    {
      number: 1,
      hand: 1,
      finishedAt: "2026-10-10T00:00:00Z",
      results: [
        { id: "p", name: "Original", stack: 1010, buyin: 1000, net: 10 },
      ],
      history: r.history,
      deck: ["Qc"],
      accountId: "private",
    },
  ];
  const before = JSON.stringify(r),
    data = adminHistory(r);
  assert.equal(data.rounds.length, 1);
  assert.equal(data.rounds[0].results[0].name, "Original");
  const body = JSON.stringify(data);
  for (const field of ['"cards"', '"deck"', '"accountId"', '"requests"'])
    assert.equal(body.includes(field), false);
  data.rounds[0].results[0].name = "Changed";
  assert.equal(JSON.stringify(r), before);
});
test("missing legacy boards stay distinct from explicit empty boards", () => {
  const r = room("r");
  r.history = [
    { hand: 1, pots: [], results: [] },
    { hand: 2, board: [], pots: [], results: [] },
  ];
  const list = adminHistory(r).rounds[0].history;
  assert.equal(Array.isArray(list[0].board), false);
  assert.deepEqual(list[1].board, []);
});
