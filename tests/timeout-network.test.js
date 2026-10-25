import {startHand} from './game-helpers.js';
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, testPassword } from "./auth-helpers.js";
import {createRoom,joinRoom,command} from '../server/game.js';
test(
  "server automatically folds a checkable player without a client decision",
  { timeout: 15000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "holdem-timeout-"));
    const { admin, invite, store } = await seedAccounts(dir);
    const guest = await store.register({
      username: "timeout_guest",
      nickname: "Guest",
      password: testPassword,
      inviteCode: invite.code,
    });
    const { room, player } = createRoom("Host");
    player.accountId = admin.id;
    const other = joinRoom(room, "Guest");
    other.accountId = guest.user.id;
    startHand(room, player.id);
    command(room, player.id, "call");
    assert.equal(room.turn, 1);
    assert.equal(other.bet, room.currentBet);
    room.deadline = Date.now() + 5000;
    writeFileSync(
      path.join(dir, "rooms.json"),
      JSON.stringify({ rooms: [room], sessions: [] }),
    );
    const child = spawn(process.execPath, ["server/index.js"], {
      env: { ...process.env, PORT: "0", DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let ws;
    t.after(async () => {
      ws?.terminate();
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
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const queue = [],
      waits = [];
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw);
      const i = waits.findIndex((w) => w.type === msg.type);
      if (i < 0) queue.push(msg);
      else waits.splice(i, 1)[0].resolve(msg);
    });
    const take = (type) => {
      const i = queue.findIndex((m) => m.type === type);
      return i >= 0
        ? Promise.resolve(queue.splice(i, 1)[0])
        : new Promise((resolve) => waits.push({ type, resolve }));
    };
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "authenticate", token: guest.token }));
    await take("account");
    ws.send(JSON.stringify({ type: "resume", room: room.id }));
    const before = (await take("state")).room;
    assert.equal(before.toCall, 0);
    assert.equal(before.phase, "preflop");
    const after = (await take("state")).room;
    assert.equal(after.players[1].folded, true);
    assert.equal(after.phase, "showdown");
    assert.equal(after.deadline, null);
    assert.match(after.log.at(-1), /超时自动弃牌/);
    ws.send(JSON.stringify({ type: "check" }));
    assert.match((await take("error")).message, /轮到/);
  },
);
