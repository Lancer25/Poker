import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, registerAt } from "./auth-helpers.js";

for (const count of [7, 9])
  test(
    `${count} authenticated tournament players: automatic next hand, restart, elimination, privacy and champion`,
    { timeout: 120000 },
    async (t) => {
      const dir = mkdtempSync(path.join(tmpdir(), "holdem-tournament-"));
      const { invite } = await seedAccounts(dir);
      let child, port;
      const sockets = [];
      async function boot() {
        child = spawn(
          process.execPath,
          [
            "--require",
            "./tests/fixtures/tournament-rng.cjs",
            "server/index.js",
          ],
          {
            env: { ...process.env, PORT: "0", DATA_DIR: dir },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        const [output] = await once(child.stdout, "data");
        port = Number(output.toString().match(/localhost:(\d+)/)[1]);
      }
      async function stop() {
        sockets.forEach((ws) => ws.terminate());
        if (child && child.exitCode === null) {
          const exit = once(child, "exit");
          child.kill();
          await exit;
        }
      }
      t.after(async () => {
        await stop();
        assert.equal(path.dirname(dir), path.resolve(tmpdir()));
        rmSync(dir, { recursive: true, force: true });
      });
      async function client(authToken) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        sockets.push(ws);
        const queue = [];
        const peer = {
          ws,
          authToken,
          state: null,
          send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
          async take(type) {
            const end = Date.now() + 10000;
            while (Date.now() < end) {
              const i = queue.findIndex((m) => m.type === type);
              if (i >= 0) return queue.splice(i, 1)[0];
              await delay(5);
            }
            throw Error("Missing message " + type);
          },
        };
        ws.on("message", (raw) => {
          const message = JSON.parse(raw);
          if (message.type === "state") peer.state = message.room;
          else queue.push(message);
        });
        await once(ws, "open");
        peer.send("authenticate", { token: authToken });
        await peer.take("account");
        return peer;
      }
      async function until(check, timeout = 12000) {
        const end = Date.now() + timeout;
        while (!check()) {
          if (Date.now() > end)
            throw Error("Tournament state did not progress");
          await delay(10);
        }
      }
      const signature = (r) =>
        JSON.stringify([
          r.phase,
          r.hand,
          r.turn,
          r.currentBet,
          r.players.map((p) => [p.stack, p.bet, p.folded]),
        ]);
      await boot();
      const tokens = [];
      for (let i = 0; i < count; i++)
        tokens.push(
          (await registerAt(port, invite.code, "tourney_" + i, "Player " + i))
            .token,
        );
      let peers = await Promise.all(tokens.map(client));
      peers[0].send("create", {
        gameMode: "turbo",
        chips: 1000,
        small: 5,
        big: 10,
      });
      await peers[0].take("session");
      await until(() => peers[0].state);
      const id = peers[0].state.id;
      for (const peer of peers.slice(1)) {
        peer.send("join", { room: id });
        await peer.take("session");
      }
      await until(() => peers.every((p) => p.state?.players.length === count));
      peers[0].send("start");
      await until(() => peers.every((p) => p.state.phase === "preflop"));
      async function step(type) {
        const room = peers[0].state;
        const actor = peers.find(
          (p) => p.state.me === room.players[room.turn].id,
        );
        const previous = signature(room);
        actor.send(type);
        await until(() => peers.every((p) => signature(p.state) !== previous));
        const reference = peers[0].state;
        for (const peer of peers) {
          assert.equal(signature(peer.state), signature(reference));
          if (!["showdown", "ended"].includes(peer.state.phase))
            for (const p of peer.state.players)
              if (p.id !== peer.state.me)
                assert.ok(p.cards.every((c) => c === "??"));
        }
        return reference;
      }
      while (peers[0].state.phase !== "showdown") await step("fold");
      const at = peers[0].state.tournament.nextHandAt;
      assert.ok(at > Date.now());
      await stop();
      await boot();
      peers = await Promise.all(tokens.map(client));
      for (const peer of peers) peer.send("resume", { room: id });
      await until(() => peers.every((p) => p.state?.id === id));
      await until(() => peers.every((p) => p.state.hand === 2), 10000);
      assert.ok(Date.now() >= at);
      peers[0].send("rebuy", { amount: 100 });
      assert.match((await peers[0].take("error")).message, /不能补充/);
      let hands = 0;
      while (peers[0].state.phase !== "ended") {
        assert.ok(hands++ < 100);
        const room = peers[0].state;
        if(room.flopReveal){await until(()=>peers.every(p=>!p.state.flopReveal));continue;}
        if (room.phase === "showdown") {
          const hand = room.hand;
          await until(
            () =>
              peers.every(
                (p) => p.state.hand > hand || p.state.phase === "ended",
              ),
            10000,
          );
          continue;
        }
        const actionable = room.players.filter(
          (p) => p.inHand && !p.folded && p.stack > 0,
        ).length;
        const updated = await step(actionable > 1 ? "allin" : "call");
        const bankroll =
          updated.players.reduce((s, p) => s + p.stack, 0) +
          (["showdown", "ended"].includes(updated.phase)
            ? 0
            : updated.players.reduce((s, p) => s + p.totalBet, 0));
        assert.equal(bankroll, count * 1000);
        const eliminated = peers.find(
          (p) => p.state.players.find((x) => x.id === p.state.me).eliminated,
        );
        if (eliminated && updated.phase !== "ended") {
          eliminated.send("godmode", { enabled: true });
          assert.match((await eliminated.take("error")).message, /不开放/);
        }
      }
      const finished = peers[0].state;
      assert.equal(finished.tournament.completed, true);
      assert.equal(finished.tournament.remaining, 1);
      assert.equal(finished.tournament.standings.length, count);
      assert.equal(
        finished.players.reduce((s, p) => s + p.stack, 0),
        count * 1000,
      );
      assert.ok(finished.tournament.championId);
      t.diagnostic(
        `${count} authenticated players completed ${finished.hand} hands with persisted tournament state`,
      );
    },
  );
