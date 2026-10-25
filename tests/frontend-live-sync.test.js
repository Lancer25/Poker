import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";

const helperSource = readFileSync("miniprogram/utils/room-history.js", "utf8");
const helper = { module: { exports: {} } };
vm.runInNewContext(helperSource, helper);
const { HistoryCache, LiveMetrics } = helper.module.exports;
const hand = (number) => ({ hand: number, board: ["Ah", "9c", "4d"], pots: [], results: [] });
const compact = (extra = {}) => ({ id: "r", roundNumber: 2, transportVersion: 2, historyVersion: "2:600:1", historyCount: 600, completedRoundCount: 1, ...extra });
const summaries = [{ number: 1, hand: 600, results: [{ id: "a", name: "A", buyin: 100, stack: 200, net: 100 }], finishedAt: 1000, gameMode: "friends" }];
function response(request, extra = {}) {
  return { roomId: request.context.roomId, version: request.context.version, currentRound: request.context.round, roundNumber: request.round, offset: request.offset, limit: 50, total: 600,
    hands: Array.from({ length: 50 }, (_, i) => hand(600 - request.offset - i)), rounds: summaries, ...extra };
}

test("history helper exports the same API as a web global and native module", () => {
  const browser = {};
  vm.runInNewContext(helperSource, browser);
  assert.equal(typeof browser.RoomHistory.HistoryCache, "function");
  assert.equal(typeof HistoryCache, "function");
});
test("600-hand histories page lazily, deduplicate by hand and restore ascending old arrays", () => {
  const cache = new HistoryCache();
  const restored = cache.sync("a", compact());
  assert.equal(restored.history.length, 0);
  assert.equal(cache.entry().loading, false);
  let request = cache.begin();
  assert.match(cache.url(request), /round=current&offset=0&limit=50$/);
  assert.equal(cache.begin(), null);
  cache.accept(request, response(request));
  request = cache.begin("current", true);
  assert.equal(request.offset, 50);
  cache.accept(request, response(request, { hands: [hand(550), hand(551)] }));
  assert.equal(cache.entry().hands.length, 51);
  assert.equal(cache.entry().hands[0].hand, 550);
  assert.equal(cache.begin(), null);
  request = cache.begin("1");
  cache.accept(request, response(request));
  assert.equal(cache.restore(compact()).completedRounds[0].history.length, 50);
  assert.equal(cache.restore(compact()).completedRounds[0].gameMode, "friends");
});
test("append preserves immutable archives and older current pages while shifting next offset", () => {
  const cache = new HistoryCache();
  cache.sync("a", compact());
  for (const [selected, more] of [["current", false], ["current", true], ["1", false], ["1", true]]) {
    const request = cache.begin(selected, more);
    cache.accept(request, response(request));
  }
  const archived = cache.entry("1").hands, current = cache.entry().hands;
  const stale = cache.begin("current", true);
  cache.sync("a", compact({ historyVersion: "2:601:1", historyCount: 601 }));
  assert.equal(cache.entry("1").hands, archived);
  assert.equal(cache.entry().hands, current);
  assert.equal(cache.begin("1"), null);
  assert.equal(cache.accept(stale, response(stale)), false);
  const request = cache.begin();
  assert.equal(request.offset, 0);
  cache.accept(request, response(request, { total: 601, hands: Array.from({ length: 50 }, (_, i) => hand(601 - i)) }));
  assert.equal(cache.entry().hands.length, 101);
  assert.equal(cache.entry().hands[0].hand, 501);
  assert.equal(cache.begin("current", true).offset, 101);
});
test("large appends retain hands but page through the uncovered gap", () => {
  const cache = new HistoryCache();
  cache.sync("a", compact());
  const first = cache.begin();
  cache.accept(first, response(first));
  cache.sync("a", compact({ historyVersion: "2:700:1", historyCount: 700 }));
  const newest = cache.begin();
  cache.accept(newest, response(newest, { total: 700, hands: Array.from({ length: 50 }, (_, i) => hand(700 - i)) }));
  assert.equal(cache.entry().hands.length, 100);
  assert.equal(cache.begin("current", true).offset, 50);
});
test("account/room/round generations reject slow pages, rematches retain only the immediately previous cache", () => {
  const cache = new HistoryCache();
  cache.sync("a", compact());
  const old = cache.begin("1");
  cache.accept(old, response(old));
  const previous = cache.entry().hands;
  const stale = cache.begin();
  cache.sync("a", compact({ roundNumber: 3, historyVersion: "3:0:2", historyCount: 0, completedRoundCount: 2 }));
  assert.equal(cache.entry().hands.length, 0);
  assert.equal(cache.entries.has(1), false);
  assert.equal(cache.entry("2").hands, previous);
  assert.equal(cache.accept(stale, response(stale)), false);
  for (const [account, room] of [["b", compact()], ["b", compact({ id: "other" })], ["b", compact()]]) {
    const request = cache.begin();
    cache.sync(account, room);
    assert.equal(cache.accept(request, response(request)), false);
    assert.equal(cache.entry().hands.length, 0);
  }
});
test("failed pages require explicit retry and mismatched versions cannot replace hands", () => {
  const cache = new HistoryCache();
  cache.sync("a", compact());
  let request = cache.begin();
  cache.fail(request, "offline");
  assert.equal(cache.begin(), null);
  request = cache.begin("current", false, true);
  cache.accept(request, response(request, { version: "2:601:1" }));
  assert.equal(cache.entry().hands.length, 0);
  assert.ok(cache.entry().error);
  request = cache.begin("current", false, true);
  cache.accept(request, response(request));
  request = cache.begin("current", true);
  cache.fail(request, "offline");
  assert.equal(cache.entry().hands.length, 50);
  assert.equal(cache.begin("current", true), null);
  request = cache.begin("current", true, true);
  assert.equal(request.offset, 50);
  cache.accept(request, response(request));
  assert.equal(cache.entry().hands.length, 100);
});
test("legacy full snapshots retain public board and archived round selection without HTTP", () => {
  const cache = new HistoryCache(), room = { id: "r", roundNumber: 2, history: [hand(2)], completedRounds: [{ ...summaries[0], history: [hand(1)] }] };
  assert.equal(cache.sync("a", room), room);
  assert.equal(cache.begin(), null);
  assert.equal(cache.entry("1").hands[0].hand, 1);
});
test("telemetry matches echoes, bounds both fields and samples at most once per 15 seconds", () => {
  const metrics = new LiveMetrics();
  metrics.rendered(50000);
  metrics.ping(1000);
  assert.equal(metrics.receive({ echo: "1000" }, 1100), null);
  let sample = metrics.receive({ echo: 1000 }, 1100);
  assert.equal(sample.rttMs, 100);
  assert.equal(sample.renderMs, 30000);
  metrics.ping(2000);
  assert.equal(metrics.receive({ echo: 2000 }, 2100), null);
  metrics.rendered(12);
  metrics.ping(16000);
  sample = metrics.receive({ echo: 16000 }, 16100);
  assert.equal(sample.renderMs, 12);
  metrics.ping(17000);
  assert.equal(metrics.receive({ echo: 17000 }, 200000), null);
});

