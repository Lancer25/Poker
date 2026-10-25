import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "./protocol-peer.js";
import {
  seedAccounts,
  registerAt,
  apiAt,
  testPassword,
} from "./auth-helpers.js";
async function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "holdem-history-"));
  const { invite } = await seedAccounts(dir);
  const sockets = [];
  const child = spawn(process.execPath, ["server/index.js"], {
    env: { ...process.env, PORT: "0", DATA_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => t.diagnostic(d.toString()));
  t.after(async () => {
    sockets.forEach((s) => s.terminate());
    if (child.exitCode === null) {
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
    }
    assert.equal(path.dirname(dir), path.resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  });
  const port = Number(
    (await once(child.stdout, "data"))[0]
      .toString()
      .match(/localhost:(\d+)/)[1],
  );
  const owner = await registerAt(port, invite.code, "history_owner", "Owner");
  const admin = (
    await apiAt(port, "/api/auth/login", "POST", {
      username: "admin",
      password: testPassword,
    })
  ).data;
  async function client(token) {
    const ws = new WebSocket("ws://127.0.0.1:" + port);
    sockets.push(ws);
    const queue = [],
      waiters = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      const i = waiters.findIndex((w) => w.type === m.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
      else queue.push(m);
    });
    await once(ws, "open");
    const p = {
      ws,
      get(type) {
        const i = queue.findIndex((m) => m.type === type);
        if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((resolve) => waiters.push({ type, resolve }));
      },
      async send(type, data = {}) {
        await delay(65);
        ws.send(JSON.stringify({ type, ...data }));
      },
    };
    await p.send("authenticate", { token });
    await p.get("account");
    return p;
  }
  async function closedRooms(p, count) {
    const list = [];
    for (let i = 0; i < count; i++) {
      await p.send("create", { chips: 1000 });
      const token = (await p.get("session")).token;
      const state = (await p.get("state")).room;
      await p.send("end");
      await p.get("state");
      list.push({ id: state.id, token });
      await p.send("leave");
      await p.get("left");
    }
    return list;
  }
  return { dir, port, invite, owner, admin, client, closedRooms };
}
test(
  "five-room cap, room/token/join bypass denial, full admin history and immutable readonly HTTP",
  { timeout: 18000 },
  async (t) => {
    const s = await setup(t),
      p = await s.client(s.owner.token),
      list = await s.closedRooms(p, 7);
    await p.send("archives");
    const own = (await p.get("archives")).archive;
    assert.equal(own.length, 5);
    assert.deepEqual(
      own.map((r) => r.id),
      list
        .slice(-5)
        .reverse()
        .map((r) => r.id),
    );
    for (const [type, data] of [
      ["resume", { room: list[0].id }],
      ["resume", { token: list[0].token }],
      ["join", { room: list[0].id }],
    ]) {
      await p.send(type, data);
      assert.equal((await p.get("error")).code, "room_forbidden");
    }
    assert.equal(
      (
        await apiAt(
          s.port,
          "/api/admin/rooms/" + list[0].id + "/history",
          "GET",
          undefined,
          s.owner.token,
        )
      ).status,
      403,
    );
    const before = readFileSync(s.dir + "/rooms.json", "utf8");
    assert.equal((await apiAt(s.port,'/api/rooms/'+list[0].id+'/history','GET',undefined,s.owner.token)).status,403);
    assert.equal((await apiAt(s.port,'/api/rooms/'+list.at(-1).id+'/history','GET',undefined,s.owner.token)).status,200);
    assert.equal((await apiAt(s.port,'/api/rooms/'+list[0].id+'/history','GET',undefined,s.admin.token)).status,200);
    assert.equal(readFileSync(s.dir+'/rooms.json','utf8'),before);
    const detail = await apiAt(
      s.port,
      "/api/admin/rooms/" + list[0].id + "/history",
      "GET",
      undefined,
      s.admin.token,
    );
    assert.equal(detail.status, 200);
    assert.equal(detail.data.rounds.length, 1);
    for (const key of ['"cards"', '"deck"', '"accountId"', '"requests"'])
      assert.equal(JSON.stringify(detail.data).includes(key), false);
    assert.equal(readFileSync(s.dir + "/rooms.json", "utf8"), before);
    assert.equal(
      (
        await apiAt(
          s.port,
          "/api/admin/rooms/000000/history",
          "GET",
          undefined,
          s.admin.token,
        )
      ).status,
      404,
    );
    const root = await s.client(s.admin.token);
    await s.closedRooms(root, 7);
    await root.send("archives");
    assert.equal((await root.get("archives")).archive.length, 7);
    const records = JSON.parse(readFileSync(s.dir + "/rooms.json"));
    assert.equal(records.rooms.length, 14);
  },
);
test(
  "an older active room remains playable outside the five visible room list",
  { timeout: 15000 },
  async (t) => {
    const s = await setup(t),
      active = await s.client(s.owner.token);
    await active.send("create", { chips: 1000 });
    await active.get("session");
    const id = (await active.get("state")).room.id;
    const friend = await registerAt(
        s.port,
        s.invite.code,
        "history_friend",
        "Friend",
      ),
      guest = await s.client(friend.token);
    await guest.send("join", { room: id });
    await guest.get("session");
    await guest.get("state");
    await active.get("state");
    await active.send("start");
    const hand = (await active.get("state")).room;
    await guest.get("state");
    assert.equal(hand.turn, 0);
    const other = await s.client(s.owner.token);
    await s.closedRooms(other, 6);
    await other.send("archives");
    assert.equal(
      (await other.get("archives")).archive.some((r) => r.id === id),
      false,
    );
    await active.send("call");
    const continued = (await active.get("state")).room;
    assert.equal(continued.id, id);
    assert.equal(continued.phase, "preflop");
    assert.equal(continued.players[0].folded, false);
  },
);
