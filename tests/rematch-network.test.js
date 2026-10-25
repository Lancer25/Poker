import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, registerAt } from "./auth-helpers.js";
for (const count of [7, 9])
  test(
    `${count} authenticated players reopen same room with both modes and survive process recovery`,
    { timeout: 25000 },
    async (t) => {
      const directory = mkdtempSync(path.join(tmpdir(), "holdem-rematch-"));
      let child;
      const sockets = [];
      t.after(async () => {
        sockets.forEach((s) => s.terminate());
        if (child && child.exitCode === null) {
          const exit = once(child, "exit");
          child.kill();
          await exit;
        }
        assert.equal(path.dirname(directory), path.resolve(tmpdir()));
        rmSync(directory, { recursive: true, force: true });
      });
      const { invite } = await seedAccounts(directory);
      async function boot() {
        child = spawn(process.execPath, ["server/index.js"], {
          env: { ...process.env, PORT: "0", DATA_DIR: directory },
          stdio: ["ignore", "pipe", "pipe"],
        });
        child.stderr.on("data", (d) => t.diagnostic(d.toString()));
        return Number(
          (await once(child.stdout, "data"))[0]
            .toString()
            .match(/localhost:(\d+)/)[1],
        );
      }
      async function client(port, token) {
        const ws = new WebSocket("ws://127.0.0.1:" + port);
        sockets.push(ws);
        const p = {
          ws,
          token,
          state: null,
          queue: [],
          waiters: [],
          send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
          get(type) {
            const index = this.queue.findIndex((m) => m.type === type);
            if (index >= 0)
              return Promise.resolve(this.queue.splice(index, 1)[0]);
            return new Promise((resolve) =>
              this.waiters.push({ type, resolve }),
            );
          },
          clear() {
            this.queue = [];
          },
        };
        ws.on("message", (raw) => {
          const m = JSON.parse(raw);
          if (m.type === "state") p.state = m.room;
          const i = p.waiters.findIndex((w) => w.type === m.type);
          if (i >= 0) p.waiters.splice(i, 1)[0].resolve(m);
          else p.queue.push(m);
        });
        await once(ws, "open");
        p.send("authenticate", { token });
        await p.get("account");
        return p;
      }
      let port = await boot();
      const people = [];
      for (let i = 0; i < count; i++) {
        const user = await registerAt(
          port,
          invite.code,
          "rematch_" + i,
          "Player " + i,
        );
        people.push(await client(port, user.token));
      }
      const host = people[0];
      host.send("create", { chips: 1000, small: 5, big: 10 });
      await host.get("session");
      let r = (await host.get("state")).room;
      const roomId = r.id;
      for (const p of people.slice(1)) {
        p.send("join", { room: roomId });
        await p.get("session");
        await p.get("state");
      }
      async function synchronized(predicate) {
        const end = Date.now() + 4000;
        while (!people.every((p) => p.state && predicate(p.state))) {
          if (Date.now() > end)
            throw Error("Broadcast synchronization timeout");
          await delay(5);
        }
      }
      await synchronized((s) => s.players.length === count);
      const ids = host.state.players.map((p) => p.id);
      async function change(p, type, data = {}, response = "state") {
        p.clear();
        p.send(type, data);
        return p.get(response);
      }
      async function finish() {
        await change(host, "start");
        await synchronized((s) => s.phase === "preflop");
        while (!["showdown", "ended"].includes(host.state.phase)) {
          const actor = people.find(
            (p) => p.state.me === host.state.players[host.state.turn].id,
          );
          await change(actor, "fold");
          await synchronized(
            (s) => s.turn === host.state.turn && s.phase === host.state.phase,
          );
        }
        await change(host, "end");
        await synchronized((s) => s.phase === "ended");
      }
      await finish();
      const first = JSON.stringify(host.state.completedRounds[0]);
      assert.match(
        (await change(people[1], "restart", { round: 1 }, "error")).message,
        /房主/,
      );
      await change(host, "restart", { round: 1 });
      await synchronized((s) => s.roundNumber === 2 && s.phase === "waiting");
      assert.deepEqual(
        host.state.players.map((p) => p.id),
        ids,
      );
      assert.ok(host.state.players.every((p) => p.stack === 1000));
      assert.equal(host.state.completedRounds.length, 1);
      await finish();
      const balances = host.state.players.map((p) => p.stack);
      await change(host, "restart", { round: 2, chipMode: "carry" });
      await synchronized((s) => s.roundNumber === 3 && s.phase === "waiting");
      assert.deepEqual(
        host.state.players.map((p) => p.stack),
        balances,
      );
      assert.ok(host.state.results.every((p) => p.net === 0));
      assert.deepEqual(host.state.completedRounds.map(r=>r.number),[2]);
      assert.equal(JSON.stringify(JSON.parse(readFileSync(directory+'/rooms.json')).rooms.find(r=>r.id===roomId).completedRounds[0]),first);
      assert.ok(
        !JSON.stringify(host.state.completedRounds).includes('"cards"'),
      );
      await finish();
      sockets.forEach((s) => s.terminate());
      const stopped = once(child, "exit");
      child.kill();
      await stopped;
      port = await boot();
      const restored = await client(port, host.token);
      restored.send("resume", { room: roomId });
      const saved = (await restored.get("state")).room;
      assert.equal(saved.roundNumber, 3);
      assert.deepEqual(saved.completedRounds.map(r=>r.number),[2,3]);
      assert.deepEqual(
        saved.players.map((p) => p.id),
        ids,
      );
      const records=JSON.parse(readFileSync(directory+'/rooms.json')).rooms.find(r=>r.id===roomId).completedRounds;
      assert.equal(records.length,3);assert.equal(JSON.stringify(records[0]),first);
      const error = await change(restored, "restart", { round: 1 }, "error");
      assert.match(error.message, /场次/);
      const next = (await change(restored, "restart", { round: 3 })).room;
      assert.equal(next.id, roomId);
      assert.equal(next.roundNumber, 4);
      assert.ok(next.players.every((p) => p.stack === 1000));
    },
  );
