import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import vm from "node:vm";
import { WebSocket } from "./protocol-peer.js";
import { seedAccounts, testPassword } from "./auth-helpers.js";

test(
  "mini program auth bridges real HTTP and WS: invite required, register, create and logout",
  { timeout: 15000 },
  async (t) => {
    const directory = mkdtempSync(path.join(tmpdir(), "holdem-mini-auth-"));
    const sockets = [];
    let child, page;
    t.after(async () => {
      page?.onUnload();
      sockets.forEach((socket) => socket.terminate());
      if (child && child.exitCode === null) {
        const stopped = once(child, "exit");
        child.kill();
        await stopped;
      }
      assert.equal(path.dirname(directory), path.resolve(tmpdir()));
      rmSync(directory, { recursive: true, force: true });
    });
    const { invite } = await seedAccounts(directory);
    child = spawn(process.execPath, ["server/index.js"], {
      env: { ...process.env, PORT: "0", DATA_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr.on("data", (data) => t.diagnostic(data.toString()));
    const [output] = await once(child.stdout, "data");
    const port = Number(output.toString().match(/localhost:(\d+)/)[1]);
    const storage = new Map();
    const wx = {
      getStorageSync: (key) => storage.get(key),
      setStorageSync: (key, value) => storage.set(key, value),
      removeStorageSync: (key) => storage.delete(key),
      showToast() {},
      request(options) {
        fetch(options.url, {
          method: options.method,
          headers: options.header,
          body:
            options.data === undefined
              ? undefined
              : JSON.stringify(options.data),
        })
          .then(async (response) =>
            options.success({
              statusCode: response.status,
              data: await response.json(),
            }),
          )
          .catch((error) => {
            t.diagnostic(
              `Mock wx.request transport: ${error.cause?.code || error.message}`,
            );
            options.fail(error);
          });
      },
      connectSocket() {
        const raw = new WebSocket(`ws://127.0.0.1:${port}`);
        sockets.push(raw);
        return {
          onOpen: (f) => raw.on("open", f),
          onMessage: (f) =>
            raw.on("message", (data) => f({ data: data.toString() })),
          onClose: (f) => raw.on("close", f),
          onError: (f) => raw.on("error", f),
          send: ({ data }) => raw.send(data),
          close: () => raw.close(),
        };
      },
    };
    vm.runInNewContext(
      readFileSync("miniprogram/pages/table/table.js", "utf8"),
      {
        wx,
        require: (name) => {
          const context = {
            module: { exports: {} },
            wx,
            getApp: () => ({
              globalData: { apiUrl: `http://127.0.0.1:${port}` },
            }),
          };
          vm.runInNewContext(
            readFileSync(
              "miniprogram/utils/"+path.basename(name),
              "utf8",
            ),
            context,
          );
          return context.module.exports;
        },
        getApp: () => ({
          globalData: {
            apiUrl: `http://127.0.0.1:${port}`,
            socketUrl: `ws://127.0.0.1:${port}`,
          },
        }),
        Page: (definition) => {
          page = {
            ...definition,
            data: structuredClone(definition.data),
            setData(patch) {
              Object.assign(this.data, patch);
            },
          };
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
      },
    );
    async function until(check) {
      const deadline = Date.now() + 5000;
      while (!check()) {
        if (Date.now() > deadline)
          throw Error("Mini program state did not update");
        await delay(10);
      }
    }
    page.onLoad({});
    page.gameModeChange({ detail: { value: "1" } });
    assert.equal(page.data.gameMode, "standard");
    assert.equal(page.data.chips, "5000");
    assert.equal(page.data.small, "25");
    page.gameModeChange({ detail: { value: "0" } });
    assert.equal(page.data.chips, "10000");
    assert.equal(page.data.gameMode, "friends");
    assert.equal(sockets.length, 0);
    page.setData({
      authMode: "register",
      authUsername: "mini_player",
      authNickname: "Mini Player",
      authPassword: testPassword,
    });
    await page.submitAuth();
    assert.match(page.data.authError, /邀请码/);
    assert.ok(!storage.has("holdem-account-token"));
    page.setData({ authInvite: invite.code });
    await page.submitAuth();
    await until(() => page.data.connected);
    assert.equal(page.data.user.username, "mini_player");
    assert.equal(page.data.authPassword, "");
    page.setData({ turnSeconds: "30" });
    page.enter();
    await until(() => Boolean(page.data.room));
    assert.equal(page.data.room.players[0].name, "Mini Player");
    assert.equal(page.data.room.players.length, 1);
    assert.equal(page.data.room.turnSeconds, 30);
    assert.equal(page.data.room.gameMode, "friends");
    assert.equal(page.data.room.small, 10);
    assert.equal(page.data.room.big, 20);
    assert.equal(page.data.seats.length, 1);
    assert.equal(page.data.seats[0].mine, true);
    assert.equal(page.data.myCards.length, 2);
    assert.equal(page.data.myCards[0].back, true);
    page.toggleHints({ detail: { value: false } });
    assert.equal(page.data.hintsEnabled, false);
    assert.equal(storage.get("holdem-hand-insights"), "off");
    page.toggleHints({ detail: { value: true } });
    page.toggleHintDetails();
    assert.equal(page.data.hintExpanded, true);
    page.switchPanel({ currentTarget: { dataset: { panel: "chips" } } });
    assert.equal(page.data.activePanel, "chips");
    page.switchPanel({ currentTarget: { dataset: { panel: "invalid" } } });
    assert.equal(page.data.activePanel, "chips");
    page.switchPanel({ currentTarget: { dataset: { panel: "activity" } } });
    const roomId = page.data.room.id;
    // Synthetic render fixtures exercise legacy full snapshots below.
    const originalRoom = { ...page.data.room, transportVersion: undefined, stateVersion: undefined };
    const serverTime = Date.now() - 3600000;
    page.renderRoom({
      ...originalRoom,
      turn: 0,
      phase: "preflop",
      serverTime,
      deadline: serverTime + 10000,
    });
    assert.equal(page.data.clockSeconds, 10);
    assert.equal(page.data.clockUrgent, true);
    page.renderRoom({
      ...originalRoom,
      turn: 0,
      phase: "preflop",
      serverTime,
      deadline: serverTime + 60000,
    });
    assert.equal(page.data.clockSeconds, 60);
    assert.equal(page.data.clockUrgent, false);
    page.renderRoom(originalRoom);
    const eventPlayers = [
      { ...originalRoom.players[0], stack: 0, eliminated: true, place: 3 },
      {
        ...originalRoom.players[0],
        id: "live-one",
        name: "Live One",
        stack: 5000,
        eliminated: false,
      },
      {
        ...originalRoom.players[0],
        id: "live-two",
        name: "Live Two",
        stack: 5000,
        eliminated: false,
      },
    ];
    page.renderRoom({
      ...originalRoom,
      gameMode: "standard",
      players: eventPlayers,
      turn: 1,
      smallBlind: 1,
      bigBlind: 2,
      tournament: {
        started: true,
        completed: false,
        cancelled: false,
        level: 1,
        scheduledLevel: 1,
        nextHandAt: Date.now() + 6000,
        nextLevelAt: Date.now() + 600000,
        standings: [],
      },
    });
    assert.equal(page.data.seats.length, 2);
    assert.equal(page.data.seats.find((seat) => seat.smallBlind).key, 1);
    assert.equal(page.data.seats.find((seat) => seat.active).key, 1);
    assert.match(page.data.turnNotice, /已淘汰/);
    assert.match(page.data.nextHandClock, /下一手/);
    page.renderRoom(originalRoom);
    assert.equal(page.data.clockSeconds, null);
    for (const count of [2, 3, 5, 7, 9]) {
      const players = Array.from({ length: count }, (_, index) => ({
        ...originalRoom.players[0],
        id: "seat-" + index,
        totalBet: 123,
        name: "Player " + index,
      }));
      page.renderRoom({
        ...originalRoom,
        players,
        me: players[count - 1].id,
        dealer: 0,
        smallBlind: 0,
        bigBlind: 1,
        turn: 1,
      });
      assert.equal(page.data.seats.length, count);
      assert.equal(page.data.seats[0].totalBet, 123);
      assert.equal(page.data.seats[0].mine, true);
      assert.equal(page.data.seats.find((seat) => seat.dealer).key, 0);
      assert.equal(page.data.seats.find((seat) => seat.smallBlind).key, 0);
      assert.equal(page.data.seats.find((seat) => seat.bigBlind).key, 1);
      assert.equal(page.data.seats.find((seat) => seat.active).key, 1);
    }
    page.renderRoom(originalRoom);
    page.switchPanel({ currentTarget: { dataset: { panel: "history" } } });
    const sampleHistory = [
      { hand: 1, board: [], pots: [], results: [] },
      { hand: 2, board: ["Ts", "Jh", "Qc"], pots: [], results: [] },
      { hand: 3, pots: [], results: [] },
    ];
    page.renderRoom({ ...originalRoom, history: sampleHistory });
    assert.equal(page.data.history[0].boardCards.length, 0);
    assert.match(page.data.history[0].boardNote, /翻牌前结束/);
    assert.equal(page.data.history[1].boardCards.length, 3);
    assert.equal(page.data.history[1].boardCards[0].rank, "10");
    assert.match(page.data.history[2].boardNote, /旧记录未保存/);
    assert.equal(sampleHistory[1].board[0], "Ts");
    page.renderRoom(originalRoom);
    page.renderRoom({
      ...originalRoom,
      godMode: true,
      canGodMode: true,
      players: [
        { ...originalRoom.players[0], stack: 0 },
        {
          ...originalRoom.players[0],
          id: "god-guest",
          name: "Guest",
          cards: ["As", "Kh"],
        },
      ],
    });
    assert.equal(page.data.godHands.length, 1);
    assert.equal(page.data.godHands[0].cards[0].rank, "A");
    assert.equal(page.data.godHands[0].cards[0].back, false);
    assert.match(page.data.turnNotice, /仅旁观/);
    const originalSend = page.send;
    let payload;
    page.send = (type, data) => (payload = { type, ...data });
    page.toggleGodMode();
    assert.equal(payload.type, "godmode");
    assert.equal(payload.enabled, false);
    page.send = originalSend;
    page.renderRoom(originalRoom);
    assert.equal(page.data.godHands.length, 0);
    page.back();
    await until(() => page.data.archive.length === 1);
    page.openArchive({ currentTarget: { dataset: { room: roomId } } });
    await until(() => Boolean(page.data.room));
    assert.equal(page.data.room.players.length, 1);
    await page.logout();
    assert.equal(page.data.user, null);
    assert.equal(page.data.connected, false);
    assert.ok(!storage.has("holdem-account-token"));
  },
);
