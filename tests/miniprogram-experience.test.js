import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import path from "node:path";
function harness() {
  const storage = new Map(),
    sent = [],
    sound = [], vibration = [];
  let page;
  const wx = {
    vibrateShort: options => vibration.push(options.type),
    getStorageSync: (k) => storage.get(k),
    setStorageSync: (k, v) => storage.set(k, v),
    showToast() {},
    showModal(options) {
      options.success({ confirm: true });
      options.complete?.();
    },
    createInnerAudioContext() {
      return {
        stop() {},
        destroy() {
          sound.push("destroy");
        },
        play() {
          sound.push(this.src);
        },
        onError() {},
      };
    },
  };
  const context = {
    wx,
    getApp: () => ({ globalData: { apiUrl: "https://example.test" } }),
    require: (name) => {
      const c = {
        module: { exports: {} },
        wx,
        getApp: () => ({ globalData: { apiUrl: "https://example.test" } }),
      };
      vm.runInNewContext(
        readFileSync("miniprogram/utils/" + path.basename(name), "utf8"),
        c,
      );
      return c.module.exports;
    },
    Page: (d) => {
      page = {
        ...d,
        data: structuredClone(d.data),
        setData: (p) => Object.assign(page.data, p),
      };
    },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
  vm.runInNewContext(
    readFileSync("miniprogram/pages/table/table.js", "utf8"),
    context,
  );
  page.socket = { send: (v) => sent.push(JSON.parse(v.data)), close() {} };
  page.data.connected = true;
  return { page, storage, sent, sound, vibration, wx };
}
test('native companion commands require admin host capability and pin config version',()=>{
 const {page,sent}=harness(),r=room();r.botSetup={canManage:true,version:3,capacity:8,bots:[]};r.host=r.me;r.phase='waiting';r.hand=0;
 page.setData({user:{role:'admin'}});page.renderRoom(r);assert.equal(page.data.canManageBots,true);page.botCountChange({detail:{value:2}});page.addTestBots();assert.equal(sent.at(-1).type,'testbots');assert.equal(sent.at(-1).count,3);assert.equal(sent.at(-1).version,3);
 page.setData({user:{role:'user'}});const n=sent.length;page.addTestBots();assert.equal(sent.length,n);
});
function room() {
  return {
    initial: 10000,
    id: "r",
    me: "a",
    host: "a",
    hand: 1,
    phase: "flop",
    turn: 0,
    serverTime: Date.now(),
    deadline: Date.now() + 60000,
    currentBet: 300,
    minRaise: 300,
    toCall: 300,
    canRaise: true,
    pot: 1200,
    board: ["Ah", "9c", "4d"],
    players: [
      {
        id: "a",
        name: "A",
        stack: 5000,
        bet: 0,
        totalBet: 150,
        cards: ["As", "Kd"],
        inHand: true,
      },
      {
        id: "b",
        name: "B",
        stack: 4700,
        bet: 300,
        totalBet: 450,
        cards: ["??", "??"],
        inHand: true,
      },
    ],
    pots: [],
    requests: [],
    history: [],
    results: [],
    log: [],
  };
}

test('native manual reveal is explicit, current-hand pinned and duplicate-safe; records render without winner status',()=>{
 const {page,sent}=harness(),r={...room(),gameMode:'friends',phase:'showdown',turn:-1,deadline:null,roundNumber:2,canShowCards:true,hasShownCards:false,
 history:[{hand:1,board:[],pots:[],results:[],shownPlayers:[{id:'a',name:'A',cards:['As','Kd']}]}]};
 page.renderRoom(r);page.showCards();page.showCards();assert.equal(sent.filter(m=>m.type==='showcards').length,1);assert.equal(sent.at(-1).round,2);assert.equal(sent.at(-1).hand,1);
 page.renderRoom({...r,canShowCards:false,hasShownCards:true});page.switchPanel({currentTarget:{dataset:{panel:'history'}}});assert.equal(page.data.pendingReveal,false);assert.equal(page.data.history[0].shownPlayers[0].shownCards[0].rank,'A');
 page.showCards();assert.equal(sent.filter(m=>m.type==='showcards').length,1);
});
test('native haptics are independent from sound and persist deduplication across page recovery',()=>{
 const {page,storage,vibration}=harness(),r={...room(),gameMode:'friends'};
 page.setData({experience:{...page.data.experience,vibration:true,sound:false}});page.renderRoom(r);assert.equal(vibration.length,1);
 page.renderRoom(r);assert.equal(vibration.length,1);page.vibrateTurn(r,10);assert.equal(vibration.length,2);page.vibrateTurn(r,9);assert.equal(vibration.length,2);
 page.haptics=null;page.vibrateTurn(r,8);assert.equal(vibration.length,2);assert.equal(storage.get('holdem-experience'),undefined);assert.ok(storage.get('holdem-haptics').length>0);
 page.hidden=true;r.deadline+=100;page.vibrateTurn(r,30);assert.equal(vibration.length,2);
 page.hidden=false;page.experienceChange({currentTarget:{dataset:{field:'vibration'}},detail:{value:false}});page.vibrateTurn(r,30);assert.equal(vibration.length,2);assert.equal(storage.get('holdem-experience').vibration,false);
});

test('native player panel protects roles, closes on removal and discards late responses',async()=>{
 const {page,sent}=harness(),r={...room(),gameMode:'friends',roundNumber:1,manageableMembers:[{id:'b',name:'B'}]};page.data.hintsEnabled=false;
 const response={room:r.id,round:1,hand:1,player:{id:'b',name:'B',stack:4700,buyin:5000,totalBet:450},statistics:{hands:2,wins:1,winRate:50,since:1000,available:true},canKick:true};page.requestApi=async()=>response;page.renderRoom(r);page.openPlayer({currentTarget:{dataset:{player:'b'}}});await new Promise(a=>setImmediate(a));assert.equal(page.data.playerPanelOpen,true);assert.equal(page.data.playerProfile.rateText,'50.00%');assert.equal(page.data.playerProfile.canKick,true);
 page.kickProfile();assert.equal(sent.at(-1).type,'kick');r.players[1].removed=true;page.renderRoom(r);assert.equal(page.data.playerPanelOpen,false);
 r.players[1].removed=false;page.renderRoom(r);let resolve;page.requestApi=()=>new Promise(a=>resolve=a);page.openPlayer({currentTarget:{dataset:{player:'b'}}});page.closePlayerPanel();resolve(response);await new Promise(a=>setImmediate(a));assert.equal(page.data.playerPanelOpen,false);
});
test('native forecast renders asynchronously and immediately hides on partial reveal or disabled hints',async()=>{
 const {page}=harness(),r=room();let calls=0;page.requestApi=async()=>{calls++;return {round:1,hand:1,phase:'flop',boardCount:3,forecast:{method:'exact',samples:1081,ceiling:{label:'同花',preflop:false},probabilities:[{key:'flush',label:'同花',count:100,percent:9.25}]}};};page.renderRoom(r);await new Promise(a=>setImmediate(a));assert.equal(page.data.forecastValue.status,'ready');assert.equal(page.data.forecastValue.topRows[0].text,'9.25%');r.flopReveal={};r.board=['Ah'];page.renderRoom(r);assert.equal(page.data.forecastValue.status,'hidden');page.toggleHints({detail:{value:false}});assert.equal(calls,1);
});
test('native dice and room management follow server state, pin round/version and require host confirmation',()=>{
 const {page,sent}=harness(),r={...room(),gameMode:'friends',phase:'waiting',hand:0,roundNumber:2,seating:{version:'v',status:'rolling',rollRound:1,canRoll:true,entries:[{id:'a',name:'A',dice:[2,6],totals:[8]}]},manageableMembers:[{id:'b',name:'B',pendingKick:false}]};
 page.renderRoom(r);page.rollSeats();assert.equal(sent.at(-1).type,'rollseat');assert.equal(sent.at(-1).version,'v');assert.equal(sent.at(-1).rollRound,1);assert.equal(page.data.seatDice.entries[0].diceImages[0],'/assets/dice-2.svg');assert.equal(page.data.startDisabled,true);
 page.kickPlayer({currentTarget:{dataset:{id:'b'}}});assert.equal(sent.at(-1).type,'kick');assert.equal(sent.at(-1).round,2);
 const count=sent.length;r.me='b';page.renderRoom(r);page.kickPlayer({currentTarget:{dataset:{id:'b'}}});assert.equal(sent.length,count);
 delete r.seating;page.renderRoom(r);assert.equal(page.data.startDisabled,false);
});
test('native friends fixed rebuy amount and vote/cancel commands follow server eligibility',()=>{
 const {page,sent}=harness(),r={...room(),gameMode:'friends',canRequestRebuy:true,tournament:{started:true,level:1},requests:[]};
 r.players[0].eliminated=true;r.players[0].stack=0;page.renderRoom(r);page.setData({rebuy:'99999'});page.request();assert.equal(sent.at(-1).amount,10000);
 r.canRequestRebuy=false;page.renderRoom(r);const n=sent.length;page.request();assert.equal(sent.length,n);
 page.approve({currentTarget:{dataset:{type:'approve',id:'q'}}});assert.equal(sent.at(-1).request,'q');
 page.approve({currentTarget:{dataset:{type:'cancelrebuy',id:'q'}}});assert.equal(sent.at(-1).type,'cancelrebuy');
 const markup=readFileSync('miniprogram/pages/table/table.wxml','utf8');assert.match(markup,/room\.canRequestRebuy/);assert.match(markup,/item\.canApprove/);assert.match(markup,/item\.canCancel/);
});
test("native creates friends explicitly and restores customized friends settings", () => {
  const { page, sent } = harness();
  page.enter();
  assert.equal(sent[0].gameMode, "friends");
  assert.equal(sent[0].chips, 10000);
  assert.equal(sent[0].small, 10);
  assert.equal(sent[0].big, 20);
  assert.equal(sent[0].turnSeconds, 30);
  assert.equal(sent[0].blindMinutes, 3);
  page.setData({ chips: "12000", small: "15", big: "30", blindMinutes: "7" });
  page.gameModeChange({ detail: { value: "1" } });
  assert.equal(page.data.gameMode, "standard");
  assert.equal(page.data.chips, "5000");
  assert.equal(page.data.small, "25");
  assert.equal(page.data.big, "50");
  assert.equal(page.data.turnSeconds, "60");
  page.enter();assert.equal(sent.at(-1).blindMinutes, undefined);
  page.gameModeChange({ detail: { value: "2" } });
  assert.equal(page.data.gameMode, "turbo");
  page.gameModeChange({ detail: { value: "0" } });
  assert.equal(page.data.chips, "12000");
  assert.equal(page.data.small, "15");
  assert.equal(page.data.big, "30");
  assert.equal(page.data.turnSeconds, "30");
  assert.equal(page.data.blindMinutes, "7");
  page.enter();assert.equal(sent.at(-1).blindMinutes, 7);
  page.setData({ turnSeconds: "90" });
  page.gameModeChange({ detail: { value: "1" } });
  page.setData({ turnSeconds: "75" });
  page.gameModeChange({ detail: { value: "0" } });
  assert.equal(page.data.turnSeconds, "90");
  page.gameModeChange({ detail: { value: "2" } });
  assert.equal(page.data.turnSeconds, "75");
});

test("native timed friends counts down blinds and continuation, retaining legacy policy captions", () => {
  const { page } = harness();
  const r = { ...room(), gameMode: "friends", phase: "showdown", turn: -1, serverTime: 10000,
    tournament: { blindPolicy: "timed", levelDurationSeconds: 120, started: true,
      level: 1, scheduledLevel: 1, nextLevelAt: 130000, nextHandAt: 13000,
      nextLevel: { small: 20, big: 40 } } };
  page.renderRoom(r);
  assert.equal(page.data.levelClock, "下级 02:00");
  assert.equal(page.data.nextHandClock, "下一手 3");
  assert.equal(page.data.nextLevelBlinds, "下级盲注 20/40");
  assert.match(page.data.eventRules, /每 120 秒盲注翻倍/);
  page.renderRoom({ ...r, serverTime: 130000 });
  assert.equal(page.data.levelClock, "升盲在下一手生效");
  page.renderRoom({ ...r, tournament: { ...r.tournament, nextLevelAt: 250000, pendingLevel: { small: 40, big: 80 } } });
  assert.equal(page.data.levelClock, "升盲在下一手生效");
  assert.equal(page.data.nextLevelBlinds, "下一手盲注 40/80");
  assert.doesNotMatch(page.data.nextLevelBlinds, /底注/);
  page.renderRoom({ ...r, onlineCount: 0 });
  assert.equal(page.data.nextHandClock, "暂停 · 等待玩家回桌");
  for (const flags of [{ stopRequested: true }, { completed: true }, { cancelled: true }]) {
    page.renderRoom({ ...r, tournament: { ...r.tournament, ...flags } });
    assert.equal(page.data.nextHandClock, flags.stopRequested ? "本手结束后停止" : "");
  }
  page.renderRoom({ ...r, phase: "waiting", tournament: { ...r.tournament, started: false, nextLevelAt: null } });
  assert.equal(page.data.levelClock, "等待开始");
  for (const [blindPolicy, levelDurationSeconds] of [[undefined, 120], ["elimination", 120], ["timed", 0]]) {
    page.renderRoom({ ...r, tournament: { ...r.tournament, blindPolicy, levelDurationSeconds } });
    assert.equal(page.data.levelClock, "");
    assert.equal(page.data.nextLevelBlinds, "下次淘汰后盲注 20/40");
    assert.match(page.data.eventRules, /同手淘汰多人累计升级/);
  }
  const wxml = readFileSync("miniprogram/pages/table/table.wxml", "utf8");
  assert.match(wxml, /wx:if="\{\{levelClock\}\}"/);
});

test("native gentle friends displays three-minute countdown and structure ceilings", () => {
  const { page } = harness();
  const r = { ...room(), gameMode: "friends", serverTime: 10000,
    tournament: { blindPolicy: "timed", blindStructure: "gentle3", levelDurationSeconds: 180,
      started: true, level: 1, scheduledLevel: 1, nextLevelAt: 190000,
      nextLevel: { small: 15, big: 30 } } };
  page.renderRoom(r);
  assert.equal(page.data.levelClock, "下级 03:00");
  assert.equal(page.data.nextLevelBlinds, "下级盲注 15/30");
  assert.match(page.data.eventRules, /每 3 分钟阶梯升盲/);
  assert.match(page.data.eventRules, /前 20 分钟上限 500\/1000/);
  assert.match(page.data.eventRules, /最高 1000\/2000/);
  assert.match(page.data.eventRules, /达到后不再升盲/);
  page.renderRoom({ ...r, initial: 20000 });
  assert.match(page.data.eventRules, /前 20 分钟上限 1000\/2000/);
  assert.match(page.data.eventRules, /最终最高 2000\/4000/);
  page.renderRoom({ ...r, tournament: { ...r.tournament, levelDurationSeconds: 420, nextLevelAt: 430000 } });
  assert.equal(page.data.levelClock, "下级 07:00");
  assert.match(page.data.eventRules, /每 7 分钟阶梯升盲/);
  page.renderRoom({ ...r, serverTime: 190000 });
  assert.equal(page.data.levelClock, "升盲在下一手生效");
  const wxml = readFileSync("miniprogram/pages/table/table.wxml", "utf8");
  assert.match(wxml, /data-field="blindMinutes"/);
});

test("native winner focus and preference respect server state and expire after backgrounding", () => {
  const { page, sent } = harness();
  const now = Date.now();
  const r = { ...room(), gameMode: "friends", phase: "showdown", turn: -1,
    showdownAt: now, serverTime: now, showWinningCards: true,
    winnerFocus: [{ id: "b", name: "B", cards: ["As", "Kd"], won: 200, handLabel: "一对" }],
    tournament: { started: true, nextHandAt: now + 5000 } };
  page.renderRoom(r);
  assert.equal(page.data.winnerFocus.length, 1);
  assert.equal(page.data.winnerFocus[0].cards[0].rank, "A");
  assert.equal(page.data.nextHandClock, "下一手 5");
  page.winningCardsChange({ detail: { value: false } });
  assert.equal(sent[0].type, "winningcards");assert.equal(sent[0].enabled, false);
  page.onHide();assert.equal(page.data.winnerFocus.length, 0);
  page.winnerExpiresAt = Date.now() - 1;
  page.onShow();assert.equal(page.data.winnerFocus.length, 0);
  page.renderRoom({ ...r, hand: 2, showdownAt: null, phase: "preflop", winnerFocus: [] });
  assert.equal(page.data.winnerFocus.length, 0);
});

test('native spectator renders without a player seat, sees dealt hands and can take a waiting seat',()=>{
 const {page,sent}=harness();
 const r={...room(),gameMode:'friends',spectating:true,spectator:{id:'watch',name:'Viewer'},me:'watch',godMode:true,canTakeSeat:false,spectatorCount:1};
 r.players[1].cards=['2c','3c'];page.renderRoom(r);
 assert.equal(page.data.me.name,'Viewer');assert.equal(page.data.me.stack,0);assert.equal(page.data.actionable,false);assert.equal(page.data.godHands.length,2);assert.match(page.data.turnNotice,/观战模式/);assert.equal(page.data.canHostStart,false);
 page.renderRoom({...r,phase:'ended',godMode:false});assert.match(page.data.turnNotice,/等待房主/);assert.equal(page.data.godHands.length,0);
 page.renderRoom({...r,phase:'waiting',hand:0,canTakeSeat:true});page.act({currentTarget:{dataset:{type:'sitin'}}});assert.equal(sent.at(-1).type,'sitin');
 const wxml=readFileSync('miniprogram/pages/table/table.wxml','utf8');assert.match(wxml,/room.canTakeSeat/);assert.match(wxml,/!room.spectating && !room.godMode/);
});
test('native join offers require confirmation before watch command and ignore cancellation',()=>{
 const {page,sent,wx}=harness();let message;
 wx.connectSocket=()=>({...page.socket,onOpen(){},onClose(){},onError(){},onMessage(fn){message=fn;}});
 page.data.user={id:'viewer'};page.connect();
 message({data:JSON.stringify({type:'spectate_offer',room:'123456',message:'Watch?'})});
 assert.equal(sent.at(-1).type,'watch');assert.equal(sent.at(-1).room,'123456');
 const before=sent.length;wx.showModal=options=>{options.success({confirm:false});options.complete?.();};
 message({data:JSON.stringify({type:'spectate_offer',room:'123456',message:'Watch?'})});assert.equal(sent.length,before);
});
test('native player latency packets patch badges only and leave game clock, state and history alone',()=>{
 const {page}=harness();const r={...room(),serverTime:1000};r.players[0].connection={online:true,rttMs:180,measuredAt:1000};page.renderRoom(r);
 assert.equal(page.data.seats[0].latency.state,'good');const patches=[],clock=page.clockReceivedAt,roomData=page.data.room;
 const setData=page.setData;page.setData=p=>{patches.push(p);setData(p);};
 page.receivePlayerLatency({room:r.id,serverTime:1100,players:[{id:r.players[0].id,connection:{online:true,rttMs:600,measuredAt:1100}}]});
 assert.equal(page.clockReceivedAt,clock);assert.equal(page.data.room,roomData);assert.equal(patches.length,1);assert.deepEqual(Object.keys(patches[0]),['seats[0].latency']);assert.equal(patches[0]['seats[0].latency'].state,'bad');
 page.receivePlayerLatency({room:'other',serverTime:1200,players:[]});assert.equal(patches.length,1);
 const wxml=readFileSync('miniprogram/pages/table/table.wxml','utf8');assert.match(wxml,/player-latency/);assert.match(wxml,/item.latency.icon/);
});
test('native hand records display only saved winner cards and distinguish legacy and unshown hands',()=>{
 const {page}=harness(),r=room();const shown={id:'shown',name:'Shown',cards:['As','Ad'],won:300,handLabel:'一对'};
 r.history=[{hand:1,board:['2h','3d','7c','8d','Jh'],pots:[],results:[],shownWinners:[shown]},{hand:2,board:[],pots:[],results:[],shownWinners:[]},{hand:3,pots:[],results:[]}];
 page.renderRoom(r);page.switchPanel({currentTarget:{dataset:{panel:'history'}}});
 assert.equal(page.data.history[0].shownWinners.length,1);assert.equal(page.data.history[0].shownWinners[0].shownCards.length,2);assert.equal(page.data.history[0].shownWinners[0].shownCards[0].rank,'A');assert.equal(page.data.history[0].shownWinners[0].handLabel,'一对');
 assert.equal(page.data.history[1].shownWinners.length,0);assert.equal(page.data.history[1].shownWinnerNote,'本手无公开亮牌记录');assert.equal(page.data.history[2].shownWinnerNote,'旧记录未保存亮牌');assert.equal(page.data.room.history.length,0);
});
test('native partial flop has fixed slots, no decision controls/hints and opens only on server completion',()=>{
 const {page}=harness(),r={...room(),turn:-1,deadline:null,insight:null,flopReveal:{revealed:1,total:3},board:['2h']};
 page.renderRoom(r);assert.equal(page.data.board.length,3);assert.equal(page.data.board.filter(c=>c.back).length,2);assert.equal(page.data.actionable,false);assert.match(page.data.turnNotice,/翻牌中.*1\/3/);assert.equal(page.data.clockSeconds,null);
 page.renderRoom({...r,board:['2h','3d'],flopReveal:{revealed:2,total:3}});assert.equal(page.data.board.filter(c=>c.back).length,1);
 page.renderRoom({...r,turn:0,deadline:Date.now()+30000,flopReveal:null,board:['2h','3d','7c']});assert.equal(page.data.board.filter(c=>c.back).length,0);assert.equal(page.data.actionable,true);
 const wxml=readFileSync('miniprogram/pages/table/table.wxml','utf8');assert.match(wxml,/!room.flopReveal/);assert.match(wxml,/item.back\?'back'/);
});

test("native friends god mode requires server eligibility and clears dealt observation on exit", () => {
  const { page, sent } = harness();
  const r = { ...room(), gameMode: "friends", tournament: { started: true }, turn: 1,
    players: [
      { ...room().players[0], stack: 0, eliminated: true, inHand: false, cards: [] },
      { ...room().players[1], cards: ["??", "??"] },
      { id: "c", name: "C", stack: 0, eliminated: true, cards: [] },
    ] };
  page.renderRoom({ ...r, canGodMode: false });
  page.toggleGodMode();
  assert.equal(sent.length, 0);
  assert.equal(page.data.godHands.length, 0);
  assert.equal(page.data.seats.find((s) => s.key === 1).cards[0].back, true);
  page.renderRoom({ ...r, canGodMode: true });
  page.toggleGodMode();
  assert.equal(sent[0].enabled, true);
  page.renderRoom({ ...r, canGodMode: true, godMode: true,
    players: r.players.map((p) => p.id === "b" ? { ...p, cards: ["As", "Kd"] } : p) });
  assert.match(page.data.turnNotice, /上帝模式/);
  assert.equal(page.data.godHands.length, 1);
  assert.equal(page.data.godHands[0].cards[0].rank, "A");
  assert.equal(page.data.seats.find((s) => s.key === 1).cards[0].back, false);
  page.toggleGodMode();
  assert.equal(sent[1].enabled, false);
  page.renderRoom({ ...r, godMode: false, canGodMode: true });
  assert.equal(page.data.godHands.length, 0);
  assert.equal(page.data.seats.find((s) => s.key === 1).cards[0].back, true);
  for (const gameMode of ["standard", "turbo"]) {
    page.renderRoom({ ...r, gameMode, canGodMode: true });
    page.toggleGodMode();
  }
  assert.equal(sent.length, 2);
  const wxml = readFileSync("miniprogram/pages/table/table.wxml", "utf8");
  assert.match(wxml, /\(!tournament \|\| room.gameMode==='friends'\) && me.stack===0/);
  assert.match(wxml, /wx:if="\{\{room.godMode\}\}" class="god-hands"/);
});

test("native friends counts down automatic next hand with elimination labels and no blind timer", () => {
  const { page, sent } = harness();
  const r = {
    ...room(), gameMode: "friends", phase: "showdown", turn: -1, initial: 10000, serverTime:10000,
    tournament: {
      started: true, level: 1, remaining: 2, entrants: 3, ante: 0,
      speed: "friends", levelDurationSeconds: 0, nextLevelAt: null, nextHandAt: 13000,
      nextLevel: { small: 20, big: 40, ante: 0 },
      pendingLevel: { small: 40, big: 80, ante: 0 },
    },
  };
  page.renderRoom(r);
  assert.equal(page.data.canHostStart, false);
  assert.equal(page.data.tournamentTitle, "好友淘汰局");
  assert.equal(page.data.levelClock, "");
  assert.equal(page.data.nextHandClock, "下一手 3");
  assert.equal(page.data.nextLevelBlinds, "下一手盲注 40/80");
  assert.match(page.data.eventRules, /同手淘汰多人累计升级/);
  assert.doesNotMatch(page.data.eventRules, /分钟/);
  assert.equal(sent.length,0);
  page.renderRoom({...r,onlineCount:0});
  assert.equal(page.data.nextHandClock,"暂停 · 等待玩家回桌");
  page.renderRoom({...r,phase:'waiting',hand:0,tournament:{...r.tournament,started:false,nextHandAt:null}});
  assert.equal(page.data.canHostStart,true);
  page.renderRoom({ ...r, tournament: { ...r.tournament, pendingLevel: null } });
  assert.equal(page.data.nextLevelBlinds, "下次淘汰后盲注 20/40");
  for (const gameMode of ["standard", "turbo"]) {
    page.renderRoom({ ...r, gameMode });
    assert.equal(page.data.canHostStart, false);
  }
  page.renderRoom({ ...r, gameMode: "cash", tournament: null });
  assert.equal(page.data.canHostStart, true);
  page.renderRoom({ ...r, host: "b" });
  assert.equal(page.data.canHostStart, false);
  page.renderRoom({ ...r, phase: "ended", tournament: { ...r.tournament, completed: true } });
  assert.equal(page.data.canHostStart, false);
  assert.equal(page.data.nextHandClock, "");
});

test("native invalid manual amounts survive snapshots and never submit in any mode", () => {
  for (const gameMode of ["friends", "standard", "turbo", "cash"]) {
    for (const value of ["", "599", "5001", "600.5", "-10", "abc", "1e3", "0x400"]) {
      const { page, sent } = harness(), r = { ...room(), gameMode };
      page.renderRoom(r);
      page.input({ currentTarget: { dataset: { field: "raise" } }, detail: { value } });
      page.renderRoom({ ...r, log: ["unrelated update"] });
      assert.equal(page.data.raise, value);
      page.act({ currentTarget: { dataset: { type: "raise" } } });
      assert.equal(sent.length, 0, `${gameMode}: ${value}`);
      assert.equal(page.data.raise, value);
      page.renderRoom({ ...r, deadline: r.deadline + 1 });
      assert.equal(page.data.raise, "600");
    }
  }
});

test('native new-room input rejects odd amounts and exposes a five-chip slider step',()=>{
 const {page,sent}=harness();page.renderRoom({...room(),chipUnit:5});assert.equal(page.data.betUnit,5);
 page.input({currentTarget:{dataset:{field:'raise'}},detail:{value:'1051'}});
 page.act({currentTarget:{dataset:{type:'raise'}}});assert.equal(sent.length,0);assert.equal(page.data.raise,'1051');
 page.input({currentTarget:{dataset:{field:'raise'}},detail:{value:'1055'}});
 page.act({currentTarget:{dataset:{type:'raise'}}});assert.equal(sent[0].amount,1055);
});
test("native exact raise-to and short-stack all-in preserve street contribution", () => {
  for (const value of ["1051", "5000"]) {
    const { page, sent } = harness();
    page.renderRoom(room());
    page.input({ currentTarget: { dataset: { field: "raise" } }, detail: { value } });
    page.act({ currentTarget: { dataset: { type: "raise" } } });
    assert.equal(sent[0].amount, Number(value));
    assert.equal(sent[0].type, value === "5000" ? "allin" : "raise");
  }
  const { page, sent } = harness(), r = room();
  r.players[0] = { ...r.players[0], bet: 100, stack: 200 };
  page.renderRoom(r);
  assert.equal(page.data.raise, "300");
  page.act({ currentTarget: { dataset: { type: "raise" } } });
  assert.equal(sent[0].type, "allin");
  assert.equal(sent[0].amount, 300);
});
test("native amount survives unrelated snapshots and locks duplicate submissions", () => {
  const { page, sent } = harness(),
    r = room();
  page.renderRoom(r);
  page.input({
    currentTarget: { dataset: { field: "raise" } },
    detail: { value: "1050" },
  });
  page.renderRoom({ ...r, log: ["joined"] });
  assert.equal(page.data.raise, "1050");
  page.act({ currentTarget: { dataset: { type: "raise" } } });
  page.act({ currentTarget: { dataset: { type: "raise" } } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].amount, 1050);
  assert.equal(page.data.pendingAction, true);
  page.renderRoom({ ...r, log: ["other update"] });
  assert.equal(page.data.pendingAction, true);
  page.renderRoom({ ...r, turn: 1, deadline: r.deadline + 1 });
  assert.equal(page.data.pendingAction, false);
});
test("native sound is opt-in, background rehydration is silent and local choices persist", () => {
  const { page, storage, sound } = harness(),
    r = room();
  page.renderRoom(r);
  assert.equal(sound.length, 0);
  page.experienceChange({
    currentTarget: { dataset: { field: "sound" } },
    detail: { value: true },
  });
  page.experienceChange({
    currentTarget: { dataset: { field: "volume" } },
    detail: { value: 20 },
  });
  assert.equal(storage.get("holdem-experience").volume, 0.2);
  page.renderRoom({ ...r, phase: "turn", board: [...r.board, "Ts"] });
  assert.equal(sound.length, 1);
  page.onHide();
  page.renderRoom({ ...r, phase: "river", board: [...r.board, "Ts", "Jc"] });
  assert.equal(sound.length, 1);
  page.onShow();
  page.renderRoom({ ...r, phase: "river", board: [...r.board, "Ts", "Jc"] });
  assert.equal(sound.length, 1);
  page.onUnload();
  assert.equal(sound.at(-1), "destroy");
});
test("original short audio assets are PCM WAV files and no network sound dependencies exist", () => {
  for (const name of ["deal", "chip", "turn", "warning", "win"]) {
    const file = readFileSync("miniprogram/assets/sounds/" + name + ".wav");
    assert.equal(file.toString("ascii", 0, 4), "RIFF");
    assert.equal(file.toString("ascii", 8, 12), "WAVE");
    assert.ok(file.length < 22050);
  }
});
test("native rematch defaults to reset, carries when selected and restores independent round history", () => {
  const { page, sent } = harness(),
    r = room();
  page.renderRoom({
    ...r,
    phase: "ended",
    turn: -1,
    roundNumber: 1,
    initial: 5000,
  });
  assert.equal(page.data.rematchMode, "reset");
  page.rematchChange({ detail: { value: "1" } });
  page.act({ currentTarget: { dataset: { type: "restart" } } });
  assert.equal(sent[0].type, "restart");
  assert.equal(sent[0].round, 1);
  assert.equal(sent[0].chipMode, "carry");
  page.act({ currentTarget: { dataset: { type: "restart" } } });
  assert.equal(sent.length, 1);
  const old = {
    number: 1,
    results: r.players.map((p) => ({ id: p.id, name: p.name, stack: p.stack })),
    history: [{ hand: 1, board: ["Ah", "9c", "4d"], pots: [], results: [] }],
  };
  page.renderRoom({
    ...r,
    phase: "waiting",
    turn: -1,
    roundNumber: 2,
    initial: 5000,
    history: [],
    completedRounds: [old],
  });
  assert.equal(page.data.rematchMode, "reset");
  assert.equal(page.data.pendingRestart, false);
  assert.equal(page.data.history.length, 0);
  page.switchPanel({ currentTarget: { dataset: { panel: "history" } } });
  page.historyRoundChange({ detail: { value: "1" } });
  assert.equal(page.data.history[0].boardCards.length, 3);
  assert.equal(page.data.room.history.length, 0);
});