function nativeHarness() {
  let page;
  const requests = [], patches = [], storage = new Map([["holdem-account-token", "token-a"]]);
  const wx = { getStorageSync: (key) => storage.get(key), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: (k) => storage.delete(k), request: (request) => requests.push(request), showToast() {} };
  const getApp = () => ({ globalData: { apiUrl: "https://example.test" } });
  const context = { wx, getApp, require(name) {
    const c = { module: { exports: {} }, wx, getApp };
    vm.runInNewContext(readFileSync("miniprogram/utils/" + path.basename(name), "utf8"), c);
    return c.module.exports;
  }, Page(definition) {
    page = { ...definition, data: structuredClone(definition.data), setData(patch, callback) { patches.push(patch); Object.assign(this.data, patch); callback?.(); } };
  }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(readFileSync("miniprogram/pages/table/table.js", "utf8"), context);
  page.data.user = { id: "a" };
  return { page, requests, patches, storage };
}
function tableRoom(extra = {}) {
  return { ...compact(), me: "a", host: "a", phase: "waiting", hand: 600, turn: -1, serverTime: 1000, initial: 10000, currentBet: 20, minRaise: 20, toCall: 0, canRaise: false,
    players: [{ id: "a", name: "A", stack: 10000, bet: 0, cards: [], totalBet: 0 }], board: [], pots: [], requests: [], results: [], log: [], ...extra };
}
const panelEvent = (panel) => ({ currentTarget: { dataset: { panel } } });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function answer(request, extra = {}) {
  const url = new URL(request.url);
  const selected = url.searchParams.get("round"), offset = Number(url.searchParams.get("offset"));
  request.success({ statusCode: 200, data: { roomId: "r", version: "2:600:1", currentRound: 2, roundNumber: selected === "current" ? 2 : Number(selected), offset, limit: 50, total: 600,
    hands: Array.from({ length: 50 }, (_, i) => hand(600 - offset - i)), rounds: summaries, ...extra } });
}
test("native compact entry makes no history request and repeated hidden snapshots transfer no heavy histories", () => {
  const { page, requests, patches } = nativeHarness();
  page.renderRoom(tableRoom());
  assert.equal(requests.length, 0);
  patches.length = 0;
  for (let i = 0; i < 30; i++) page.renderRoom(tableRoom({ serverTime: 1001 + i }));
  assert.equal(requests.length, 0);
  assert.equal(patches.some((p) => "history" in p || "previousRounds" in p), false);
  assert.equal(patches.every((p) => !p.room || p.room.history.length === 0 && p.room.completedRounds.length === 0), true);
});
test("native history opens lazily, paginates, retries and avoids unchanged/hidden retransfers", async () => {
  const { page, requests, patches } = nativeHarness();
  page.renderRoom(tableRoom());
  page.switchPanel(panelEvent("history"));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].header.Authorization, "Bearer token-a");
  answer(requests[0]); await flush();
  assert.equal(page.data.history.length, 50);
  assert.equal(page.data.previousRounds[0].history, undefined);
  patches.length = 0;
  page.renderRoom(tableRoom({ serverTime: 1002 }));
  assert.equal(patches.some((p) => "history" in p || "previousRounds" in p), false);
  assert.equal(requests.length, 1);
  page.loadOlderHistory();
  requests[1].fail(); await flush();
  assert.ok(page.data.historyError);
  page.renderRoom(tableRoom({ serverTime: 1003 }));
  assert.equal(requests.length, 2);
  page.retryHistory();
  assert.match(requests[2].url, /offset=50&limit=50/);
  answer(requests[2]); await flush();
  assert.equal(page.data.history.length, 100);
  page.switchPanel(panelEvent("activity")); patches.length = 0;
  page.renderRoom(tableRoom({ historyVersion: "2:601:1", historyCount: 601, serverTime: 1004 }));
  assert.equal(requests.length, 3);
  assert.equal(patches.some((p) => "history" in p), false);
  page.switchPanel(panelEvent("history"));
  assert.equal(page.data.history.length, 100);
  answer(requests[3], { version: "2:601:1", total: 601, hands: Array.from({ length: 50 }, (_, i) => hand(601 - i)) }); await flush();
  assert.equal(page.data.history.length, 101);
  page.loadOlderHistory();
  assert.match(requests[4].url, /offset=101&limit=50/);
});
test("native selected archive pages cannot overwrite another round or logged-out account", async () => {
  const { page, requests } = nativeHarness();
  page.renderRoom(tableRoom()); page.switchPanel(panelEvent("history"));
  answer(requests[0]); await flush();
  page.historyRoundChange({ detail: { value: "1" } });
  assert.match(requests[1].url, /round=1&offset=0/);
  page.historyRoundChange({ detail: { value: "0" } });
  answer(requests[1], { hands: [hand(10)] }); await flush();
  assert.equal(page.data.history.length, 50);
  page.historyRoundChange({ detail: { value: "1" } });
  assert.equal(requests.length, 2);
  assert.equal(page.data.history[0].hand, 10);
  page.loadOlderHistory();
  page.showLogin();
  answer(requests[2]); await flush();
  assert.equal(page.data.history.length, 0);
  assert.equal(page.data.previousRounds.length, 0);
});

