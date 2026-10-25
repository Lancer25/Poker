import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { WebSocket } from "./protocol-peer.js";
import {
  seedAccounts,
  registerAt,
  apiAt,
  testPassword,
} from "./auth-helpers.js";
import { createRoom, joinRoom, command } from "../server/game.js";

test(
  "real clients restore migrated host, approve/reject mid-hand, reconnect and continue three hands",
  { timeout: 20000 },
  async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "holdem-host-controls-"));
    const sockets = [];
    let child,
      port,
      peers = [];
    t.after(async () => {
      sockets.forEach((socket) => socket.terminate());
      if (child && child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
      assert.equal(path.dirname(directory), path.resolve(tmpdir()));
      rmSync(directory, { recursive: true, force: true });
    });
    const { admin, invite } = await seedAccounts(directory);
    const { room, player: originalHost } = createRoom("Old Host", 10, 5, 10);
    const migrated = joinRoom(room, "Admin Seat");
    migrated.accountId = admin.id;
    command(room, originalHost.id, "rebuy", { amount: 50 });
    const hostToken = randomBytes(32).toString("hex"),
      guestToken = randomBytes(32).toString("hex");
    writeFileSync(
      path.join(directory, "rooms.json"),
      JSON.stringify({
        rooms: [room],
        sessions: [
          [hostToken, { room: room.id, player: originalHost.id }],
          [guestToken, { room: room.id, player: migrated.id }],
        ],
      }),
    );
    async function boot() {
      child = spawn(process.execPath, ["server/index.js"], {
        env: { ...process.env, PORT: "0", DATA_DIR: directory },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [output] = await once(child.stdout, "data");
      port = Number(output.toString().match(/localhost:(\d+)/)[1]);
    }
    async function client(token) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      sockets.push(socket);
      const queue = [],
        waiting = [];
      const result = {
        socket,
        state: null,
        send: (type, data = {}) =>
          socket.send(JSON.stringify({ type, ...data })),
        clear: () => {
          queue.length = 0;
        },
        take(type) {
          const i = queue.findIndex((m) => m.type === type);
          if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
          return new Promise((resolve, reject) => {
            const waiter = {
              type,
              resolve: (m) => {
                clearTimeout(timer);
                resolve(m);
              },
            };
            const timer = setTimeout(() => {
              waiting.splice(waiting.indexOf(waiter), 1);
              reject(Error("No " + type));
            }, 5000);
            waiting.push(waiter);
          });
        },
      };
      socket.on("message", (raw) => {
        const m = JSON.parse(raw);
        if (m.type === "state") result.state = m.room;
        const i = waiting.findIndex((w) => w.type === m.type);
        if (i < 0) queue.push(m);
        else waiting.splice(i, 1)[0].resolve(m);
      });
      await once(socket, "open");
      result.send("authenticate", { token });
      await result.take("account");
      return result;
    }
    async function step(actor, type, data = {}) {
      peers.forEach((p) => p.clear());
      actor.send(type, data);
      const states = await Promise.all(peers.map((p) => p.take("state")));
      return states[0].room;
    }
    await boot();
    const adminLogin = (
      await apiAt(port, "/api/auth/login", "POST", {
        username: "admin",
        password: testPassword,
      })
    ).data;
    assert.deepEqual(
      (
        await apiAt(
          port,
          "/api/auth/claim",
          "POST",
          { tokens: [guestToken, hostToken] },
          adminLogin.token,
        )
      ).data.hostRecovered,
      [room.id],
    );
    let host = await client(adminLogin.token);
    host.send("resume", { token: hostToken });
    let state = (await host.take("state")).room;
    assert.equal(state.host, state.me);
    host.send("approve", { request: state.requests[0].id });
    await host.take("state");
    const bobLogin = await registerAt(port, invite.code, "bob", "Bob");
    assert.equal(
      (
        await apiAt(
          port,
          "/api/admin/recover-host",
          "POST",
          { room: room.id, userId: bobLogin.user.id },
          bobLogin.token,
        )
      ).status,
      403,
    );
    await apiAt(
      port,
      "/api/auth/claim",
      "POST",
      { tokens: [hostToken] },
      bobLogin.token,
    );
    let bob = await client(bobLogin.token);
    bob.send("resume", { room: room.id });
    await bob.take("state");
    peers = [host, bob];
    state = await step(host, "start");
    const originalBalances = state.results.map((p) => [p.buyin, p.stack]);
    state = await step(bob, "rebuy", { amount: 25 });
    await step(host, "reject", { request: state.requests[0].id });
    state = await step(bob, "rebuy", { amount: 100 });
    await step(host, "approve", { request: state.requests[0].id });
    state = await step(host, "rebuy", { amount: 100 });
    const request = state.requests.find((r) => r.player === state.host);
    state = await step(host, "approve", { request: request.id });
    assert.ok(state.requests.every((r) => r.status === "approved"));
    assert.deepEqual(
      state.results.map((p) => [p.buyin, p.stack]),
      originalBalances,
    );
    sockets.forEach((socket) => socket.terminate());
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
    await boot();
    host = await client(adminLogin.token);
    host.send("resume", { room: room.id });
    await host.take("state");
    bob = await client(bobLogin.token);
    bob.send("resume", { room: room.id });
    await bob.take("state");
    peers = [host, bob];
    assert.equal(host.state.host, host.state.me);
    assert.ok(host.state.requests.every((r) => r.status === "approved"));
    state = await step(bob, "call");
    assert.ok(state.flopReveal);
    while(state.flopReveal){const revealed=await Promise.all(peers.map(p=>p.take('state')));state=revealed[0].room;}
    assert.equal(state.phase, "showdown");
    assert.equal(state.requests.length, 0);
    assert.equal(
      state.results.reduce((n, p) => n + p.buyin, 0),
      270,
    );
    assert.equal(
      state.history[0].results.reduce((n, p) => n + p.buyin, 0),
      70,
    );
    for (let hand = 2; hand <= 3; hand++) {
      state = await step(host, "start");
      assert.equal(state.id, room.id);
      assert.equal(state.hand, hand);
      assert.equal(state.players.length, 2);
      const actor = state.players[state.turn].id === host.state.me ? host : bob;
      state = await step(actor, "fold");
      assert.equal(state.phase, "showdown");
      assert.equal(state.history.length, hand);
      assert.equal(
        state.results.reduce((n, p) => n + p.stack, 0),
        270,
      );
    }
  },
);
