import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync("public/app.js", "utf8");
function section(start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}
function harness() {
  const nodes = new Map(), sent = [], errors = [];
  const node = () => ({
    value: "", dataset: {}, children: [], hidden: false,
    style: { setProperty() {} },
    classList: {toggle() {}},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute(key, value) { this[key] = value; },
    getAttribute(key) { return this[key]; },
  });
  const $ = (id) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const shared = {};
  const roomUI={
    openRaise(key,submit){this.key=key;this.submit=submit;},
    closeRaise(){this.submit=null;},showRaiseError(text){errors.push(text);},
    refreshRaise(available,key){if(!available||this.key!==key)this.submit=null;},
  };
  vm.runInNewContext(readFileSync("miniprogram/utils/table-experience.js", "utf8"), shared);
  const context = vm.createContext({
    $, roomUI, state: null, connected: true, pendingAction: null, mode: "create",
    clockServerAtReceipt: 0, clockReceivedAt: 0,
    performance: { now: () => 0 },
    ...shared.TableExperience,
    document: {
      createElement: node,
      querySelector: () => node(),
      querySelectorAll: (selector) => {
        if (selector === "#controls button") return $("controls").children;
        if (selector === "#betPresets button") return $("betPresets").children;
        return [];
      },
    },
    button: (text, action, data, disabled) => ({ ...node(), textContent: text, dataset: { action }, disabled }),
    send: (type, data = {}) => sent.push({ type, ...data }),setWatchIntent(){},
    toast: (text) => errors.push(text), selectPanel() {},
  });
  vm.runInContext(section('function setBetLabel(button,text)', 'function button('),context);
  vm.runInContext(section("function renderBetControls(r)", "function selectPanel("), context);
  vm.runInContext(section('let previousGameMode = "friends"', 'const back = $("back")'), context);
  const render = (r) => { context.state = r; context.renderBetControls(r); };
  const confirmRaise=()=>{assert.equal(typeof roomUI.submit,'function');roomUI.submit();};
  return { context, $, sent, errors, render, confirmRaise };
}
function room(gameMode = "friends") {
  return {
    id: "r", me: "a", host: "a", hand: 1, phase: "flop", turn: 0,
    gameMode, currentBet: 300, minRaise: 300, toCall: 300, canRaise: true,
    pot: 1200, deadline: 60000, initial: 10000,
    players: [{ id: "a", name: "A", bet: 0, stack: 5000 }, { id: "b", name: "B", bet: 300, stack: 4700 }],
  };
}

test("web preserves raw invalid input on blur and snapshots in all game modes", () => {
  for (const mode of ["friends", "standard", "turbo", "cash"]) {
    for (const value of ["", "599", "5001", "600.5", "-10", "abc", "1e3", "0x400"]) {
      const { $, sent, errors, render,confirmRaise } = harness(), r = room(mode);
      render(r);
      $("betAmount").value = value;
      $("betAmount").oninput();
      $("betAmount").onblur?.();
      render({ ...r, log: ["unrelated update"] });
      assert.equal($("betAmount").value, value);
      $("controls").children.find((b) => b.dataset.action === "raise").onclick();
      assert.equal(errors.length,0);confirmRaise();
      assert.equal(sent.length, 0, `${mode}: ${value}`);
      assert.equal(errors.length, 1);
      assert.equal($("betAmount").value, value);
      render({ ...r, deadline: 61000 });
      assert.equal(Number($("betAmount").value), 600);
    }
  }
});

test('new-room web rejects odd manual raises and uses a five-chip slider without altering the input',()=>{
 const {$,sent,errors,render,confirmRaise}=harness(),r={...room(),chipUnit:5};render(r);
 assert.equal($('betSlider').step,5);assert.equal($('betAmount').step,5);
 $('betAmount').value='1051';$('controls').children.find(b=>b.dataset.action==='raise').onclick();confirmRaise();
 assert.equal(sent.length,0);assert.equal($('betAmount').value,'1051');assert.match(errors.at(-1),/5/);
 $('betAmount').value='1055';confirmRaise();assert.equal(sent[0].amount,1055);
});
test("web submits exact raise-to amounts and keeps sliders and presets usable", () => {
  for (const value of ["1051", "5000"]) {
    const { $, sent, render,confirmRaise } = harness();
    render(room());
    $("betAmount").value = value;
    $("betAmount").onblur?.();
    $("controls").children.find((b) => b.dataset.action === "raise").onclick();
    assert.equal(sent.length,0);confirmRaise();
    assert.equal(sent[0].amount, Number(value));
    assert.equal(sent[0].type, value === "5000" ? "allin" : "raise");
    $("betSlider").value = "1067";
    $("betSlider").oninput();
    assert.equal($("betAmount").value, "1067");
    $("betPresets").children.find((b) => b.dataset.preset === "half").onclick();
    assert.equal(Number($("betAmount").value), 1050);
  }
});

