import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import {createRoom,joinRoom,command} from '../server/game.js';
import {
  updateLifecycle,
  lifecycleView,
  onlinePlayers,
  ROOM_IDLE_TIMEOUT_MS,
} from "../server/room-lifecycle.js";
import { recoverUnclaimedHost } from "../server/room-ownership.js";
const table = (mode = "cash") => {
  const { room } = createRoom("Host", 1000, 5, 10, 60, mode);
  joinRoom(room, "Guest");
  return room;
};
test("legacy grace, ten-minute boundary and idempotent archival", () => {
  const r = table();
  assert.equal(ROOM_IDLE_TIMEOUT_MS, 600000);
  assert.equal(updateLifecycle(r, new Set(), 1000), true);
  assert.equal(r.idleSince, 1000);
  assert.equal(lifecycleView(r, new Set(), 1000).status, "offline");
  assert.equal(lifecycleView(r, new Set(), 1000).idleDeadline, 601000);
  updateLifecycle(r, new Set(), 600999);
  assert.equal(r.phase, "waiting");
  updateLifecycle(r, new Set(), 601000);
  assert.equal(r.phase, "ended");
  assert.equal(r.endReason, "idle");
  assert.equal(r.completedRounds[0].endReason, "idle");
  updateLifecycle(r, new Set(), 700000);
  assert.equal(r.completedRounds.length, 1);
});
test("a just-closing connection has a safe provisional deadline without modifying its room", () => {
  const r = table();
  r.idleSince = null;
  const before = JSON.stringify(r),
    view = lifecycleView(r, new Set(), 1000);
  assert.equal(view.idleDeadline - view.idleSince, 600000);
  assert.equal(JSON.stringify(r), before);
});
test("reconnect cancels the idle clock, preserved offline timer survives JSON restart", () => {
  const r = table();
  updateLifecycle(r, new Set(), 1000);
  updateLifecycle(r, new Set([r.host]), 400000);
  assert.equal(r.idleSince, null);
  assert.equal(lifecycleView(r, new Set([r.host]), 400000).status, "waiting");
  updateLifecycle(r, new Set(), 500000);
  const restored = JSON.parse(JSON.stringify(r));
  updateLifecycle(restored, new Set(), 1100000);
  assert.equal(restored.phase, "ended");
});
test("a reconnect arriving after the deadline does not undo an expired idle round", () => {
  const r = table();
  updateLifecycle(r, new Set(), 1000);
  updateLifecycle(r, new Set([r.host]), 601001);
  assert.equal(r.phase, "ended");
  assert.equal(r.endReason, "idle");
});
test("committed end waits for ordinary settlement, never resets deadline or seizes chips", () => {
  const r = table();
  startHand(r, r.host);
  const deadline = r.deadline;
  updateLifecycle(r, new Set(), 1000);
  updateLifecycle(r, new Set(), 601000);
  assert.equal(r.idleEndRequested, true);
  assert.equal(r.phase, "preflop");
  assert.equal(r.deadline, deadline);
  updateLifecycle(r, new Set([r.host]), 601001);
  assert.equal(r.idleEndRequested, true);
  command(r, r.players[r.turn].id, "fold");
  assert.equal(r.phase, "showdown");
  assert.throws(() => startHand(r, r.host));
  updateLifecycle(r, new Set([r.host]), 601002);
  assert.equal(r.phase, "ended");
  assert.equal(
    r.players.reduce((s, p) => s + p.stack, 0),
    2000,
  );
  command(r, r.host, "restart", { round: 1 });
  assert.equal(r.idleEndRequested, false);
  assert.equal(r.endReason, null);
  startHand(r, r.host);
});
test("tournament closure commits stop-after-hand and archives its normal settlement", () => {
  const r = table("turbo");
  startHand(r, r.host);
  updateLifecycle(r, new Set(), 0);
  updateLifecycle(r, new Set(), 600000);
  assert.equal(r.tournament.stopRequested, true);
  command(r, r.players[r.turn].id, "fold");
  assert.equal(r.phase, "ended");
  assert.equal(r.tournament.cancelled, true);
  assert.equal(r.completedRounds[0].endReason, "idle");
});
test("presence counts unique valid live members, not tabs, lobby, stale or revoked sockets", () => {
  const r = table();
  r.players[0].accountId = "owner";
  r.players[1].accountId = "guest";
  const socket = (changes = {}) => ({
    readyState: 1,
    identity: { room: r.id, player: r.host },
    accountId: "owner",
    authToken: "valid",
    lastPongAt: 1000,
    ...changes,
  });
  const list = [
    socket(),
    socket(),
    socket({ identity: null }),
    socket({ lastPongAt: 0 }),
    socket({ authToken: "revoked" }),
    socket({ readyState: 3 }),
    socket({
      identity: { room: r.id, player: r.players[1].id },
      accountId: "owner",
    }),
  ];
  const getUser = (token) => (token === "valid" ? { id: "owner" } : null);
  const presence = onlinePlayers(
    list,
    new Map([[r.id, r]]),
    getUser,
    1100,
    100,
  );
  assert.equal(presence.get(r.id).size, 1);
});
test("automatic idle closure retains authorized legacy host recovery for later rematch", () => {
  const r = table();
  updateLifecycle(r, new Set(), 0);
  updateLifecycle(r, new Set(), 600000);
  assert.equal(
    recoverUnclaimedHost(r, { id: "owner", nickname: "Owner" }).hostRecovered,
    true,
  );
  assert.equal(r.players[0].accountId, "owner");
  assert.throws(() =>
    recoverUnclaimedHost(r, { id: "intruder", nickname: "Other" }),
  );
  command(r, r.host, "restart", { round: 1 });
  assert.equal(r.phase, "waiting");
});
