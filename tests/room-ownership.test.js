import test from "node:test";
import assert from "node:assert/strict";
import { createRoom, joinRoom, command } from "../server/game.js";
import {
  claimLegacyRooms,
  recoverUnclaimedHost,
  bindLegacyPlayer,
} from "../server/room-ownership.js";

function legacy() {
  const { room, player: host } = createRoom("Old Host");
  const guest = joinRoom(room, "Old Guest");
  const sessions = new Map([
    ["guest-token", { room: room.id, player: guest.id }],
    ["host-token", { room: room.id, player: host.id }],
  ]);
  return { room, host, guest, sessions, rooms: new Map([[room.id, room]]) };
}

test("legacy host token takes precedence over a newer guest token on first account binding", () => {
  const f = legacy(),
    user = { id: "user", nickname: "Owner" };
  const result = claimLegacyRooms(f.rooms, f.sessions, user, [
    "guest-token",
    "host-token",
  ]);
  assert.deepEqual(result.claimed, [f.room.id]);
  assert.equal(f.host.accountId, user.id);
  assert.equal(f.room.host, f.host.id);
  assert.equal(f.guest.accountId, undefined);
  assert.equal(f.room.players.length, 2);
});

test("recover migrated host privileges without changing the existing guest seat or chips", () => {
  const f = legacy(),
    user = { id: "user", nickname: "Owner" };
  f.guest.accountId = user.id;
  f.host.stack = 700;
  f.guest.stack = 1300;
  const before = f.room.players.map((p) => [p.id, p.stack, p.buyin]);
  assert.equal(
    claimLegacyRooms(f.rooms, f.sessions, user, ["guest-token"]).hostRecovered
      .length,
    0,
  );
  const result = claimLegacyRooms(f.rooms, f.sessions, user, [
    "guest-token",
    "host-token",
  ]);
  assert.deepEqual(result.hostRecovered, [f.room.id]);
  assert.equal(f.room.host, f.guest.id);
  assert.equal(f.host.accountId, undefined);
  assert.deepEqual(
    f.room.players.map((p) => [p.id, p.stack, p.buyin]),
    before,
  );
  command(f.room, f.host.id, "rebuy", { amount: 500 });
  command(f.room, f.guest.id, "approve", { request: f.room.requests[0].id });
  assert.equal(f.host.stack, 1200);
  command(f.room, f.guest.id, "start");
  assert.equal(f.room.hand, 1);
  assert.equal(
    claimLegacyRooms(f.rooms, f.sessions, user, ["host-token"]).hostRecovered
      .length,
    0,
  );
});

test("admin binding recovers an unclaimed host; claimed hosts and duplicate seats remain protected", () => {
  const f = legacy(),
    user = { id: "user", nickname: "Owner" };
  f.guest.accountId = user.id;
  assert.equal(bindLegacyPlayer(f.room, user, f.host.id).hostRecovered, true);
  assert.equal(f.room.host, f.guest.id);
  assert.throws(
    () => recoverUnclaimedHost(f.room, { id: "other", nickname: "Other" }),
    { status: 409 },
  );
  assert.throws(() => bindLegacyPlayer(f.room, user, f.host.id), {
    status: 409,
  });
  const ended = legacy();
  ended.room.phase = "ended";
  assert.throws(() => recoverUnclaimedHost(ended.room, user), /已结束/);
});
