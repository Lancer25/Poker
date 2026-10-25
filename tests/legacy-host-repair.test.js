import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedAccounts } from "./auth-helpers.js";
import { createRoom, joinRoom, command } from "../server/game.js";

test("one-time legacy repair preserves balances, requests and backups and is idempotent", async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), "holdem-host-repair-"));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  const { admin } = await seedAccounts(directory);
  const a = createRoom("Old A").room;
  joinRoom(a, "Admin Seat").accountId = admin.id;
  const b = createRoom("Old B").room;
  const guest = joinRoom(b, "Guest");
  command(b, guest.id, "rebuy", { amount: 500 });
  const untouched = createRoom("Unrelated").room;
  const owned = createRoom("Existing Owner").room;
  owned.players[0].accountId = "another-account";
  const original = { rooms: [a, b, untouched, owned], sessions: [] };
  const file = path.join(directory, "rooms.json"),
    backup = path.join(directory, "backup");
  writeFileSync(file, JSON.stringify(original));
  const initialAccounts = readFileSync(
    path.join(directory, "accounts.json"),
    "utf8",
  );
  function run(apply) {
    const child = spawnSync(
      process.execPath,
      ["server/repair-legacy-hosts.js", backup, ...(apply ? ["--apply"] : [])],
      { env: { ...process.env, DATA_DIR: directory }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout);
  }
  assert.deepEqual(run(false).repairedRooms, [a.id, b.id]);
  assert.equal(readFileSync(file, "utf8"), JSON.stringify(original));
  assert.deepEqual(run(true).repairedRooms, [a.id, b.id]);
  const repaired = JSON.parse(readFileSync(file));
  assert.equal(repaired.rooms[0].host, a.players[1].id);
  assert.equal(repaired.rooms[0].players.length, 2);
  assert.equal(repaired.rooms[1].players[0].accountId, admin.id);
  assert.deepEqual(repaired.rooms[1].requests, original.rooms[1].requests);
  assert.deepEqual(
    repaired.rooms.map((r) => r.players.map((p) => [p.stack, p.buyin])),
    original.rooms.map((r) => r.players.map((p) => [p.stack, p.buyin])),
  );
  assert.deepEqual(repaired.rooms.slice(2), original.rooms.slice(2));
  assert.equal(
    readFileSync(path.join(backup, "rooms.json"), "utf8"),
    JSON.stringify(original),
  );
  assert.equal(
    readFileSync(path.join(backup, "accounts.json"), "utf8"),
    initialAccounts,
  );
  assert.deepEqual(run(true).repairedRooms, []);
});