test('raise confirmation stays open for unrelated updates and closes on pending or changed decisions',()=>{
 const {context,$,render}=harness(),r=room();render(r);
 $('controls').children.find(b=>b.dataset.action==='raise').onclick();
 assert.equal(typeof context.roomUI.submit,'function');
 render({...r,log:['other update']});assert.equal(typeof context.roomUI.submit,'function');
 context.pendingAction={key:context.decisionKey(r)};context.refreshBetControls();assert.equal(context.roomUI.submit,null);
 context.pendingAction=null;render(r);$('controls').children.find(b=>b.dataset.action==='raise').onclick();
 render({...r,deadline:r.deadline+1000});assert.equal(context.roomUI.submit,null);
});

test('bet labels separate numeric values accessibly and stepper buttons respect bounds and pending actions',()=>{
 const {$,context,render}=harness();const r={...room(),big:20};render(r);
 $('betAmount').value='1051';$('betAmount').oninput();const raise=$('controls').children.find(b=>b.dataset.action==='raise');
 assert.equal(raise['aria-label'],'加注 1,051');assert.equal(raise.children[0].children[0].textContent,'加注');assert.equal(raise.children[0].children[1].textContent,'1,051');
 $('betIncrease').onclick();assert.equal(Number($('betAmount').value),1101);$('betDecrease').onclick();assert.equal(Number($('betAmount').value),1051);
 $('betAmount').value='5000';$('betIncrease').onclick();assert.equal(Number($('betAmount').value),5000);
 context.pendingAction={key:context.decisionKey(r)};context.refreshBetControls();assert.equal($('betIncrease').disabled,true);$('betIncrease').onclick();assert.equal(Number($('betAmount').value),5000);
});

test("web friends displays scheduled continuation without blind clocks or ante", () => {
  const { context, $ } = harness();
  const r = { ...room(), phase: "showdown", turn: -1, tournament: {
    speed: "friends", started: true, level: 1, remaining: 2, entrants: 3,
    levelDurationSeconds: 0, nextLevelAt: null, nextHandAt: 3000, ante: 0,
    nextLevel: { small: 20, big: 40, ante: 0 }, standings: [],
  } };
  context.state = r;
  context.renderTournament();
  assert.equal($("tournamentTitle").textContent, "好友淘汰局");
  assert.equal($("levelClock").hidden, true);
  assert.equal($("levelClock").textContent, "");
  assert.equal($("nextHandClock").textContent, "下一手 3");
  context.clockServerAtReceipt=1000;context.updateTournamentClocks();
  assert.equal($("nextHandClock").textContent, "下一手 2");
  context.clockServerAtReceipt=3000;context.updateTournamentClocks();
  assert.equal($("nextHandClock").textContent, "下一手 0");
  r.onlineCount=0;context.updateTournamentClocks();
  assert.equal($("nextHandClock").textContent, "暂停 · 等待玩家回桌");
  r.onlineCount=1;context.clockServerAtReceipt=0;
  assert.equal($("nextLevelBlinds").textContent, "下次淘汰后盲注 20/40");
  assert.doesNotMatch($("tournamentProgress").textContent, /底注/);
  assert.doesNotMatch($("eventRules").textContent, /分钟/);
  r.tournament.pendingLevel = { small: 40, big: 80, ante: 0 };
  context.renderTournament();
  assert.equal($("nextLevelBlinds").textContent, "下一手盲注 40/80");
  r.gameMode = "standard";
  r.tournament.nextLevelAt = 60000;
  r.tournament.nextHandAt = 5000;
  context.renderTournament();
  assert.equal($("levelClock").hidden, false);
  assert.equal($("levelClock").textContent, "下级 01:00");
  assert.equal($("nextHandClock").textContent, "下一手 00:05");
});

test("web friends host controls expose only first hand; legacy cash remains manual", () => {
  const { context, $ } = harness();
  const controls = section('  const h = $("hostControls");', '  if (r.host === r.me && r.phase === "ended")');
  for (const [gameMode, tournament, phase, expected] of [
    ["friends", { started: true }, "showdown", false],
    ["friends", { started: false }, "waiting", true],
    ["friends", { started: true }, "flop", false],
    ["standard", { started: true }, "showdown", false],
    ["turbo", { started: true }, "showdown", false],
    ["cash", null, "showdown", true],
    ["friends", { completed: true }, "ended", false],
  ]) {
    context.r = { ...room(gameMode), tournament, phase };
    vm.runInContext(`{${controls}}`, context);
    const start = $("hostControls").children.find((b) => b.dataset.action === "start");
    assert.equal(!!start, expected, `${gameMode}: ${phase}`);
    if (start) assert.equal(start.textContent, "开始下一手");
  }
});

