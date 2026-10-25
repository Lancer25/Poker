import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, testPassword } from "./auth-helpers.js";
import { createRoom, joinRoom } from "../server/game.js";
import {initializeControls} from '../server/room-controls.js';
import {prepareSeating} from './game-helpers.js';

for(const mode of ['cash','friends'])test(
  `${mode}: authenticated god-mode visibility stays isolated and survives real reconnect/restart`,
  { timeout: 20000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "holdem-god-"));
    const { store, invite } = await seedAccounts(dir);
    const identities = [];
    for (let i = 0; i < 3; i++)
      identities.push(
        await store.register({
          username: "god_test_" + i,
          nickname: "Player " + i,
          password: testPassword,
          inviteCode: invite.code,
        }),
      );
    const { room } = createRoom("Host",undefined,undefined,undefined,undefined,mode);
    joinRoom(room, "Guest");
    joinRoom(room, "Observer");
    room.players.forEach((p, i) => (p.accountId = identities[i].user.id));
    room.players[2].stack = 0;
    if(mode==='friends'){
      room.players[2].eliminated=true;initializeControls(room);
      prepareSeating(room);room.seating.autoStartAt=null;
    }
    writeFileSync(
      path.join(dir, "rooms.json"),
      JSON.stringify({ rooms: [room], sessions: [] }),
    );
    let child, port;
    const sockets = [];
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
    async function boot() {
      child = spawn(process.execPath, ["server/index.js"], {
        env: { ...process.env, PORT: "0", DATA_DIR: dir },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const [output] = await once(child.stdout, "data");
      port = Number(output.toString().match(/localhost:(\d+)/)[1]);
    }
    async function client(index) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      sockets.push(ws);
      const queue = [],
        waiters = [];
      ws.on("message", (raw) => {
        const m = JSON.parse(raw);
        const i = waiters.findIndex((w) => w.type === m.type);
        if (i >= 0) waiters.splice(i, 1)[0].resolve(m);
        else queue.push(m);
      });
      const peer = {
        ws,
        send: (type, data = {}) => ws.send(JSON.stringify({ type, ...data })),
        take(type) {
          const i = queue.findIndex((m) => m.type === type);
          return i >= 0
            ? Promise.resolve(queue.splice(i, 1)[0])
            : new Promise((resolve) => waiters.push({ type, resolve }));
        },
      };
      await once(ws, "open");
      peer.send("authenticate", { token: identities[index].token });
      await peer.take("account");
      peer.send("resume", { room: room.id });
      peer.state = (await peer.take("state")).room;
      return peer;
    }
    await boot();
    let host = await client(0),
      guest = await client(1),
      observer = await client(2);
    // Each resume broadcasts to existing clients; drain those known updates.
    await host.take("state");
    await host.take("state");
    await guest.take("state");
    guest.send("godmode", { enabled: true, player: room.players[2].id });
    assert.match((await guest.take("error")).message, /筹码/);
    observer.send("godmode", { enabled: true });
    for (const peer of [host, guest, observer])
      assert.equal((await peer.take("state")).room.players[2].godMode, true);
    host.send("start");
    const ordinary = (await host.take("state")).room;
    await guest.take("state");
    const god = (await observer.take("state")).room;
    assert.equal(god.godMode, true);
    assert.ok(
      god.players
        .slice(0, 2)
        .every((p) => p.cards.length === 2 && !p.cards.includes("??")),
    );
    assert.deepEqual(ordinary.players[1].cards, ["??", "??"]);
    assert.deepEqual(god.board, []);
    assert.equal(god.deck, undefined);
    observer.send("allin");
    assert.match((await observer.take("error")).message, /轮到/);
    await stop();
    await boot();
    host = await client(0);
    observer = await client(2);
    await host.take("state");
    assert.equal(observer.state.godMode, true);
    observer.send("godmode", { enabled: false });
    await host.take("state");
    const masked = (await observer.take("state")).room;
    assert.deepEqual(masked.players[0].cards, ["??", "??"]);
  },
);
