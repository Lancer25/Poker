import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, apiAt, testPassword } from "./auth-helpers.js";
import {createRoom,joinRoom,command} from '../server/game.js';
async function setup(t, env = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "holdem-lifecycle-"));
  const seeded = await seedAccounts(directory);
  let child, port;
  const sockets = [];
  async function boot() {
    child = spawn(process.execPath, ["server/index.js"], {
      env: {
        ...process.env,
        PORT: "0",
        DATA_DIR: directory,
        ROOM_IDLE_TIMEOUT_MS: "1800",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (d) => t.diagnostic(d.toString()));
    port = Number(
      (await once(child.stdout, "data"))[0]
        .toString()
        .match(/localhost:(\d+)/)[1],
    );
  }
  async function stop() {
    if (child && child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
  }
  t.after(async () => {
    sockets.forEach((s) => s.terminate());
    await stop();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  async function login() {
    return (
      await apiAt(port, "/api/auth/login", "POST", {
        username: "admin",
        password: testPassword,
      })
    ).data.token;
  }
  async function client(token, autoPong = true) {
    const ws = new WebSocket("ws://127.0.0.1:" + port, { autoPong });
    sockets.push(ws);
    const queue = [],
      waiters = [];
    ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      const i = waiters.findIndex((w) => w.type === m.type);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
      else queue.push(m);
    });
    ws.on("error", () => {});
    await once(ws, "open");
    const p = {
      ws,
      send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
      get(type) {
        const i = queue.findIndex((m) => m.type === type);
        if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
        return new Promise((resolve) => waiters.push({ type, resolve }));
      },
    };
    p.send("authenticate", { token });
    await p.get("account");
    return p;
  }
  async function status(token, id, predicate) {
    const end = Date.now() + 9000;
    while (Date.now() < end) {
      const response = await apiAt(
        port,
        "/api/admin/state",
        "GET",
        undefined,
        token,
      );
      assert.equal(response.status, 200);
      const room = response.data.rooms.find((r) => r.id === id);
      if (room && predicate(room)) return room;
      await delay(40);
    }
    throw Error("Room lifecycle status timeout");
  }
  return { ...seeded, directory, boot, stop, login, client, status };
}
test(
  "real duplicate tabs, leave, reconnect and persisted idle deadline automatically end and reopen",
  { timeout: 18000 },
  async (t) => {
    const s = await setup(t);
    await s.boot();
    const query = await s.login(),
      token = await s.login();
    let a = await s.client(token);
    a.send("create", { chips: 1000 });
    await a.get("session");
    const id = (await a.get("state")).room.id;
    const b = await s.client(token);
    b.send("resume", { room: id });
    await b.get("state");
    await s.status(
      query,
      id,
      (r) => r.onlineCount === 1 && r.status === "waiting",
    );
    a.send("leave");
    await a.get("left");
    await s.status(query, id, (r) => r.onlineCount === 1);
    b.ws.close();
    const offline = await s.status(
      query,
      id,
      (r) =>
        r.onlineCount === 0 &&
        r.status === "offline" &&
        Number.isFinite(r.idleDeadline),
    );
    assert.equal(offline.idleDeadline - offline.idleSince, 1800);
    a.send("resume", { room: id });
    const active = (await a.get("state")).room;
    assert.equal(active.onlineCount, 1);
    assert.equal(active.idleSince, null);
    a.send("leave");
    await a.get("left");
    const idle = await s.status(query, id, (r) => r.status === "offline");
    await s.stop();
    await delay(500);
    await s.boot();
    const saved = await s.status(
      query,
      id,
      (r) => r.status === "offline" || r.status === "ended",
    );
    assert.equal(saved.idleSince, idle.idleSince);
    const ended = await s.status(query, id, (r) => r.status === "ended");
    assert.equal(ended.endReason, "idle");
    a = await s.client(token);
    a.send("resume", { room: id });
    const closed = (await a.get("state")).room;
    assert.equal(closed.completedRounds[0].endReason, "idle");
    a.send("restart", { round: 1 });
    const reopened = (await a.get("state")).room;
    assert.equal(reopened.phase, "waiting");
    assert.equal(reopened.roundNumber, 2);
    assert.equal(reopened.onlineCount, 1);
    assert.equal(reopened.idleDeadline, null);
  },
);
test(
  "a socket that does not pong is removed from online membership",
  { timeout: 12000 },
  async (t) => {
    const s = await setup(t, {
      ROOM_HEARTBEAT_INTERVAL_MS: "100",
      ROOM_HEARTBEAT_TIMEOUT_MS: "600",
    });
    await s.boot();
    const query = await s.login(),
      token = await s.login();
    const p = await s.client(token, false);
    p.send("create", { chips: 1000 });
    await p.get("session");
    const id = (await p.get("state")).room.id;
    const closed = once(p.ws, "close");
    await s.status(query, id, (r) => r.onlineCount === 1);
    await s.status(
      query,
      id,
      (r) => r.onlineCount === 0 && r.status === "offline",
    );
    await closed;
    assert.equal(p.ws.readyState, WebSocket.CLOSED);
  },
);
test(
  "offline tournament never deals another hand and an active ordinary hand settles before idle close",
  { timeout: 16000 },
  async (t) => {
    const s = await setup(t, { ROOM_IDLE_TIMEOUT_MS: "1000" });
    const { room: cash } = createRoom("Host", 1000);
    joinRoom(cash, "Guest");
    cash.players[0].accountId = s.admin.id;
    startHand(cash, cash.host, Date.now() - 54000);
    const deadline = cash.deadline;
    const { room: tour } = createRoom("Host", 1000, 5, 10, 60, "standard");
    joinRoom(tour, "Guest");
    tour.players[0].accountId = s.admin.id;
    startHand(tour, tour.host);
    command(tour, tour.players[tour.turn].id, "fold");
    tour.tournament.nextHandAt = Date.now() - 1000;
    writeFileSync(
      s.directory + "/rooms.json",
      JSON.stringify({ rooms: [cash, tour], sessions: [] }),
    );
    await s.boot();
    const query = await s.login();
    await s.status(query, cash.id, (r) => r.status === "ending");
    assert.equal(
      JSON.parse(readFileSync(s.directory + "/rooms.json")).rooms.find(
        (r) => r.id === cash.id,
      ).deadline,
      deadline,
    );
    await s.status(query, tour.id, (r) => r.status === "ended");
    const before = JSON.parse(
      readFileSync(s.directory + "/rooms.json"),
    ).rooms.find((r) => r.id === tour.id);
    assert.equal(before.hand, 1);
    await s.status(query, cash.id, (r) => r.status === "ended");
    const after = JSON.parse(
      readFileSync(s.directory + "/rooms.json"),
    ).rooms.find((r) => r.id === cash.id);
    assert.equal(
      after.players.reduce((n, p) => n + p.stack, 0),
      2000,
    );
    assert.equal(after.history.length, 1);
    assert.equal(after.completedRounds[0].endReason, "idle");
  },
);

test("friends recover old showdown once across restart and only auto-deal with a room member online", {timeout:16000}, async t=>{
  const s=await setup(t,{ROOM_IDLE_TIMEOUT_MS:'12000'});
  const {room}=createRoom('Host',undefined,undefined,undefined,60,'friends');
  joinRoom(room,'Guest');room.players[0].accountId=s.admin.id;
  startHand(room,room.host);command(room,room.players[room.turn].id,'fold');
  room.tournament.nextHandAt=null;
  writeFileSync(s.directory+'/rooms.json',JSON.stringify({rooms:[room],sessions:[]}));
  await s.boot();const token=await s.login();
  await s.status(token,room.id,r=>r.onlineCount===0);
  const saved=()=>JSON.parse(readFileSync(s.directory+'/rooms.json')).rooms[0];
  const deadline=saved().tournament.nextHandAt;
  assert.ok(Number.isFinite(deadline));
  await delay(Math.max(0,deadline-Date.now()+300));
  assert.equal(saved().hand,1);
  await s.stop();await s.boot();
  assert.equal(saved().tournament.nextHandAt,deadline);
  await delay(300);assert.equal(saved().hand,1);
  const p=await s.client(token);p.send('resume',{room:room.id});
  let state=(await p.get('state')).room;
  while(state.hand!==2)state=(await p.get('state')).room;
  assert.equal(state.phase,'preflop');assert.equal(state.onlineCount,1);
  assert.equal(state.history.length,1);assert.equal(state.tournament.nextHandAt,null);
  await delay(300);assert.equal(saved().hand,2);
});