test("web timed friends uses the server clock, pending blinds and three-second continuation", () => {
  const { context, $ } = harness();
  const r = { ...room(), phase: "showdown", tournament: {
    blindPolicy: "timed", levelDurationSeconds: 120, started: true,
    level: 1, scheduledLevel: 1, remaining: 2, entrants: 3, standings: [],
    nextLevelAt: 130000, nextHandAt: 13000, nextLevel: { small: 20, big: 40 },
  } };
  context.state = r;
  context.clockServerAtReceipt = 10000;
  context.renderTournament();
  assert.equal($("levelClock").hidden, false);
  assert.equal($("levelClock").textContent, "下级 02:00");
  assert.equal($("nextHandClock").textContent, "下一手 3");
  assert.equal($("nextLevelBlinds").textContent, "下级盲注 20/40");
  assert.match($("eventRules").textContent, /每 120 秒盲注翻倍/);
  assert.doesNotMatch($("tournamentProgress").textContent + $("nextLevelBlinds").textContent, /底注/);
  context.clockServerAtReceipt = 130000;
  context.updateTournamentClocks();
  assert.equal($("levelClock").textContent, "升盲在下一手生效");
  r.tournament.nextLevelAt = 250000;
  r.tournament.pendingLevel = { small: 40, big: 80 };
  context.renderTournament();
  assert.equal($("levelClock").textContent, "升盲在下一手生效");
  assert.equal($("nextLevelBlinds").textContent, "下一手盲注 40/80");
  r.onlineCount = 0;
  context.updateTournamentClocks();
  assert.equal($("nextHandClock").textContent, "暂停 · 等待玩家回桌");
  for (const flags of [{ completed: true }, { cancelled: true }]) {
    Object.assign(r.tournament, flags);
    context.renderTournament();
    assert.equal($("levelClock").textContent, "");
    assert.equal($("nextHandClock").textContent, "");
    assert.equal($("nextLevelBlinds").textContent, "");
  }
});

test("web gentle friends shows three-minute countdown and the capped next blind", () => {
  const { context, $ } = harness();
  const r = { ...room(), tournament: {
    blindPolicy: "timed", blindStructure: "gentle3", levelDurationSeconds: 180,
    started: true, level: 1, scheduledLevel: 1, remaining: 3, entrants: 3,
    standings: [], nextLevelAt: 190000, nextLevel: { small: 15, big: 30 },
  } };
  context.state = r;
  context.clockServerAtReceipt = 10000;
  context.renderTournament();
  assert.equal($("levelClock").textContent, "下级 03:00");
  assert.equal($("nextLevelBlinds").textContent, "下级盲注 15/30");
  assert.match($("eventRules").textContent, /每 3 分钟阶梯升盲/);
  assert.match($("eventRules").textContent, /最高 1000\/2000/);
  assert.match($("eventRules").textContent, /达到后不再升盲/);
  context.state = { ...r, initial: 20000 };context.renderTournament();
  assert.match($("eventRules").textContent, /前 20 分钟上限 1000\/2000/);
  assert.match($("eventRules").textContent, /最终最高 2000\/4000/);
  context.state = { ...r, tournament: { ...r.tournament, levelDurationSeconds: 420, nextLevelAt: 430000 } };
  context.renderTournament();
  assert.equal($("levelClock").textContent, "下级 07:00");
  assert.match($("eventRules").textContent, /每 7 分钟阶梯升盲/);
  context.state = r;
  context.clockServerAtReceipt = 190000;
  context.updateTournamentClocks();
  assert.equal($("levelClock").textContent, "升盲在下一手生效");
  const html = readFileSync("public/index.html", "utf8");
  assert.match(html, /好友淘汰局 · 阶梯升盲/);
  assert.match(html, /id="small"[^>]*max="500"/);
  assert.match(html, /id="big"[^>]*max="1000"/);
});

test("web legacy friends keeps no-clock labels for absent policy, elimination or zero duration", () => {
  for (const [blindPolicy, levelDurationSeconds] of [[undefined, 120], ["elimination", 120], ["timed", 0]]) {
    const { context, $ } = harness();
    context.state = { ...room(), tournament: {
      blindPolicy, levelDurationSeconds, started: true, level: 1, standings: [],
      nextLevelAt: 120000, nextLevel: { small: 20, big: 40 },
    } };
    context.renderTournament();
    assert.equal($("levelClock").hidden, true);
    assert.equal($("levelClock").textContent, "");
    assert.equal($("nextLevelBlinds").textContent, "下次淘汰后盲注 20/40");
    assert.match($("eventRules").textContent, /同手淘汰多人累计升级/);
  }
});

