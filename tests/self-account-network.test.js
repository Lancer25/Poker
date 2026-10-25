import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "./protocol-peer.js";
import sharp from "sharp";
import {
  seedAccounts,
  registerAt,
  apiAt,
  testPassword,
} from "./auth-helpers.js";
test(
  "self-service HTTP protects permissions, updates live names and preserves room ownership on relogin",
  { timeout: 20000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "holdem-self-net-"));
    const { invite } = await seedAccounts(dir);
    const child = spawn(process.execPath, ["server/index.js"], {
      env: { ...process.env, PORT: "0", DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let socket;
    t.after(async () => {
      socket?.terminate();
      if (child.exitCode === null) {
        const exit = once(child, "exit");
        child.kill();
        await exit;
      }
      assert.equal(path.dirname(dir), path.resolve(tmpdir()));
      rmSync(dir, { recursive: true, force: true });
    });
    const [output] = await once(child.stdout, "data");
    const port = Number(output.toString().match(/localhost:(\d+)/)[1]);
    const member = await registerAt(
      port,
      invite.code,
      "profile_player",
      "Player",
    );
    const endpoint = "/api/account/profile";
    assert.equal(
      (await apiAt(port, endpoint, "PATCH", { nickname: "X" })).status,
      401,
    );
    assert.equal(
      (await apiAt(port, endpoint, "PATCH", { role: "admin" }, member.token))
        .status,
      400,
    );
    assert.equal(
      (
        await apiAt(port, endpoint, "PATCH", { nickname: "X" }, member.token, {
          Origin: "https://evil.example",
        })
      ).status,
      403,
    );
    assert.equal(
      (await apiAt(port, "/api/admin/state", "GET", undefined, member.token))
        .status,
      403,
    );
    async function connect(token) {
      socket = new WebSocket(`ws://127.0.0.1:${port}`);
      const queue = [],
        waits = [];
      socket.on("message", (raw) => {
        const msg = JSON.parse(raw);
        const i = waits.findIndex((w) => w.type === msg.type);
        if (i < 0) queue.push(msg);
        else waits.splice(i, 1)[0].resolve(msg);
      });
      const peer = {
        send: (type, data = {}) =>
          socket.send(JSON.stringify({ type, ...data })),
        take(type) {
          const i = queue.findIndex((m) => m.type === type);
          return i >= 0
            ? Promise.resolve(queue.splice(i, 1)[0])
            : new Promise((resolve) => waits.push({ type, resolve }));
        },
      };
      await once(socket, "open");
      peer.send("authenticate", { token });
      await peer.take("account");
      return peer;
    }
    let peer = await connect(member.token);
    peer.send("create", { chips: 1000, small: 5, big: 10 });
    await peer.take("session");
    const before = (await peer.take("state")).room;
    const result = await apiAt(
      port,
      endpoint,
      "PATCH",
      { nickname: "Updated" },
      member.token,
    );
    assert.equal(result.status, 200);
    assert.equal(result.data.reauthenticate, false);
    assert.equal((await peer.take("state")).room.players[0].name, "Updated");
    assert.equal((await peer.take("account")).user.nickname, "Updated");
    const photo = await sharp({
      create: { width: 80, height: 120, channels: 3, background: "#c78f61" },
    })
      .jpeg()
      .toBuffer();
    const uploaded = await apiAt(
      port,
      endpoint,
      "PATCH",
      { avatar: "data:image/jpeg;base64," + photo.toString("base64") },
      member.token,
    );
    assert.equal(uploaded.status, 200);
    assert.equal(uploaded.data.reauthenticate, false);
    assert.equal(
      (await peer.take("state")).room.players[0].avatar,
      uploaded.data.user.avatar,
    );
    assert.equal(
      (await peer.take("account")).user.avatar,
      uploaded.data.user.avatar,
    );
    const imageResponse = await fetch(
      `http://127.0.0.1:${port}${uploaded.data.user.avatar}`,
    );
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(
      (await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata())
        .width,
      256,
    );
    assert.equal(
      (
        await apiAt(
          port,
          endpoint,
          "PATCH",
          { avatar: "https://evil.example/photo.png" },
          member.token,
        )
      ).status,
      400,
    );
    const closed = once(socket, "close");
    const changed = await apiAt(
      port,
      endpoint,
      "PATCH",
      {
        username: "updated_player",
        currentPassword: testPassword,
        newPassword: "ChangedFriends123!",
      },
      member.token,
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.data.reauthenticate, true);
    assert.match(changed.headers.get("set-cookie"), /Max-Age=0/);
    await closed;
    assert.equal(
      (await apiAt(port, "/api/auth/me", "GET", undefined, member.token))
        .status,
      401,
    );
    const login = await apiAt(port, "/api/auth/login", "POST", {
      username: "updated_player",
      password: "ChangedFriends123!",
    });
    peer = await connect(login.data.token);
    peer.send("resume", { room: before.id });
    const after = (await peer.take("state")).room;
    assert.equal(after.me, before.me);
    assert.equal(after.host, before.host);
    assert.equal(after.players[0].stack, 1000);
    assert.equal(after.players[0].buyin, 1000);
  },
);