function webHarness() {
  const nodes = new Map(), requests = [];
  function node() { return { dataset: {}, children: [], hidden: false, textContent: "", replacements: 0, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; this.replacements++; } }; }
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  $("panel-history").hidden = true;
  $("panel-results").hidden = true;
  const cache = new HistoryCache();
  const context = vm.createContext({ $, historyCache: cache, state: cache.sync("a", compact()), currentUser: { id: "a" }, historyRound: "current", historyRoomKey: "", selectPanel() {}, cards() {},
    document: { hidden: false, createElement: node, addEventListener() {} }, Option: function (text, value) { return { text, value }; },
    api(url) { return new Promise((resolve, reject) => requests.push({ url, resolve, reject })); } });
  const source = readFileSync("public/app.js", "utf8");
  vm.runInContext(source.slice(source.indexOf("function displayedHistory("), source.indexOf("function renderBetControls(")), context);
  return { context, $, requests, cache };
}
test("web 600-hand history loads only when opened, keeps expanded records and unchanged DOM", async () => {
  const { context, $, requests, cache } = webHarness();
  context.renderHistoryPanel();
  assert.equal(requests.length, 0);
  $("panel-history").hidden = false; context.renderHistoryPanel();
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /round=current&offset=0&limit=50/);
  requests[0].resolve(response({ context: cache.context, round: 2, offset: 0 })); await flush();
  assert.equal($("history").children.length, 50);
  const built = $("history").replacements;
  $("history").children[0].open = true;
  for (let i = 0; i < 30; i++) context.renderHistoryPanel();
  assert.equal($("history").replacements, built);
  $("historyMore").onclick();
  requests[1].resolve(response({ context: cache.context, round: 2, offset: 50 })); await flush();
  assert.equal($("history").children.length, 100);
  assert.equal($("history").children[0].open, true);
  $("panel-history").hidden = true;
  context.state = cache.sync("a", compact({ historyVersion: "2:601:1", historyCount: 601 }));
  context.renderHistoryPanel();
  assert.equal(requests.length, 2);
  $("panel-history").hidden = false; context.renderHistoryPanel();
  requests[2].resolve(response({ context: cache.context, round: 2, offset: 0 }, { total: 601, hands: Array.from({ length: 50 }, (_, i) => hand(601 - i)) })); await flush();
  assert.equal($("history").children.length, 101);
  assert.equal($("history").children.find((n) => n.dataset.hand === "600").open, true);
});
test("web selection, retry and stale version responses preserve the visible round", async () => {
  const { context, $, requests, cache } = webHarness();
  $("panel-history").hidden = false; context.renderHistoryPanel();
  requests[0].reject(Error("offline")); await flush();
  assert.equal($("historyRetry").hidden, false);
  context.renderHistoryPanel(); assert.equal(requests.length, 1);
  $("historyRetry").onclick();
  requests[1].resolve(response({ context: cache.context, round: 2, offset: 0 })); await flush();
  $("historyRoundSelect").value = "1"; $("historyRoundSelect").onchange();
  const old = { context: cache.context, round: 1, offset: 0 };
  context.state = cache.sync("a", compact({ historyVersion: "2:601:1", historyCount: 601 }));
  context.renderHistoryPanel();
  requests[2].resolve(response(old, { hands: [hand(10)] })); await flush();
  assert.equal($("history").children.length, 0);
  requests[3].resolve(response({ context: cache.context, round: 1, offset: 0 }, { hands: [hand(20)] })); await flush();
  assert.equal($("history").children[0].dataset.hand, "20");
});
test('web drops hidden record DOM and selections on rematch while retaining only the previous cache',async()=>{
 const {context,$,cache,requests}=webHarness();
 $("panel-history").hidden=false;context.renderHistoryPanel();requests[0].resolve(response({context:cache.context,round:2,offset:0}));await flush();
 assert.equal($("history").children.length,50);$("panel-history").hidden=true;$("completedRounds").append({old:true});
 context.state=cache.sync('a',compact({roundNumber:3,previousRoundNumber:2,historyVersion:'3:0:2',historyCount:0,completedRoundCount:2}));context.renderRoundRecords(context.state);
 assert.equal($("history").children.length,0);assert.equal($("completedRounds").children.length,0);assert.equal(cache.entries.has(1),false);assert.ok(cache.entries.size<=2);
});
test('web hand detail renders explicit shown winners only, preserving lazy history and legacy/empty states',async()=>{
 const {context,$,cache,requests}=webHarness();context.cards=(node,cards)=>{node.values=cards;};$("panel-history").hidden=false;context.renderHistoryPanel();
 const shown={id:'winner',name:'Shown',cards:['As','Ad'],won:300,handLabel:'一对'};
 requests[0].resolve(response({context:cache.context,round:2,offset:0},{total:3,hands:[{...hand(600),shownWinners:[shown]},{...hand(599),shownWinners:[]},hand(598)]}));await flush();
 const rows=$("history").children,winners=rows[0].children.find(n=>n.className==='history-winners');assert.equal(winners.children.length,1);assert.equal(winners.children[0].dataset.winner,'winner');assert.deepEqual(winners.children[0].children[1].values,['As','Ad']);assert.match(winners.children[0].children[2].textContent,/一对/);
 assert.ok(rows[1].children.some(n=>n.textContent==='本手无公开亮牌记录'));assert.ok(rows[2].children.some(n=>n.textContent==='旧记录未保存亮牌'));
 const count=$("history").replacements;context.renderHistoryPanel();assert.equal($("history").replacements,count);assert.equal(requests.length,1);
});
