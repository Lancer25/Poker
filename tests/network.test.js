import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, registerAt } from "./auth-helpers.js";
test(
  "real server: join, private cards, host approval, reconnect and durable history",
  { timeout: 20000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "holdem-test-"));
    let child;
    const sockets = [];
    let invite;
    let counter = 0;
    async function boot() {
      child = spawn(process.execPath, ["server/index.js"], {
        env: { ...process.env, PORT: "0", DATA_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const output = await once(child.stdout, "data");
      return Number(output[0].toString().match(/localhost:(\d+)/)[1]);
    }
    async function client(port, authToken) {
      if (!authToken)
        authToken = (
          await registerAt(
            port,
            invite.code,
            `player_${++counter}`,
            counter === 1 ? "Host" : "Guest",
          )
        ).token;
      const ws = new WebSocket("ws://localhost:" + port);
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
      const result = {
        ws,
        authToken,
        send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
        get(type) {
          const i = queue.findIndex((m) => m.type === type);
          if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
          return new Promise((resolve) => waiters.push({ type, resolve }));
        },
        clear() {
          queue.length = 0;
        },
      };
      result.send("authenticate", { token: authToken });
      await result.get("account");
      return result;
    }
    try {
      ({ invite } = await seedAccounts(dir));
      let port = await boot();
      const host = await client(port);
      host.send("create", {
        name: "Host",
        chips: 1000,
        small: 5,
        big: 10,
        turnSeconds: 30,
      });
      const token = (await host.get("session")).token;
      let state = (await host.get("state")).room;
      const guest = await client(port);
      guest.send("join", { room: state.id, name: "Guest" });
      const guestToken = (await guest.get("session")).token;
      await guest.get("state");
      await host.get("state");
      host.send("start");
      state = (await host.get("state")).room;
      const view = (await guest.get("state")).room;
      assert.deepEqual(view.players[0].cards, ["??", "??"]);
      assert.equal(state.turn, 0);
      assert.equal(state.turnSeconds, 30);
      assert.ok(
        state.deadline - state.serverTime <= 30000 &&
          state.deadline - state.serverTime > 29000,
      );
      guest.send("check");
      assert.match((await guest.get("error")).message, /轮到/);
      host.send("fold");
      state = (await host.get("state")).room;
      await guest.get("state");
      assert.equal(state.phase, "showdown");
      assert.equal(state.history.length, 1);
      guest.send("rebuy", { amount: 500 });
      state = (await host.get("state")).room;
      await guest.get("state");
      host.send("approve", { request: state.requests[0].id });
      state = (await host.get("state")).room;
      await guest.get("state");
      assert.equal(state.results[1].buyin, 1500);
      host.send("end");
      state = (await host.get("state")).room;
      await guest.get("state");
      assert.equal(state.phase, "ended");
      host.send("archives", { tokens: [token, guestToken, "invalid"] });
      const archive = await host.get("archives");
      assert.equal(archive.archive.length, 1);
      assert.equal(archive.archive[0].phase, "ended");
      assert.equal(archive.archive[0].token, token);
      host.send("archives", { tokens: [guestToken, token] });
      assert.equal((await host.get("archives")).archive[0].token, token);
      host.send("leave");
      await host.get("left");
      host.send("start");
      assert.match((await host.get("error")).message, /进入房间/);
      sockets.forEach((s) => s.terminate());
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
      port = await boot();
      const resumed = await client(port, host.authToken);
      resumed.send("resume", { token });
      const restored = (await resumed.get("state")).room;
      assert.equal(restored.phase, "ended");
      assert.equal(restored.turnSeconds, 30);
      assert.equal(restored.history.length, 1);
      assert.equal(restored.results[1].buyin, 1500);
    } finally {
      sockets.forEach((s) => s.terminate());
      if (child && child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
      assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
      assert.ok(path.basename(dir).startsWith("holdem-test-"));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
