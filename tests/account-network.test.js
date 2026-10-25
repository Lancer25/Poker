import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { WebSocket } from "./protocol-peer.js";
import { createRoom, joinRoom } from "../server/game.js";
import {
  seedAccounts,
  apiAt,
  registerAt,
  testPassword,
} from "./auth-helpers.js";

test(
  "account HTTP/WS: invite gate, admin permissions, legacy ownership and cross-device recovery",
  { timeout: 30000 },
  async (t) => {
    const directory = mkdtempSync(
      path.join(tmpdir(), "holdem-account-network-"),
    );
    const sockets = [];
    let child;
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
    const legacy = createRoom("Old Host");
    const oldGuest = joinRoom(legacy.room, "Old Guest");
    const hostLegacyToken = randomBytes(32).toString("hex"),
      guestLegacyToken = randomBytes(32).toString("hex");
    writeFileSync(
      path.join(directory, "rooms.json"),
      JSON.stringify({
        rooms: [legacy.room],
        sessions: [
          [hostLegacyToken, { room: legacy.room.id, player: legacy.player.id }],
          [guestLegacyToken, { room: legacy.room.id, player: oldGuest.id }],
        ],
      }),
    );
    async function boot() {
      child = spawn(process.execPath, ["server/index.js"], {
        env: { ...process.env, PORT: "0", DATA_DIR: directory },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [output] = await once(child.stdout, "data");
      return Number(output.toString().match(/localhost:(\d+)/)[1]);
    }
    let port = await boot();
    const api = (...args) => apiAt(port, ...args);
    async function client(token) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}`);
      sockets.push(socket);
      const queue = [],
        waiters = [];
      socket.on("message", (raw) => {
        const message = JSON.parse(raw);
        const index = waiters.findIndex((w) => w.type === message.type);
        if (index < 0) queue.push(message);
        else waiters.splice(index, 1)[0].resolve(message);
      });
      await once(socket, "open");
      const result = {
        socket,
        clear: () => {
          queue.length = 0;
        },
        send: (type, data = {}) =>
          socket.send(JSON.stringify({ type, ...data })),
        take(type) {
          const index = queue.findIndex((m) => m.type === type);
          if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
          return new Promise((resolve, reject) => {
            const waiter = {
              type,
              resolve: (message) => {
                clearTimeout(timer);
                resolve(message);
              },
            };
            const timer = setTimeout(() => {
              waiters.splice(waiters.indexOf(waiter), 1);
              reject(Error(`No ${type} response`));
            }, 5000);
            waiters.push(waiter);
          });
        },
      };
      if (token) {
        result.send("authenticate", { token });
        await result.take("account");
      }
      return result;
    }
    assert.equal(
      (
        await api("/api/auth/register", "POST", {
          username: "alice",
          nickname: "Alice",
          password: testPassword,
        })
      ).status,
      403,
    );
    const anonymous = await client();
    anonymous.send("create", { name: "Intruder" });
    assert.equal((await anonymous.take("error")).code, "auth_required");
    const alice = await registerAt(port, invite.code, "alice", "Alice");
    const bob = await registerAt(port, invite.code, "bob", "Bob");
    assert.equal(
      (
        await api("/api/auth/register", "POST", {
          username: "ALICE",
          nickname: "Fake",
          password: testPassword,
          inviteCode: invite.code,
        })
      ).status,
      409,
    );
    const adminLogin = await api("/api/auth/login", "POST", {
      username: "admin",
      password: testPassword,
    });
    assert.match(adminLogin.headers.get("set-cookie"), /HttpOnly/);
    assert.match(adminLogin.headers.get("set-cookie"), /SameSite=Strict/);
    const adminToken = adminLogin.data.token;
    assert.equal(
      (await api("/api/admin/state", "GET", undefined, alice.token)).status,
      403,
    );
    assert.equal(
      (
        await api(
          `/api/admin/users/${admin.id}`,
          "PATCH",
          { password: "Hijack123!" },
          bob.token,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await api("/api/admin/invites", "POST", { maxUses: 1 }, undefined, {
          Cookie: adminLogin.headers.get("set-cookie").split(";")[0],
          Origin: "https://untrusted.example",
        })
      ).status,
      403,
    );
    const single = (
      await api(
        "/api/admin/invites",
        "POST",
        { maxUses: 1, days: 1 },
        adminToken,
      )
    ).data.invite;
    const raced = await Promise.all(
      ["charlie", "delta"].map((username) =>
        api("/api/auth/register", "POST", {
          username,
          nickname: username,
          password: testPassword,
          inviteCode: single.code,
        }),
      ),
    );
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 403]);
    const a = await client(alice.token);
    a.send("create", {
      name: "Spoofed nickname",
      chips: 1000,
      small: 5,
      big: 10,
    });
    const roomToken = (await a.take("session")).token;
    const ownRoom = (await a.take("state")).room;
    assert.equal(ownRoom.players[0].name, "Alice");
    const switched = await client(alice.token);
    switched.send("resume", { token: roomToken });
    await switched.take("state");
    switched.send("authenticate", { token: bob.token });
    await switched.take("account");
    switched.send("start");
    assert.match((await switched.take("error")).message, /进入房间/);
    switched.send("resume", { token: roomToken });
    assert.equal((await switched.take("error")).code, "room_forbidden");
    switched.socket.terminate();
    const b = await client(bob.token);
    b.send("resume", { token: roomToken });
    assert.equal((await b.take("error")).code, "room_forbidden");
    b.send("archives", { tokens: [roomToken, hostLegacyToken] });
    assert.equal((await b.take("archives")).archive.length, 0);
    b.send("join", { room: ownRoom.id, name: "Fake" });
    await b.take("session");
    const joined = (await b.take("state")).room;
    assert.equal(joined.players[1].name, "Bob");
    const otherDevice = await client(bob.token);
    otherDevice.send("join", { room: ownRoom.id });
    await otherDevice.take("session");
    const recovered = (await otherDevice.take("state")).room;
    assert.equal(recovered.players.length, 2);
    assert.equal(recovered.me, joined.me);
    otherDevice.clear();
    otherDevice.send("resume", { token: roomToken });
    const aliased = (await otherDevice.take("state")).room;
    assert.equal(aliased.me, joined.me);
    assert.notEqual(aliased.me, ownRoom.me);
    assert.deepEqual(
      (
        await api(
          "/api/auth/claim",
          "POST",
          { tokens: [hostLegacyToken, guestLegacyToken] },
          alice.token,
        )
      ).data.claimed,
      [legacy.room.id],
    );
    assert.deepEqual(
      (
        await api(
          "/api/auth/claim",
          "POST",
          { tokens: [hostLegacyToken] },
          bob.token,
        )
      ).data.claimed,
      [],
    );
    assert.equal(
      (
        await api(
          "/api/admin/bind",
          "POST",
          { room: legacy.room.id, player: oldGuest.id, userId: bob.user.id },
          adminToken,
        )
      ).status,
      200,
    );
    const management = (
      await api("/api/admin/state", "GET", undefined, adminToken)
    ).data;
    assert.equal(management.legacy.length, 0);
    assert.ok(!JSON.stringify(management).includes("passwordHash"));
    a.send("archives");
    assert.equal((await a.take("archives")).archive.length, 2);
    const edit = await api(
      `/api/admin/users/${alice.user.id}`,
      "PATCH",
      {
        username: "alice_new",
        nickname: "New Alice",
        password: "NewFriends123!",
      },
      adminToken,
    );
    assert.equal(edit.status, 200);
    assert.equal((await a.take("error")).code, "auth_required");
    assert.equal(
      (await api("/api/auth/me", "GET", undefined, alice.token)).status,
      401,
    );
    assert.equal(
      (
        await api("/api/auth/login", "POST", {
          username: "alice",
          password: testPassword,
        })
      ).status,
      401,
    );
    const newLogin = (
      await api("/api/auth/login", "POST", {
        username: "alice_new",
        password: "NewFriends123!",
      })
    ).data;
    await api(
      `/api/admin/users/${bob.user.id}`,
      "PATCH",
      { disabled: true },
      adminToken,
    );
    assert.equal(
      (await api("/api/auth/me", "GET", undefined, bob.token)).status,
      401,
    );
    sockets.forEach((socket) => socket.terminate());
    const stopped = once(child, "exit");
    child.kill();
    await stopped;
    port = await boot();
    const persisted = await client(newLogin.token);
    persisted.send("resume", { room: ownRoom.id });
    const resumed = (await persisted.take("state")).room;
    assert.equal(resumed.me, ownRoom.me);
    assert.equal(resumed.players[0].name, "New Alice");
    persisted.send("archives");
    assert.equal((await persisted.take("archives")).archive.length, 2);
  },
);