test("web friends god controls respect eligibility and show only opted-in dealt hands", () => {
  const { context, $ } = harness();
  context.cards = (node, values) => { node.values = values; };
  const fragment = section('  $("godControls").replaceChildren();', '  $("insightSection").hidden =');
  const observerClass = section('  $("game").classList.toggle(', '  $("code").textContent =');
  $("game").classList = { toggle: (name, enabled) => { $("game")[name] = enabled; } };
  for (const [gameMode, godMode, canGodMode, expected] of [
    ["friends", false, false, true], ["friends", false, true, true],
    ["friends", true, true, true], ["standard", false, false, false], ["turbo", false, false, false],
  ]) {
    context.r = { ...room(gameMode), godMode, canGodMode, tournament: {}, players: [
      { id: "a", stack: 0, eliminated: true, cards: [] },
      { id: "b", name: "B", cards: godMode ? ["As", "Kd"] : ["??", "??"] },
      { id: "c", name: "C", cards: [] },
      { id: "d", name: "D", cards: ["??", "??"] },
    ] };
    context.me = context.r.players[0];
    vm.runInContext(`{${observerClass}${fragment}}`, context);
    assert.equal($("game")["tournament-spectator"], !godMode);
    assert.equal($("godControls").children.length > 0, expected);
    if (expected) assert.equal($("godControls").children[0].disabled, !godMode && !canGodMode);
    assert.equal($("godHands").hidden, !godMode);
    assert.equal($("godHands").children.length, godMode ? 1 : 0);
    if (godMode) assert.deepEqual($("godHands").children[0].children[1].values, ["As", "Kd"]);
  }
  context.r={...context.r,gameMode:'friends',godMode:false,canGodMode:false,requests:[{kind:'friend-rebuy',player:context.r.me,status:'approved'}]};
  vm.runInContext(`{${fragment}}`,context);
  assert.equal($("godControls").children.length,1);
  assert.equal($("godControls").children[0].textContent,'补筹码已通过 · 下一手入局');
});

test("web new-room defaults and switching retain explicit friends with legal minimum chips", () => {
  const { context, $, sent } = harness();
  const html = readFileSync("public/index.html", "utf8");
  assert.match(html, /option value="friends"/);
  assert.match(html, /id="turnSeconds"\s+type="number"\s+value="30"/);
  $("turnSeconds").value = "30";
  $("blindMinutes").value = "7";
  assert.match(html, /id="blindMinutes"[^>]*value="3"[^>]*min="1"[^>]*max="30"/);
  assert.doesNotMatch(html, /option value="cash"/);
  for (const [id, value] of [["gameMode", "friends"], ["chips", "10000"], ["small", "10"], ["big", "20"]]) {
    $(id).value = value;
    if (id !== "gameMode") assert.match(html, new RegExp(`id="${id}"[^>]*value="${value}"`));
  }
  context.configureGameSettings();
  assert.equal($("chips").min, 100);
  assert.equal($("small").disabled, false);
  assert.equal($("blindMinutes").disabled, false);
  $("chips").value = "20000";context.configureGameSettings();
  assert.equal($("small").max,1000);assert.equal($("big").max,2000);
  $("chips").value = "12000";
  $("gameMode").value = "standard";
  $("gameMode").onchange();
  assert.equal(Number($("chips").value), 5000);
  assert.equal(Number($("small").value), 25);
  assert.equal(Number($("big").value), 50);
  assert.equal($("small").disabled, true);
  assert.equal($("blindMinutes").disabled, true);
  assert.equal($("blindIntervalField").hidden, true);
  assert.equal($("turnSeconds").value, "60");
  $("gameMode").value = "turbo";
  $("gameMode").onchange();
  $("gameMode").value = "friends";
  $("gameMode").onchange();
  assert.equal($("chips").value, "12000");
  assert.equal($("small").value, "10");
  assert.equal($("big").value, "20");
  assert.equal($("turnSeconds").value, "30");
  vm.runInContext(section('$("entry").onsubmit =', '$("rebuy").onsubmit ='), context);
  $("entry").onsubmit({ preventDefault() {} });
  assert.equal(sent[0].type, "create");
  assert.equal(sent[0].gameMode, "friends");
  assert.equal(sent[0].chips, 12000);
  assert.equal(sent[0].small, 10);
  assert.equal(sent[0].big, 20);
  assert.equal(sent[0].turnSeconds, 30);
  assert.equal(sent[0].blindMinutes, 7);
  $("turnSeconds").value = "90";
  $("gameMode").value = "standard";
  $("gameMode").onchange();
  $("turnSeconds").value = "75";
  $("gameMode").value = "friends";
  $("gameMode").onchange();
  assert.equal($("turnSeconds").value, "90");
  $("gameMode").value = "turbo";
  $("gameMode").onchange();
  assert.equal($("turnSeconds").value, "75");
});
