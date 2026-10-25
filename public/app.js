import { avatarFromFile, showAvatar } from "/avatar-upload.js?v=avatar1";
import {renderFriendRoomUI} from '/friend-room-ui.js?v=tabledice1';
import {PlayerPanel} from '/player-panel.js?v=charms1';
import {renderForecast} from '/hand-forecast-ui.js?v=playerforecast1';
import { TableFeedback } from "/table-feedback.js?v=hardening1";
import {RoomUI,paintPortrait} from '/room-ui.js?v=upright1';
import {ConnectionRecovery} from '/connection-recovery.js?v=raiseux2';
import {renderTableObjects,wagerView} from '/table-objects.js?v=hardening1';
import {renderSeatCharms,renderPotChips} from '/chip-display.js?v=hardening1';
import {renderBotSetup} from '/bot-setup.js?v=practice1';
import {seatRenderKey,reconcileChildren} from '/keyed-render.js?v=hardening1';
import {openReplay,closeReplay} from '/replay-ui.js?v=hardening1';
import {renderRoomControls} from '/room-controls-ui.js?v=hardening1';
const $ = (id) => document.getElementById(id);
const { decisionKey, betOptions, betStep, stepBetAmount, chipUnit,betImpact,connectionStatus } = TableExperience;
const feedback = new TableFeedback();
const roomUI = new RoomUI();
fetch('/api/security').then(response=>response.ok?response.json():null).then(info=>{
  if(!info||info.secure||['localhost','127.0.0.1','[::1]'].includes(location.hostname))return;
  const warning=$('transportWarning');warning.hidden=false;warning.textContent='HTTP 连接未加密';
  if(info.httpsURL){const link=document.createElement('a');link.href=info.httpsURL;link.textContent='使用 HTTPS';warning.append(' · ',link);}
}).catch(()=>{});
let winnerFocusTimer;
let lastPerformanceSample=null;
const controlRequests=new Map();
let watchIntent=null;
try{const value=sessionStorage.getItem('holdem-watch-intent');if(/^\d{6}$/.test(value||''))watchIntent=value;}catch{}
function setWatchIntent(room){watchIntent=room||null;try{if(watchIntent)sessionStorage.setItem('holdem-watch-intent',watchIntent);else sessionStorage.removeItem('holdem-watch-intent');}catch{}}
function rejectControlRequests(message){for(const task of controlRequests.values()){clearTimeout(task.timer);task.reject(Error(message));}controlRequests.clear();}
function sendControl(command,data){
  if(!connected||recovery.mode!=='ready')return Promise.reject(Error('连接尚未恢复，请稍后操作'));
  const id='c-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10);
  return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{controlRequests.delete(id);reject(Error('房间操作未确认，请刷新状态后重试'));},10000);controlRequests.set(id,{resolve,reject,timer});send('roomcontrol',{...data,command,controlRequestId:id});});
}
function refreshRoomControls(){if(state)renderRoomControls(state,{user:currentUser,connected:connected&&recovery.mode==='ready',send:sendControl});}
$('cancelWatch').onclick=()=>{if(connected)send('watchcancel');else{setWatchIntent(null);$('watchStatus').hidden=true;toast('已停止本机等待');}};
$('closeDiagnostic').onclick=()=>$('diagnosticDialog').close();
$('copyDiagnostics').onclick=async()=>{
  const payload={at:new Date().toISOString(),room:state?.id||null,round:state?.roundNumber||null,hand:state?.hand||null,phase:state?.phase||null,
    connected,recovery:recovery.mode,browser:navigator.userAgent,viewport:{width:innerWidth,height:innerHeight,scale:window.visualViewport?.scale||1},transport:location.protocol,online:navigator.onLine,performance:lastPerformanceSample};
  const text=JSON.stringify(payload,null,2);
  try{await navigator.clipboard.writeText(text);toast('连接诊断已复制');}catch{$('diagnosticText').value=text;if(!$('diagnosticDialog').open)$('diagnosticDialog').showModal();$('diagnosticText').focus();$('diagnosticText').select();}
};
let playerLatencyTimer,playerLatencyRoom='',playerLatencyServerAt=0,playerLatencyReceivedAt=0;
function stopPlayerLatency(){clearInterval(playerLatencyTimer);playerLatencyTimer=null;}
function latencyNow(){return Math.max(clockServerAtReceipt+performance.now()-clockReceivedAt,playerLatencyServerAt+performance.now()-playerLatencyReceivedAt);}
function refreshPlayerLatency(){
  if(!state)return;
  const now=latencyNow();
  const players=new Map(state.players.map(p=>[p.id,p]));
  for(const seat of document.querySelectorAll('#seats .seat')){
    const node=seat.querySelector('.player-latency');if(!node)continue;
    const badge=PlayerLatency.latencyBadge(connected?players.get(seat.dataset.player)?.connection:null,now);
    const key=JSON.stringify(badge);if(node.dataset.badge===key)continue;
    node.dataset.badge=key;node.className='player-latency '+badge.state;node.title=badge.title;node.setAttribute('aria-label',badge.title);
    node.querySelector('img').src=badge.icon;
  }
}
function receivePlayerLatency(message){
  if(!state||message.room!==state.id||!Number.isFinite(message.serverTime)||message.serverTime<Math.max(state.serverTime||0,playerLatencyServerAt)||!Array.isArray(message.players))return;
  playerLatencyServerAt=message.serverTime;playerLatencyReceivedAt=performance.now();
  const values=new Map(message.players.map(p=>[p.id,p.connection]));
  for(const player of state.players)if(values.has(player.id))player.connection=values.get(player.id);
  refreshPlayerLatency();
  if(playerPanel.selected)playerPanel.render();
}
const historyCache = new RoomHistory.HistoryCache();
let liveMetrics = new RoomHistory.LiveMetrics();
let rematchKey = "",
  rematchMode = "reset",
  pendingRematch = null,
  historyRoomKey = "",
  historyRound = "current";
let connected = false,
  pendingAction = null;
let pendingReveal = null;
pendingRematch = null;
for (const [id, field] of [
  ["soundEnabled", "sound"],
  ["vibrationEnabled", "vibration"],
  ["motionEnabled", "motion"],
  ["fourColorEnabled", "fourColor"],
]) {
  $(id).checked = feedback.settings[field];
  $(id).onchange = () => feedback.configure({ [field]: $(id).checked });
}
$("vibrationEnabled").disabled = !feedback.vibrationSupported;
if (!feedback.vibrationSupported) {
  $("vibrationEnabled").checked = false;
  $("vibrationSetting").title = "当前浏览器不支持震动";
  $("vibrationSetting").prepend(document.createTextNode("当前浏览器不支持 · "));
}
const revealKey = room => `${room.id}:${room.roundNumber || 1}:${room.hand}`;
function refreshShowCards() {
  if (!state) { $("showCardsControls").hidden = true; return; }
  if (!state.canShowCards || pendingReveal !== revealKey(state)) pendingReveal = null;
  $("showCardsControls").hidden = !state.canShowCards && !state.hasShownCards;
  $("showCards").hidden = !state.canShowCards;
  $("showCards").disabled = !connected || !!pendingReveal;
  $("showCardsStatus").textContent = state.hasShownCards ? "本手已亮牌" : pendingReveal ? "亮牌提交中…" : "";
}
$("showCards").onclick = () => {
  if (!connected || !state?.canShowCards || pendingReveal) return;
  pendingReveal = revealKey(state);
  send('showcards', {round:state.roundNumber || 1,hand:state.hand});
  refreshShowCards();
};
$("soundVolume").value = Math.round(feedback.settings.volume * 100);
$("soundVolume").oninput = () =>
  feedback.configure({ volume: Number($("soundVolume").value) / 100 });
$("showWinningCards").onchange = () => {
  if (!state || state.gameMode !== "friends" || !connected) return;
  $("showWinningCards").disabled = true;
  send("winningcards", { enabled: $("showWinningCards").checked });
};
document.addEventListener("pointerdown", (e) => {
  if (!$("experienceSettings").contains(e.target))
    $("experienceSettings").open = false;
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("experienceSettings").open = false;
});
let registerAvatar = null;
$("registerAvatarFile").onchange = async () => {
  if (!$("registerAvatarFile").files.length) return;
  $("authSubmit").disabled = true;
  try {
    registerAvatar = await avatarFromFile($("registerAvatarFile").files[0]);
    showAvatar(
      $("registerAvatarPreview"),
      $("registerAvatarFallback"),
      registerAvatar,
    );
  } catch (error) {
    $("authError").textContent = error.message;
    $("authError").hidden = false;
  } finally {
    $("authSubmit").disabled = false;
    $("registerAvatarFile").value = "";
  }
};
$("clearRegisterAvatar").onclick = () => {
  registerAvatar = null;
  showAvatar($("registerAvatarPreview"), $("registerAvatarFallback"), null);
};
let socket,
  currentUser,
  state,
  mode = "create",
  toastTimer;
let countdownLoop,
  clockReceivedAt = 0,
  clockServerAtReceipt = 0;
const playerPanel=new PlayerPanel({getRoom:()=>state,load:s=>api(`/api/rooms/${s.room}/players/${s.id}`),send,connected:()=>connected,networkNow:latencyNow});
const forecastController=new HandForecast.ForecastController({getRoom:()=>state,enabled:()=>connected&&!document.hidden&&$('insightEnabled').checked,
  load:s=>api(`/api/rooms/${s.room}/forecast?${new URLSearchParams(s.query)}`),render:renderForecast});
const recovery=new ConnectionRecovery({
  reconnect:()=>{if(currentUser)connect();},drop:dropConnection,
  probe:()=>{if(!connected||socket?.readyState!==1)return null;const sample=liveMetrics.ping(Date.now());send('latency',sample);return sample.echo;},
});
window.addEventListener('online',()=>recovery.wake());
window.addEventListener('focus',()=>recovery.wake());
window.addEventListener('offline',()=>recovery.wake());
window.addEventListener('pageshow',event=>recovery.wake({force:event.persisted===true}));
window.addEventListener('pagehide',()=>recovery.suspend());
document.addEventListener('freeze',()=>recovery.suspend());
document.addEventListener('resume',()=>recovery.wake());
document.addEventListener('visibilitychange',()=>{if(document.hidden)recovery.suspend();else recovery.wake();});
document.addEventListener('visibilitychange',()=>{forecastController.sync();if(document.hidden)playerPanel.close();});
function updateCountdown() {
  updateTournamentClocks();
  const clock = document.querySelector(".seat-clock");
  if (!clock || !state) return;
  const remaining = Math.max(
    0,
    Math.ceil(
      (state.deadline -
        clockServerAtReceipt -
        (performance.now() - clockReceivedAt)) /
        1000,
    ),
  );
  clock.textContent = '';
  clock.classList.toggle("urgent", remaining <= 10);
  clock.setAttribute("aria-label", `行动剩余 ${remaining} 秒`);
  clock.closest('.seat')?.style.setProperty('--turn-progress',Math.min(1,remaining/(state.turnSeconds||60)));
  clock.closest('.seat')?.classList.toggle('turn-urgent',remaining<=10&&remaining>0);
  feedback.tick(state, remaining);
  playerPanel.tick(state,remaining);
  if (remaining === 0)
    document
      .querySelectorAll("#controls button, #betSizing input, #betSizing button, #confirmRaise")
      .forEach((el) => (el.disabled = true));
  if(remaining===0)roomUI.closeRaise(false);
}
function resetCountdown() {
  clearInterval(countdownLoop);
  if (
    (state?.turn >= 0 && Number.isFinite(state.deadline)) ||
    (state?.tournament?.started &&
      !state.tournament.completed &&
      !state.tournament.cancelled)
  ) {
    updateCountdown();
    countdownLoop = setInterval(updateCountdown, 250);
  }
}
const key = "holdem-session";
const archiveKey = "holdem-archive-tokens";
const roomKey = "holdem-room";
let authMode = "login";
const hintKey = "holdem-hand-insights";
try {
  $("insightEnabled").checked = localStorage.getItem(hintKey) !== "off";
} catch {}
$("insightEnabled").onchange = () => {
  try {
    localStorage.setItem(hintKey, $("insightEnabled").checked ? "on" : "off");
  } catch {}
  renderInsight();
};
function renderInsight() {
  forecastController.sync();
  const enabled = $("insightEnabled").checked;
  const hint = state?.insight;
  $('ownHandLabel').textContent=state?.spectating?'观战中':enabled&&hint?hint.label:state?.phase==='waiting'?'等待开局':'你的手牌';
  $('ownCallPrice').textContent=state && state.players[state.turn]?.id===state.me?(state.toCall?`本轮需跟注 ${Math.min(state.toCall,state.players.find(p=>p.id===state.me)?.stack||0).toLocaleString()}`:'本轮可以过牌'):'';
  $("handInsight").hidden = !enabled || !hint;
  $("insightEmpty").hidden = !enabled || !!hint;
  $("insightEmpty").textContent =
    state?.phase === "ended"
      ? "本场已结束"
      : state?.players.find((p) => p.id === state.me)?.folded
        ? "已弃牌"
        : "发牌后显示";
  $("handLabel").textContent = hint?.label || "";
  $("handDetail").textContent = hint?.detail || "";
  $("insightDraws").replaceChildren();
  for (const draw of hint?.draws || []) {
    const line = document.createElement("div");
    line.textContent = `${draw.label} · ${draw.outs} 张补牌 · 下一张约 ${draw.nextProbability}%`;
    $("insightDraws").append(line);
  }
  if (hint?.combined) {
    const line = document.createElement("div");
    line.textContent = `同花或顺子合计 ${hint.combined.outs} 张补牌（已去重）· 下一张约 ${hint.combined.nextProbability}%`;
    $("insightDraws").append(line);
  }
  $("insightPrice").textContent = hint?.callPrice
    ? `跟注门槛参考：约 ${hint.callPrice.percent}% 底池权益。${hint.callPrice.note}`
    : "";
  $("insightNote").textContent = hint?.note || "";
  document.querySelectorAll("#board .card, #myCards .card").forEach((card) => {
    card.classList.toggle(
      "best-card",
      enabled && !!hint?.bestCards.includes(card.dataset.card),
    );
  });
}
async function api(url, method = "GET", data) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(Error(result.error || "请求失败"), {
      status: response.status,
    });
  return result;
}
function disconnect() {
  recovery.stop();
  playerPanel.close();forecastController.reset();
  stopPlayerLatency();
  connected = false;
  pendingAction = null;
  feedback.active = false;
  feedback.reset();
  clearInterval(countdownLoop);
  if (socket) {
    socket.onclose = socket.onmessage = socket.onopen = socket.onerror = null;
    socket.close();
    socket = null;
  }
}
function setAuthMode(value) {
  authMode = value;
  const registering = value === "register";
  $("registerAvatarField").hidden = !registering;
  $("nicknameField").hidden = $("inviteCodeField").hidden = !registering;
  $("authNickname").required = $("authInvite").required = registering;
  $("authPassword").autocomplete = registering
    ? "new-password"
    : "current-password";
  $("authSubmit").textContent = registering ? "注册并登录" : "登录";
  document
    .querySelectorAll("[data-auth-mode]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.authMode === value),
    );
}
function showLogin(message = "") {
  if($('diagnosticDialog').open)$('diagnosticDialog').close();
  rejectControlRequests('登录已结束');setWatchIntent(null);
  closeReplay();
  clearTimeout(winnerFocusTimer);
  if($('winnerDialog').open)$('winnerDialog').close();
  disconnect();
  historyCache.reset();
  historyFingerprint = "";
  rematchKey = "";
  rematchMode = "reset";
  historyRoomKey = "";
  historyRound = "current";
  currentUser = null;
  document.body.classList.remove('authenticated');window.HoldemTheme?.setAccount(null);roomUI.closeTools();
  $('authPassword').type='password';$('togglePassword').setAttribute('aria-pressed','false');$('togglePassword').setAttribute('aria-label','显示密码');$('togglePassword').title='显示密码';$('togglePassword').querySelector('img').src='/assets/icons/eye.svg';
  state = null;
  document.body.classList.remove("in-game");
  archiveList.replaceChildren();
  [
    "seats",
    "board",
    "myCards",
    "history",
    "results",
    "controls",
    "hostControls",
    "godControls",
    "godHands",
    "winnerFocusHands",
    "winnerDialogHands",
    "requests",
    "log",
    "myName",
    "myStack",
    "turnNotice",
    "requestBadge",
    "standings",
    "eventRules",
    "completedRounds",
    "tournamentTitle",
    "tournamentProgress",
    "levelClock",
    "nextHandClock",
    "nextLevelBlinds",
    "tournamentPositionNote",
  ].forEach((id) => $(id).replaceChildren());
  $("requestBadge").hidden = true;
  $("controls").dataset.decision = "";
  $("betSizing").hidden = true;
  $("tournamentStrip").hidden = $("tab-tournament").hidden = true;
  selectPanel("activity");
  renderInsight();
  $("authPassword").value = "";
  $("auth").hidden = false;
  $("lobby").hidden = $("game").hidden = true;
  $("accountName").hidden = $("logout").hidden = $("adminLink").hidden = true;
  $("profileLink").hidden = true;
  $("connection").textContent = "未登录";
  $("authError").textContent = message;
  $("authError").hidden = !message;
  setAuthMode("login");
}
function updateAccount(user) {
  if (currentUser?.id !== user.id) historyCache.reset();
  currentUser = user;
  document.body.classList.add('authenticated');window.HoldemTheme?.setAccount(user.id);
  archiveTitle.textContent =
    user.role === "admin" ? "我的房间与历史场次" : "最近房间";
  $("accountName").textContent = $("lobbyNickname").textContent = user.nickname;
  $("lobbyUsername").textContent = user.username;
  $("accountName").hidden = $("logout").hidden = false;
  $("profileLink").hidden = false;
  $("adminLink").hidden = user.role !== "admin";
}
async function activate(user) {
  updateAccount(user);
  $("auth").hidden = true;
  $("lobby").hidden = false;
  const legacy = [
    ...new Set(
      [sessionStorage.getItem(key), ...archiveTokens().reverse()].filter(
        Boolean,
      ),
    ),
  ];
  if (legacy.length) {
    try {
      const result = await api("/api/auth/claim", "POST", {
        tokens: legacy.slice(0, 100),
      });
      if (result.hostRecovered?.length) toast("旧房间的房主权限已恢复");
    } catch {
      toast("旧场次关联未完成，请联系管理员");
    }
  }
  if (
    new URLSearchParams(location.search).get("next") === "admin" &&
    user.role === "admin"
  ) {
    location.replace("/admin");
    return;
  }
  connect();
}
function archiveTokens() {
  try {
    const tokens = JSON.parse(localStorage.getItem(archiveKey) || "[]");
    return Array.isArray(tokens)
      ? tokens.filter((token) => typeof token === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}
function remember(token) {
  localStorage.setItem(
    archiveKey,
    JSON.stringify(
      [...archiveTokens().filter((t) => t !== token), token].slice(-100),
    ),
  );
}
const archiveSection = document.createElement("section");
archiveSection.className = "ledger";
const archiveTitle = document.createElement("h3");
archiveTitle.textContent = "我的房间与历史场次";
const archiveList = document.createElement("div");
archiveSection.append(archiveTitle, archiveList);
$("lobby").append(archiveSection);
function showArchives(list) {
  archiveList.replaceChildren(
    ...list.slice().map((item) => {
      const row = document.createElement("div");
      const b = document.createElement("button");
      b.textContent = `房间 ${item.id} · 第 ${item.roundNumber || 1} 场 · ${item.statusLabel || { waiting: "等待开局", showdown: "本手已结算", ended: "本场已结束" }[item.phase] || "正在打牌"} · 在线 ${item.onlineCount || 0} · ${item.hand} 手`;
      if(item.testRound)b.textContent='测试 · '+b.textContent;
      b.onclick = () => {
        sessionStorage.setItem(roomKey, item.id);
        send("resume", { room: item.id });
      };
      row.append(b);
      return row;
    }),
  );
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function send(type, data = {}) {
  if (socket?.readyState !== 1 || (type !== "authenticate" && !connected))
    return toast("连接尚未就绪");
  if (["fold", "check", "call", "raise", "allin"].includes(type)) {
    if (pendingAction || !state || state.players[state.turn]?.id !== state.me)
      return;
    const remaining =
      state.deadline -
      clockServerAtReceipt -
      (performance.now() - clockReceivedAt);
    if (remaining <= 0) return;
    const actionId=liveMetrics.startAction(performance.now());
    data={...data,actionId,requestId:actionId,decision:state.actionContext};
    pendingAction = { key: decisionKey(state),requestId:actionId };
    refreshBetControls();
  }
  if (type === "restart") {
    if (pendingRematch) return;
    pendingRematch = `${state.id}:${state.roundNumber || 1}`;
    document
      .querySelectorAll("#hostControls button,#hostControls select")
      .forEach((e) => (e.disabled = true));
  }
  if(type==='leave')liveMetrics.cancelActions();
  try {
    socket.send(JSON.stringify({ type, ...data }));
  } catch {
    toast("连接中断，请等待重新连接");
    recovery.failed('send_error');
  }
}
function dropConnection() {
  const previous=socket;socket=null;
  if(previous){previous.onclose=previous.onmessage=previous.onopen=previous.onerror=null;try{previous.close();}catch{}}
  connected=false;rejectControlRequests('连接中断，操作未自动重发');playerPanel.close();forecastController.reset();
  refreshRoomControls();
  if(state)renderBotSetup(state,{user:currentUser,connected,send});
  pendingReveal=null;refreshShowCards();stopPlayerLatency();refreshPlayerLatency();
  pendingAction=null;pendingRematch=null;liveMetrics.cancelActions();feedback.reset();refreshBetControls();
  $('showWinningCards').disabled=true;
  document.querySelectorAll('#hostControls button,#hostControls select,#godControls button').forEach(b=>b.disabled=true);
  $('connection').textContent=navigator.onLine===false?'网络已断开':'重新连接中';
}
function connect() {
  if (!currentUser) return;
  if(socket&&(socket.readyState===0||socket.readyState===1))return;
  recovery.connecting();
  connected = false;
  refreshBetControls();
  feedback.reset();
  liveMetrics = new RoomHistory.LiveMetrics();
  let ready = false;
  try{socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`,
  );}catch{recovery.failed('connect_error');return;}
  const connection = socket;
  socket.onopen = () => {
    if (socket !== connection) return;
    recovery.opened();
    refreshBetControls();
    $("connection").textContent = "验证登录中";
    send("authenticate", { compactState: true });
  };
  socket.onclose = () => {
    if (socket !== connection) return;
    recovery.failed('closed');
  };
  socket.onerror = () => {
    if (socket !== connection) return;
    recovery.failed('socket_error');
  };
  socket.onmessage = (e) => {
    if (socket !== connection) return;
    let msg;try{msg=JSON.parse(e.data);}catch{recovery.failed('invalid_message');return;}
    if(msg.type==='player_latency'){receivePlayerLatency(msg);return;}
    if(msg.type==='action_result'&&pendingAction?.requestId===msg.requestId){pendingAction.confirmed=true;pendingAction.version=msg.version;refreshBetControls();}
    if(msg.type==='roomcontrol_result'){
      const task=controlRequests.get(msg.requestId);if(task){clearTimeout(task.timer);controlRequests.delete(msg.requestId);task.resolve(msg);}return;
    }
    if(msg.type==='spectate_pending'){
      recovery.ready();
      if(msg.status==='pending'){setWatchIntent(String(msg.room));$('watchStatus').hidden=false;$('watchStatusText').textContent='观战申请等待房主审批';}
      else{setWatchIntent(null);$('watchStatus').hidden=true;if(msg.message)toast(msg.message);}
      return;
    }
    if (msg.type === "account") {
      connected = true;
      updateAccount(msg.user);
      $("connection").textContent = "已连接";
      if (!ready) {
        ready = true;
        const room = sessionStorage.getItem(roomKey);
        const token = sessionStorage.getItem(key);
        recovery.authenticated(!!(watchIntent||room||token));
        refreshBetControls();
        if(watchIntent)send('watch',{room:watchIntent});
        else if (room) send("resume", { room });
        else if (token) send("resume", { token });
        send("archives");
      }
    }
    if (msg.type === "latency") {
      recovery.acknowledge(msg.echo);
      const sample = liveMetrics.receive(msg, Date.now());
      if (sample && connected) {
        lastPerformanceSample={...sample,sampledAt:new Date().toISOString()};
        $("connection").title = `往返 ${Math.round(sample.rttMs)} ms · 渲染 ${Math.round(sample.renderMs)} ms`;
        send("telemetry", sample);
      }
    }
    if (msg.type === "spectate_offer") {
      if (window.confirm(msg.message)){setWatchIntent(String(msg.room));send("watch", {room:msg.room});}
    }
    if (msg.type === "session") {
      sessionStorage.setItem(key, msg.token);
      remember(msg.token);
    }
    if (msg.type === "archives") showArchives(msg.archive);
    if (msg.type === "error") {
      if(msg.scope==='roomcontrol'){
        const task=controlRequests.get(msg.requestId);if(task){clearTimeout(task.timer);controlRequests.delete(msg.requestId);task.reject(Error(msg.message));}toast(msg.message);return;
      }
      if(watchIntent&&!state){setWatchIntent(null);$('watchStatus').hidden=true;}
      if(state)renderBotSetup(state,{user:currentUser,connected,send});
      const failedResume=recovery.mode==='resuming';if(failedResume)recovery.ready();
      pendingReveal = null;refreshShowCards();
      liveMetrics.cancelActions();
      pendingAction = null;
      pendingRematch = null;
      refreshBetControls();
      if (state?.phase === "ended") render();
      if (msg.code === "auth_required") return showLogin(msg.message);
      toast(msg.message);
      if (failedResume||msg.message.includes("身份已失效") || msg.code === "room_forbidden") {
        closeReplay();
        sessionStorage.removeItem(key);
        sessionStorage.removeItem(roomKey);
        state = null;
        roomUI.closeTools();
        playerPanel.close();forecastController.reset();
        historyCache.reset();
        clearInterval(countdownLoop);
        stopPlayerLatency();
        $("game").hidden = true;
        document.body.classList.remove("in-game");
        $("lobby").hidden = false;
        send("archives");
      }
    }
    if (msg.type === "state") {
      if (!currentUser) return;
      if(state&&(state.id!==msg.room.id||(state.roundNumber||1)!==(msg.room.roundNumber||1)))closeReplay();
      if(state&&decisionKey(state)!==decisionKey(msg.room)&&msg.room.players[msg.room.turn]?.id===msg.room.me)closeReplay();
      recovery.ready();
      setWatchIntent(null);$('watchStatus').hidden=true;
      sessionStorage.setItem(roomKey, msg.room.id);
      if (state?.id === msg.room.id && msg.room.serverTime < state.serverTime)
        return;
      if (pendingAction?.key !== decisionKey(msg.room)) pendingAction = null;
      if (
        msg.room.phase !== "ended" ||
        pendingRematch !== `${msg.room.id}:${msg.room.roundNumber || 1}`
      )
        pendingRematch = null;
      state = msg.room;
      refreshShowCards();
      state = historyCache.sync(currentUser.id, state);
      clockReceivedAt = performance.now();
      clockServerAtReceipt = Number.isFinite(state.serverTime)
        ? state.serverTime
        : Date.now();
      const started = performance.now();
      render();
      const renderMs=performance.now()-started;
      liveMetrics.rendered(renderMs);
      const actionSample=liveMetrics.actionRendered(msg.actionReceipt,performance.now(),renderMs);
      if(actionSample)send('action_telemetry',actionSample);
      feedback.active = true;
      feedback.update(state);
    }
  };
}
const suits = { s: "♠", h: "♥", d: "♦", c: "♣" };
function card(value) {
  const el = document.createElement("div");
  el.dataset.card = value;
  el.dataset.suit = value[1] || "";
  el.className =
    "card" +
    (value === "??" ? " back" : ["h", "d"].includes(value[1]) ? " red" : "");
  const a = document.createElement("span"),
    b = document.createElement("span");
  a.textContent = value === "??" ? "" : value[0] === "T" ? "10" : value[0];
  b.textContent = suits[value[1]] || "";
  el.append(a, b);
  return el;
}
function cards(target, values, incremental = false) {
  const fingerprint = JSON.stringify(values);
  if (
    target.dataset.cards === fingerprint &&
    target.children.length === values.length
  )
    return;
  target.dataset.cards = fingerprint;
  if(!incremental){target.replaceChildren(...values.map(card));return;}
  values.forEach((value,index)=>{
    const old=target.children[index];if(old?.dataset.card===value)return;
    const next=card(value);if(old)target.replaceChild(next,old);else target.append(next);
  });
  while(target.children.length>values.length)target.removeChild(target.lastElementChild);
}
function setBetLabel(button,text) {
  if(button.dataset.label===text)return;
  button.dataset.label=text;button.setAttribute('aria-label',text);
  const match=text.match(/^(.*) ([\d,]+)$/),label=document.createElement('span');label.className='action-title';label.textContent=match?match[1]:text;
  const copy=document.createElement('span');copy.className='action-copy';copy.append(label);button.replaceChildren(copy);
  if(match){const amount=document.createElement('span');amount.className='action-amount';amount.textContent=match[2];amount.classList.toggle('amount-long',match[2].length>8);copy.append(amount);}
  const icon={fold:'circle-slash',call:'coins',check:'check',raise:'plus',allin:'plus'}[button.dataset.action];
  if(icon){const glyph=document.createElement('span');glyph.className='action-glyph';glyph.setAttribute('aria-hidden','true');glyph.style.setProperty('--glyph',`url('/assets/icons/${icon}.svg')`);button.append(glyph);}
}
function button(text, type, data = {}, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.action = type;
  if (type === "start") b.className = "primary";
  if(['fold','check','call','raise','allin'].includes(type))setBetLabel(b,text);else b.textContent = text;
  b.disabled = disabled;
  b.onclick = () => send(type, data);
  return b;
}
function renderRebuyRequests(r) {
  const friends=r.gameMode==='friends';
  $('rebuy').hidden=friends ? !r.canRequestRebuy : r.phase==='ended' || !!r.tournament;
  $('rebuyAmount').hidden=friends;
  $('rebuyAmount').disabled=friends;
  $('rebuyAmount').step=chipUnit(r);
  if(friends)$('rebuyAmount').value=r.initial;
  $('rebuy').querySelector('button').textContent=friends ? `申请补充 ${r.initial}` : '申请补充';
  $('requests').replaceChildren();
  $('requestBadge').hidden=!r.requests.length;
  $('requestBadge').textContent=r.requests.length;
  $('tab-chips').setAttribute('aria-label',r.requests.length ? `筹码，${r.requests.length} 项申请` : '筹码');
  for(const req of r.requests) {
    const row=document.createElement('div');
    const name=r.players.find(p=>p.id===req.player)?.name || '';
    const title=document.createElement('div');
    title.textContent=`${name} 申请 ${req.amount}`;
    row.append(title);
    if(req.kind==='friend-rebuy') {
      const progress=document.createElement('div');progress.className='rebuy-progress';
      progress.textContent=req.status==='approved' ? '全员通过 · 下一手到账' : `已同意 ${req.approvals.length}/${req.voters.length}`;
      row.append(progress);
      const votes=document.createElement('div');votes.className='rebuy-votes';
      for(const vote of req.votes) {
        const item=document.createElement('span');item.className=vote.approved?'approved':'pending';
        item.textContent=`${vote.name} · ${vote.approved?'已同意':'待审批'}`;votes.append(item);
      }
      row.append(votes);
      if(req.canApprove)row.append(button('同意','approve',{request:req.id}),button('拒绝','reject',{request:req.id}));
      if(req.canCancel)row.append(button('撤销申请','cancelrebuy',{request:req.id}));
    } else {
      if(req.status==='approved')title.textContent+=' · 已批准，本手结束后到账';
      if(r.host===r.me)row.append(button(req.status==='approved'?'已批准':'批准','approve',{request:req.id},req.status==='approved'||r.phase==='ended'),button('拒绝','reject',{request:req.id},r.phase==='ended'));
    }
    $('requests').append(row);
  }
}
function render() {
  const r = state,
    me = r.players.find((p) => p.id === r.me) || {...r.spectator,cards:[],stack:0};
  if(playerLatencyRoom!==r.id){playerLatencyRoom=r.id;playerLatencyServerAt=0;playerLatencyReceivedAt=0;}
  $("lobby").hidden = true;
  $("game").hidden = false;
  document.body.classList.add("in-game");
  $("winnerSetting").hidden = r.gameMode !== "friends" || !!r.spectating;
  $("personalHand").hidden = !!r.spectating;
  $("game").classList.toggle("spectator-view",!!r.spectating);
  $("showWinningCards").checked = r.showWinningCards !== false;
  $("showWinningCards").disabled = !connected;
  $("game").classList.toggle("god-view", !!r.godMode);
  $("game").classList.toggle(
    "tournament-spectator",
    !!r.tournament && !!me.eliminated && !r.godMode,
  );
  $("code").textContent = r.id;
  renderFriendRoomUI(r,{send,connected,confirm,feedback});
  renderBotSetup(r,{user:currentUser,connected,send});
  refreshRoomControls();
  $('watchPolicy').hidden=r.gameMode!=='friends';
  $('watchPolicy').textContent=r.roomControls?.realtimeAllowed===false?'公开观战':'实时底牌';
  $('watchPolicy').dataset.realtime=String(r.roomControls?.realtimeAllowed!==false);
  playerPanel.sync();
  $("meta").textContent =
    `${r.testRound?'测试场 · ':''}盲注 ${r.small}/${r.big} · 第 ${r.hand} 手 · ${r.seatedCount ?? r.players.length}/9 人`;
  $('meta').title=`在线 ${r.onlineCount ?? r.players.length} · 观战 ${r.spectatorCount||0} · 第 ${r.roundNumber||1} 场 · 房主 ${r.players.find(p=>p.id===r.host)?.name||'-'} · 行动 ${r.turnSeconds||60}s`;
  const previousSeats=new Map([...$('seats').children].map(node=>[node.dataset.player,node])),nextSeats=[];
  const seated = r.tournament?.started
    ? r.players.filter(
        (p) =>
          !p.removed && (!p.eliminated ||
          (["showdown", "ended"].includes(r.phase) && p.inHand)),
      )
    : r.players.filter(p=>!p.removed);
  $("seats").closest('.table-wrap').dataset.players = seated.length;
  TableLayout.seatLayout(seated, r.me).forEach(({ x, y, index }) => {
    const p = seated[index],
      i = r.players.indexOf(p);
    const renderKey=seatRenderKey(p,r,i,wagerView(r,p,i).roles),previous=previousSeats.get(p.id);
    if(previous?.dataset.renderKey===renderKey){nextSeats.push(previous);return;}
    const el = document.createElement("div");
    el.dataset.renderKey=renderKey;
    el.className =
      "seat" +
      (p.folded ? " folded" : "") +
      (p.id === r.me ? " mine" : "") +
      (r.turn === i ? " active" : "");
    el.style.setProperty(
      "--avatar-color",
      [
        "#668bab",
        "#be8063",
        "#a079a0",
        "#67947c",
        "#b59b61",
        "#739fa1",
        "#ab6b72",
      ][i % 7],
    );
    el.dataset.player = p.id;
    el.dataset.side=x>60?'right':x<40?'left':'center';
    el.style.left = x + "%";
    el.style.top = y + "%";
    if (!p) el.textContent = "空座";
    else {
      const avatar = document.createElement("button");avatar.type='button';avatar.title='查看 '+p.name+' 的资料';avatar.setAttribute('aria-label',avatar.title);avatar.onclick=()=>playerPanel.open(p.id);
      avatar.className = "avatar";
      paintPortrait(avatar,p.name,i);
      avatar.textContent = p.name.slice(0, 1);
      if(p.isBot){avatar.classList.remove('illustrated-avatar');avatar.classList.add('bot-avatar');avatar.textContent='';const icon=document.createElement('img');icon.src='/assets/icons/bot.svg';icon.alt='测试陪练';avatar.append(icon);}
      if (p.avatar) {
        const photo = document.createElement("img");
        photo.src = p.avatar;
        photo.alt = p.name + "的头像";
        photo.onerror = () => photo.remove();
        avatar.append(photo);
      }
      const name = document.createElement("div");
      name.className = "name";
      const nameLabel=document.createElement('span');nameLabel.className='seat-name-label';
      nameLabel.textContent=(p.seatNumber?`${p.seatNumber} · `:'')+p.name+(p.id===r.me?' · 你':'');name.title=nameLabel.textContent;
      const network=document.createElement('button');network.type='button';network.className='player-latency';network.onclick=()=>playerPanel.open(p.id);
      network.hidden=!!p.isBot;
      const signal=document.createElement('img');signal.alt='';signal.setAttribute('aria-hidden','true');
      network.append(signal);name.append(nameLabel,network);
      const stack = document.createElement("div");
      stack.className = "stack";
      stack.textContent = p.stack.toLocaleString();
      const total = document.createElement("div");
      total.className =
        "hand-total" +
        (String(p.totalBet || 0).length >= 7 ? " amount-large" : "");
      total.textContent = "总下注 " + (p.totalBet || 0);
      total.dataset.amount=String(p.totalBet||0);
      total.title = `本手总下注：${(p.totalBet || 0).toLocaleString()}`;
      total.setAttribute("aria-label", total.title);
      const bet = document.createElement("div");
      bet.className = "bet";
      bet.textContent = p.godMode
        ? "上帝模式"
        : p.folded
          ? "已弃牌"
          : (r.phase === "showdown" || r.tournament?.completed) && p.handLabel
            ? p.handLabel + (p.eliminated ? " · 淘汰" : "")
            : p.inHand && p.stack === 0
              ? "ALL IN"
              : "";
      const hand = document.createElement("div");
      hand.className = "cards";
      cards(hand, p.cards);
      renderSeatCharms(avatar,wagerView(r,p,i).roles);
      el.append(avatar, name, stack, total, bet, hand);
      if (r.turn === i && Number.isFinite(r.deadline)) {
        const clock = document.createElement("span");
        clock.className = "seat-clock";
        clock.setAttribute("role", "timer");
        el.append(clock);
      }
    }
    nextSeats.push(el);
  });
  reconcileChildren($('seats'),nextSeats);
  refreshPlayerLatency();
  renderTableObjects(r);
  renderPotChips(r.pot);
  if(!playerLatencyTimer)playerLatencyTimer=setInterval(refreshPlayerLatency,1000);
  cards($("board"), r.flopReveal?[...r.board,...Array(Math.max(0,3-r.board.length)).fill('??')]:r.board,true);
  $('board').dataset.count=r.flopReveal?'3':String(r.board.length);
  renderWinnerFocus(r);
  cards($("myCards"), me.cards.length ? me.cards : ["??", "??"]);
  $("myName").textContent = me.name;
  $("myStack").textContent = me.stack.toLocaleString() + " 筹码";
  $("myCards").setAttribute("aria-label", "你的手牌");
  $("stage").textContent = {
    waiting: "等待好友入座",
    preflop: "翻牌前",
    flop: "翻牌",
    turn: "转牌",
    river: "河牌",
    showdown: "本手结算",
    ended: "本场已结束",
  }[r.phase];
  if (r.tournament?.completed) $("stage").textContent = "冠军已产生";
  else if (r.tournament?.cancelled) $("stage").textContent = "比赛已取消";
  if(r.flopReveal)$("stage").textContent=`翻牌中 ${r.board.length}/3`;
  $("potValue").textContent = r.pot.toLocaleString();
  $("payout").textContent = ["showdown", "ended"].includes(r.phase)
    ? r.pots
        .map(
          (p) =>
            `${p.winners.join("、")} ${p.refund ? "退回" : "赢得"} ${p.amount}`,
        )
        .join(" · ")
    : "";
  const c = $("controls");
  const actingPlayer = r.players[r.turn];
  $("turnNotice").textContent = actingPlayer
    ? actingPlayer.id === r.me
      ? "轮到你"
      : `轮到 ${actingPlayer.name}`
    : r.phase === "ended"
      ? "本场已结束，等待房主再开一场"
      : r.phase === "showdown"
        ? "本手已结算"
        : "等待好友入座";
  $("turnNotice").classList.toggle("your-turn", actingPlayer?.id === r.me);
  if (r.tournament?.completed)
    $("turnNotice").textContent =
      r.tournament.championId === r.me ? "恭喜夺冠" : "比赛已结束";
  if (r.tournament && me.eliminated)
    $("turnNotice").textContent = `已淘汰 · 第 ${me.place} 名 · 旁观中`;
  if (r.godMode) $("turnNotice").textContent = "上帝模式 · 仅旁观";
  if (r.phase === "waiting" && (r.roundNumber || 1) > 1) {
    $("stage").textContent = "等待发牌";
    $("turnNotice").textContent =
      r.host === r.me ? "本场已准备，点击开始发牌" : "等待房主发牌";
  }
  if(r.gameMode==='friends' && r.phase==='waiting' && r.seating && !r.godMode && !r.spectating) {
    $('stage').textContent=r.seating.status==='idle'?'等待开局':'掷骰排座';
    $('turnNotice').textContent=r.seating.status==='idle'?'等待房主开始比赛':r.seating.status==='ready'?'座位已确认，即将自动发牌':r.seating.canRoll?'等待你掷骰子':'等待其他牌手掷骰';
  }
  if (r.status === "ending")
    $("turnNotice").textContent += " · 本手结算后自动结束";
  if (r.phase === "ended" && r.endReason === "idle")
    $("turnNotice").textContent = "无人在线超时，本场已自动结束";
  $("godControls").replaceChildren();
  if(r.flopReveal)$("turnNotice").textContent=`翻牌中 · ${r.board.length}/3`;
  if (!r.spectating && (!r.tournament || r.gameMode === "friends") && me.stack === 0 && r.phase !== "ended") {
    const queued=r.requests?.some(req=>req.kind==='friend-rebuy' && req.player===r.me && req.status==='approved');
    if(!queued)$("godControls").append(
      button(
        r.godMode ? "退出上帝模式" : "开启上帝模式",
        "godmode",
        { enabled: !r.godMode },
        !r.godMode && !r.canGodMode,
      ),
    );
    const status = document.createElement("span");
    status.textContent = queued ? '补筹码已通过 · 下一手入局' : r.canGodMode
      ? r.gameMode === "friends" ? "仅旁观已发底牌" : "补充筹码到账后自动退出"
      : "本手结束后可开启";
    $("godControls").append(status);
  }
  if(r.spectating) {
    $("turnNotice").textContent = r.flopReveal?`观战中 · 翻牌 ${r.board.length}/3`:r.phase==='ended' ? '观战中 · 等待房主再开一场' : r.roomControls?.realtimeAllowed===false?'观战模式 · 仅公开牌':'观战模式 · 实时底牌';
    if(r.canTakeSeat) $("godControls").append(button('入座本场','sitin',{},!connected));
    else if(r.phase==='waiting') {
      const status=document.createElement('span');status.textContent='座位已满 · 继续观战';$("godControls").append(status);
    }
  }
  $("godHands").hidden = !r.godMode;
  $("godHands").replaceChildren();
  if (r.godMode)
    r.players
      .filter((p) => p.id !== r.me && p.cards.length && p.cards.every((c) => c !== "??"))
      .forEach((p) => {
        const entry = document.createElement("div");
        entry.className = "god-hand";
        const name = document.createElement("span");
        name.textContent = p.name + (p.folded ? " · 已弃牌" : "");
        name.title = name.textContent;
        const hand = document.createElement("div");
        hand.className = "cards";
        cards(hand, p.cards);
        entry.append(name, hand);
        $("godHands").append(entry);
      });
  $("insightSection").hidden =
    !!r.flopReveal || !!r.spectating || !!r.godMode || (!!r.tournament && !!me.eliminated);
  renderInsight();
  renderBetControls(r);
  $("contribution").textContent = me.inHand
    ? `本手投入 ${(me.totalBet || 0).toLocaleString()}`
    : "";
  const h = $("hostControls");
  h.replaceChildren();
  if (
    r.host === r.me &&
    (r.tournament
      ? r.phase === "waiting"
      : ["waiting", "showdown"].includes(r.phase))
  )
    h.append(
      button(
        r.hand ? "开始下一手" : r.tournament ? "开始比赛" : "开始发牌",
        "start",
        {},
        r.roomControls?.canContinue===false || r.players.filter((p) => !p.removed && p.stack > 0).length < 2 || (r.gameMode==='friends' && (r.seating?.status==='rolling' || Number.isFinite(r.seating?.autoStartAt))),
      ),
    );
  if (
    r.host === r.me &&
    (r.tournament
      ? r.phase !== "ended"
      : ["waiting", "showdown"].includes(r.phase))
  ) {
    if (r.players.filter((p) => p.stack > 0).length < 2) {
      const status = document.createElement("span");
      status.className = "host-status";
      status.textContent = "有筹码的玩家不足 2 人";
      h.append(status);
    }
    const end = button(
      r.tournament ? "结束比赛" : "结束本场",
      "end",
      {},
      !!r.tournament?.stopRequested,
    );
    end.onclick = () => {
      if (
        confirm(
          r.tournament
            ? "结束比赛？正在进行的手牌会正常结算，之后不再发牌。"
            : "结束本场并保存战绩？之后可以在原房间再开一场。",
        )
      )
        send("end");
    };
    h.append(end);
  }
  if (r.host === r.me && r.phase === "ended") {
    const key = `${r.id}:${r.roundNumber || 1}`;
    if (rematchKey !== key) {
      rematchKey = key;
      rematchMode = "reset";
    }
    if (r.canCarryRound === false) rematchMode = "reset";
    const label = document.createElement("label");
    label.className = "rematch-choice";
    label.textContent = "再开筹码";
    const select = document.createElement("select");
    select.id = "rematchChipMode";
    select.setAttribute("aria-label", "再开筹码方式");
    for (const [value, text] of [
      ["reset", `重置为 ${r.initial}`],
      ["carry", "保留当前筹码"],
    ]) {
      const o = new Option(text, value);
      o.disabled = value === "carry" && r.canCarryRound === false;
      select.append(o);
    }
    select.value = rematchMode;
    select.onchange = () => {
      rematchMode = select.value;
    };
    label.append(select);
    const reopen = button("再开一场", "restart", {}, !!pendingRematch);
    reopen.onclick = () => {
      if (
        confirm(
          `在原房间再开一场？${rematchMode === "reset" ? `所有玩家重置为 ${r.initial} 筹码。` : "保留各自筹码，新场输赢从当前筹码重新计算。"}上一场战绩保留，未处理的筹码申请将清除。`,
        )
      )
        send("restart", { round: r.roundNumber || 1, chipMode: rematchMode });
    };
    select.disabled = !!pendingRematch;
    h.append(label, reopen);
    if (r.canCarryRound === false) {
      const note = document.createElement("span");
      note.className = "host-status";
      note.textContent = "淘汰赛已有零筹码玩家，需重置筹码";
      h.append(note);
    }
  }
  renderRebuyRequests(r);
  renderRoundRecords(r);
  renderHistoryPanel();
  $("log").replaceChildren(
    ...r.log.slice(-6).map((text) => {
      const d = document.createElement("div");
      d.textContent = text;
      return d;
    }),
  );
  $("results").replaceChildren(
    ...r.results.map((p) => {
      const row = document.createElement("tr");
      [p.name, p.buyin, p.stack, (p.net > 0 ? "+" : "") + p.net].forEach(
        (v, i) => {
          const td = document.createElement("td");
          td.textContent = v;
          if (i === 3) td.className = p.net >= 0 ? "positive" : "negative";
          row.append(td);
        },
      );
      return row;
    }),
  );
  if (!r.log.length) $("log").textContent = "好友已入座，等待发牌";
  renderTournament();
  if (!connected)
    document
      .querySelectorAll(
        "#hostControls button,#hostControls select,#godControls button",
      )
      .forEach((b) => (b.disabled = true));
  resetCountdown();
  roomUI.sync(r);
}
function renderWinnerFocus(r) {
  clearTimeout(winnerFocusTimer);
  const panel = $("winnerFocus"), table = $('seats').closest(".table-wrap"),dialog=$('winnerDialog');
  const remaining = (r.showdownAt || 0) + 5000 -
    (clockServerAtReceipt + performance.now() - clockReceivedAt);
  const winners = remaining > 0 ? (r.winnerFocus || []) : [];
  panel.hidden = !winners.length;
  table.classList.remove("winner-presenting");
  if (!winners.length) { panel.dataset.winners = ""; if(dialog.open)dialog.close(); return; }
  const key = JSON.stringify([r.id, r.roundNumber || 1, r.hand, winners]);
  if (panel.dataset.winners !== key) {
    if(dialog.open)dialog.close();
    panel.dataset.winners = key;
    panel.dataset.count = winners.length;
    const entryFor=winner=>{
      const entry = document.createElement("div");
      entry.className = "winner-focus-player";
      const name = document.createElement("strong");
      name.textContent = winner.name + (winner.id === r.me ? " · 你" : "");
      name.title = name.textContent;
      const hand = document.createElement("div");
      hand.className = "cards";
      cards(hand, winner.cards);
      const result = document.createElement("span");
      result.textContent = [winner.handLabel, "+" + winner.won.toLocaleString()].filter(Boolean).join(" · ");
      entry.append(name, hand, result);
      return entry;
    };
    const winner=winners.find(w=>w.id===r.me)||winners[0],summary=document.createElement('button');
    summary.type='button';summary.className='winner-summary';summary.setAttribute('aria-label',`查看${winners.length}位赢家底牌`);
    const hand=document.createElement('div');hand.className='cards';cards(hand,winner.cards);
    const copy=document.createElement('span');copy.className='winner-summary-copy';
    const name=document.createElement('strong');name.textContent=winner.name;name.title=winner.name;
    const result=document.createElement('span');result.textContent='+'+winner.won.toLocaleString()+(winners.length>1?` · 共${winners.length}位`:'');
    copy.append(name,result);summary.append(hand,copy);
    summary.onclick=()=>{$('winnerDialogHands').replaceChildren(...winners.map(entryFor));if(!dialog.open)dialog.showModal();};
    $("winnerFocusHands").replaceChildren(summary);
  }
  winnerFocusTimer = setTimeout(() => {
    panel.hidden = true;
    if(dialog.open)dialog.close();
    table.classList.remove("winner-presenting");
  }, remaining);
}
function displayedHistory(r) {
  return historyRound === "current"
    ? r.history || []
    : (r.completedRounds || []).find((s) => String(s.number) === historyRound)
        ?.history || [];
}
let historyFingerprint = "";
function renderHistoryPanel() {
  if (!state || $("panel-history").hidden || document.hidden) return;
  state = historyCache.sync(currentUser?.id, state);
  renderRoundRecords(state);
  const list = displayedHistory(state);
  const entry = historyCache.entry(historyRound);
  const fingerprint = `${historyCache.context.account}:${entry.revision}:${state.id}:${state.roundNumber || 1}:${historyRound}`;
  if (historyFingerprint !== fingerprint) {
    historyFingerprint = fingerprint;
    const roomRound = `${state.id}:${historyRound === "current" ? state.roundNumber || 1 : historyRound}`;
    const expanded = new Set([...$("history").children].filter((node) => node.open && node.dataset.roomRound === roomRound).map((node) => node.dataset.hand));
    $("history").replaceChildren(...list.slice().reverse().map((hand) => {
      const d = document.createElement("details"), summary = document.createElement("summary");
      d.dataset.hand = String(hand.hand);
      d.dataset.roomRound = roomRound;
      d.open = expanded.has(d.dataset.hand);
      summary.textContent = `${hand.testRound?'测试 · ':''}第 ${hand.hand} 手 · ` + hand.pots.map((p) => p.winners.join("、") + (p.refund ? "退回 " : "赢得 ") + p.amount).join(" · ");
      const board = document.createElement("div"), note = document.createElement("div");
      board.className = "cards";
      note.className = "history-board-note";
      const saved = Array.isArray(hand.board) ? hand.board : [];
      note.textContent = !Array.isArray(hand.board) ? "旧记录未保存公共牌" : saved.length ? `公共牌 · ${saved.length} 张` : "未发公共牌：本手在翻牌前结束";
      d.append(summary, note);
      const replayButton=document.createElement('button');replayButton.type='button';replayButton.className='history-replay';
      replayButton.textContent=hand.replay?'复盘':'旧记录 · 未记录过程';replayButton.disabled=!hand.replay;replayButton.onclick=()=>openReplay(hand);d.append(replayButton);
      if (saved.length) { cards(board, saved); d.append(board); }
      const shown=[...(Array.isArray(hand.shownWinners)?hand.shownWinners:[]),...(Array.isArray(hand.shownPlayers)?hand.shownPlayers:[])];
      if(shown.length){
        const title=document.createElement('div');title.className='history-winner-title';title.textContent='公开亮牌';
        const winners=document.createElement('div');winners.className='history-winners';
        for(const winner of shown){
          const item=document.createElement('div');item.className='history-winner';item.dataset.winner=winner.id;
          const name=document.createElement('strong');name.className='history-winner-name';name.textContent=winner.name;name.title=winner.name;
          const handCards=document.createElement('div');handCards.className='cards';cards(handCards,winner.cards);
          const label=document.createElement('span');label.className='history-winner-label';label.textContent=[winner.handLabel,Number.isFinite(winner.won)?`赢得 ${winner.won}`:'主动亮牌'].filter(Boolean).join(' · ');
          item.append(name,handCards,label);winners.append(item);
        }
        d.append(title,winners);
      }else{
        const note=document.createElement('div');note.className='history-winner-note';note.textContent=Array.isArray(hand.shownWinners)?'本手无公开亮牌记录':'旧记录未保存亮牌';d.append(note);
      }
      for (const p of hand.results) {
        const line = document.createElement("div");
        line.textContent = `${p.name} · 买入 ${p.buyin} · 筹码 ${p.stack} · 净输赢 ${p.net}`;
        d.append(line);
      }
      return d;
    }));
  }
  $("historyStatus").textContent = entry.error || (entry.loading ? "加载中…" : list.length ? "" : entry.loaded || !historyCache.context.compact ? "本场暂无已完成的手牌" : "");
  $("historyRetry").hidden = !entry.error;
  $("historyMore").hidden = !historyCache.context.compact || !entry.loaded || entry.offset >= entry.total;
  $("historyMore").disabled = entry.loading || !!entry.error;
  loadHistory();
}
async function loadHistory(more = false, retry = false) {
  if (!state || !currentUser || $("panel-history").hidden || document.hidden) return;
  const request = historyCache.begin(historyRound, more, retry);
  if (!request) return;
  renderHistoryPanel();
  try {
    const page = await api(historyCache.url(request));
    if (!state || currentUser?.id !== request.context.account || state.id !== request.context.roomId) return;
    historyCache.accept(request, page);
  } catch (error) {
    historyCache.fail(request, error.message);
  }
  if (historyCache.active(request)) renderHistoryPanel();
}
$("historyMore").onclick = () => loadHistory(true);
$("historyRetry").onclick = () => loadHistory(historyCache.entry(historyRound).loaded, true);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderHistoryPanel();
});
function renderRoundRecords(r) {
  const key = `${r.id}:${r.roundNumber || 1}`;
  if (historyRoomKey !== key) {
    historyRoomKey = key;
    historyRound = "current";
    historyFingerprint = "";
    $("history").replaceChildren();
    $("completedRounds").replaceChildren();
    delete $("completedRounds").dataset.rounds;
  }
  const past = (r.completedRounds || [])
    .filter((s) => s.number < (r.roundNumber || 1))
    .slice()
    .sort((a, b) => b.number - a.number)
    .slice(0,1)
    .map(({ history, ...summary }) => summary);
  const select = $("historyRoundSelect"),
    fingerprint = JSON.stringify([
      r.roundNumber || 1,
      past.map((s) => s.number),
    ]);
  if (select.dataset.rounds !== fingerprint) {
    select.dataset.rounds = fingerprint;
    select.replaceChildren(
      new Option(`第 ${r.roundNumber || 1} 场 · 当前`, "current"),
      ...past.map(
        (s) => new Option(`第 ${s.number} 场 · 已结束`, String(s.number)),
      ),
    );
  }
  select.value = historyRound;
  $("openRoundHistory").hidden = !r.completedRoundCount || past.length > 0;
  if ($("panel-results").hidden || document.hidden) return;
  const records = $("completedRounds"), recordsFingerprint = `${historyCache.catalogRevision}:${r.id}:${r.roundNumber || 1}`;
  if (records.dataset.rounds === recordsFingerprint) return;
  records.dataset.rounds = recordsFingerprint;
  $("completedRounds").replaceChildren(
    ...past.map((s) => {
      const d = document.createElement("details");
      d.className = "round-record";
      const summary = document.createElement("summary");
      summary.textContent = `${s.testRound?'测试 · ':''}第 ${s.number} 场 · ${s.hand} 手 · 已结束`;
      d.append(summary);
      for (const p of s.results) {
        const row = document.createElement("div");
        row.className = "round-result";
        row.textContent = `${p.name} · 买入 ${p.buyin} · 筹码 ${p.stack} · 净输赢 ${p.net > 0 ? "+" : ""}${p.net}`;
        d.append(row);
      }
      return d;
    }),
  );
}
$("openRoundHistory").onclick = () => selectPanel("history");
$("historyRoundSelect").onchange = () => {
  historyRound = $("historyRoundSelect").value;
  renderHistoryPanel();
};
function renderBetControls(r) {
  const c = $("controls"),
    own = r.players[r.turn]?.id === r.me,
    key = own ? decisionKey(r) : "";
  $("betSizing").hidden = !own;
  if (c.dataset.decision !== key) {
    c.dataset.decision = key;
    c.replaceChildren();
    $("betPresets").replaceChildren();
    if (own) {
      const options = betOptions(r);
      $("betAmount").value = Math.min(options.min, options.max);
      const raise = button("加注至", "raise");
      raise.setAttribute('aria-haspopup','dialog');raise.setAttribute('aria-controls','raiseDialog');
      raise.onclick = () => roomUI.openRaise(key, () => {
        const amount = Number($("betAmount").value),
          o = betOptions(state);
        if (
          !/^\d+$/.test($("betAmount").value) ||
          !Number.isSafeInteger(amount) ||
          amount > o.max ||
          amount < Math.min(o.min, o.max)
        )
          return roomUI.showRaiseError("请输入合法的加注金额");
        if(amount % chipUnit(state))
          return roomUI.showRaiseError("筹码必须为 5 的倍数");
        roomUI.closeRaise(false);
        send(amount === o.max ? "allin" : "raise", { amount });
      });
      c.append(
        button("弃牌", "fold"),
        button(
          r.toCall ? "跟注 " + options.call : "过牌",
          r.toCall ? "call" : "check",
        ),
        raise,
      );
      for (const [label, field] of [
        ["最小", "min"],
        ["½ 底池", "half"],
        ["底池", "pot"],
        ["全下", "max"],
      ]) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.dataset.preset = field;
        b.onclick = () => {
          const o = betOptions(state);
          $("betAmount").value = Math.min(o[field], o.max);
          refreshBetControls();
        };
        $("betPresets").append(b);
      }
    }
  }
  refreshBetControls();
}
function refreshBetControls() {
  if (!state) return;
  const own = state.players[state.turn]?.id === state.me,
    o = betOptions(state);
  const expired =
    Number.isFinite(state.deadline) &&
    state.deadline -
      clockServerAtReceipt -
      (performance.now() - clockReceivedAt) <=
      0;
  const recovering=typeof recovery!=='undefined'&&recovery.mode!=='ready';
  const blocked = !own || !connected || recovering || !!pendingAction || expired;
  const number = $("betAmount"),
    slider = $("betSlider"),
    low = Math.min(o.min, o.max);
  number.min = slider.min = low;
  number.max = slider.max = o.max;
  number.step = slider.step = chipUnit(state);
  const impact=betImpact(state,number.value);
  $('betTarget').textContent=impact?impact.target.toLocaleString():'-';
  $('betAdded').textContent=impact?impact.added.toLocaleString():'-';
  $('betRemaining').textContent=impact?impact.remaining.toLocaleString():'-';
  slider.value = Math.max(low, Math.min(o.max, Number(number.value) || low));
  number.disabled = slider.disabled = blocked || (!o.canRaise && !o.canAllin);
  const step=betStep(state),value=Number(number.value),valid=/^\d+$/.test(number.value)&&Number.isSafeInteger(value);
  $('betDecrease').disabled=number.disabled||step===0||(valid&&value<=low);
  $('betIncrease').disabled=number.disabled||step===0||(valid&&value>=o.max);
  $('betDecrease').title=`减少 ${step.toLocaleString()} 筹码`;$('betIncrease').title=`增加 ${step.toLocaleString()} 筹码`;
  document.querySelectorAll("#betPresets button").forEach((b) => {
    b.disabled =
      blocked || (b.dataset.preset === "max" ? !o.canAllin : !o.canRaise);
    b.setAttribute(
      "aria-pressed",
      String(Number(number.value) === Math.min(o[b.dataset.preset], o.max)),
    );
  });
  document.querySelectorAll("#controls button").forEach((b) => {
    b.disabled =
      blocked || (b.dataset.action === "raise" && !o.canRaise && !o.canAllin);
    if (b.dataset.action === "raise")
      setBetLabel(b,
        Number(number.value) === o.max
          ? "全下 " + o.max.toLocaleString()
          : "加注 " + (Number(number.value) || 0).toLocaleString());
  });
  roomUI.refreshRaise(own && connected && !pendingAction && !expired,decisionKey(state));
  if (pendingAction) $("turnNotice").textContent = pendingAction.confirmed?'已确认，正在同步':"提交中";
  else if (!connected||recovering) $("turnNotice").textContent = connectionStatus(typeof recovery==='undefined'?'waiting':recovery.mode);
  else if (own) $("turnNotice").textContent = "轮到你";
}
$("betSlider").oninput = () => {
  $("betAmount").value = $("betSlider").value;
  refreshBetControls();
};
$("betAmount").oninput = () => refreshBetControls();
for(const [id,direction]of [['betDecrease',-1],['betIncrease',1]])$(id).onclick=()=>{
  if($(id).disabled||!state)return;
  $('betAmount').value=stepBetAmount(state,$('betAmount').value,direction);refreshBetControls();
};
function timedFriends(r) {
  return r.gameMode === "friends" && r.tournament?.blindPolicy === "timed" && r.tournament.levelDurationSeconds > 0;
}
function updateTournamentClocks() {
  const t = state?.tournament;
  if (!t) return;
  if(state.roomControls?.pause?.state==='active'){$('levelClock').textContent='升盲已暂停';$('nextHandClock').textContent='牌桌已暂停';return;}
  const friends = state.gameMode === "friends";
  const now = clockServerAtReceipt + performance.now() - clockReceivedAt;
  $("levelClock").hidden = friends && !timedFriends(state);
  if (friends && !timedFriends(state)) {
    $("levelClock").textContent = "";
    $("nextHandClock").textContent = t.completed || t.cancelled
      ? ""
      : t.stopRequested
        ? "本手结束后停止"
        : state.phase === "showdown" && t.nextHandAt
          ? state.onlineCount === 0
            ? "暂停 · 等待玩家回桌"
            : "下一手 " + Math.max(0, Math.ceil((t.nextHandAt - now) / 1000))
          : "";
    return;
  }
  const format = (deadline) => {
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
    return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  };
  $("levelClock").textContent = !t.started
    ? "等待开始"
    : t.completed || t.cancelled
      ? ""
      : (timedFriends(state) && t.pendingLevel) || t.scheduledLevel > t.level || (t.nextLevelAt && now >= t.nextLevelAt)
        ? "升盲在下一手生效"
        : t.nextLevelAt
          ? "下级 " + format(t.nextLevelAt)
          : "最高级别";
  $("nextHandClock").textContent = friends
    ? t.completed || t.cancelled ? "" : t.stopRequested ? "本手结束后停止"
      : state.phase === "showdown" && t.nextHandAt
        ? state.onlineCount === 0 ? "暂停 · 等待玩家回桌"
          : "下一手 " + Math.max(0, Math.ceil((t.nextHandAt - now) / 1000))
        : ""
    : t.nextHandAt
    ? "下一手 " + format(t.nextHandAt)
    : t.stopRequested
      ? "本手结束后停止"
      : "";
  if(friends&&state.phase==='showdown'&&state.roomControls?.canContinue===false)$('nextHandClock').textContent='等待牌手返回或准备';
}
function renderTournament() {
  const t = state.tournament;
  const caps = t?.blindCaps || { earlySmall: Math.floor(state.initial / 20), small: Math.floor(state.initial / 10) };
  $("tournamentStrip").hidden = !t;
  $("tab-tournament").hidden = !t;
  document
    .querySelector(".tool-tabs")
    .style.setProperty("--tab-count", t ? 5 : 4);
  if (!t) {
    if ($("tab-tournament").getAttribute("aria-selected") === "true")
      selectPanel("activity");
    return;
  }
  const champion = state.players.find((p) => p.id === t.championId);
  $("tournamentTitle").textContent = t.completed
    ? `冠军 · ${champion?.name || "-"}`
    : t.cancelled
      ? "比赛已取消"
      : state.gameMode === "friends"
        ? "好友淘汰局"
        : state.gameMode === "turbo"
        ? "快速淘汰赛"
        : "标准淘汰赛";
  $("tournamentProgress").textContent =
    `第 ${t.level} 级 · ${t.remaining}/${t.entrants} 人${state.gameMode === "friends" ? "" : ` · 大盲底注 ${t.ante}`}`;
  const next = t.pendingLevel || t.nextLevel;
  $("nextLevelBlinds").textContent =
    !next || t.completed || t.cancelled
      ? ""
      : state.gameMode === "friends"
        ? `${t.pendingLevel ? "下一手盲注" : timedFriends(state) ? "下级盲注" : "下次淘汰后盲注"} ${next.small}/${next.big}`
        : `${t.pendingLevel ? "待生效" : "下级盲注"} ${next.small}/${next.big} · 底注 ${next.ante}`;
  $("tournamentPositionNote").textContent = [
    t.deadButton ? "死庄位" : "",
    t.deadSmallBlind ? "小盲空位" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  $("standings").replaceChildren(
    ...t.standings.map((p) => {
      const row = document.createElement("div");
      row.className = "standing-row";
      const place = document.createElement("span");
      place.textContent = p.removed ? '已移出' : p.place
        ? `${p.tied ? "并列 " : ""}${p.place}`
        : "在赛";
      const name = document.createElement("span");
      name.textContent = p.name;
      name.title = p.name;
      const stack = document.createElement("strong");
      stack.textContent = p.stack.toLocaleString();
      row.append(place, name, stack);
      return row;
    }),
  );
  $("eventRules").textContent =
    state.gameMode === "friends"
      ? `初始 ${state.initial} 筹码；${t.blindStructure === "gentle3" ? `每 ${t.levelDurationSeconds / 60} 分钟阶梯升盲，前 20 分钟上限 ${caps.earlySmall}/${caps.earlySmall * 2}（小盲为初始筹码的 1/20），最终最高 ${caps.small}/${caps.small * 2}（小盲为初始筹码的 1/10，向下取整），达到后不再升盲，一手最多升一级，下一手生效` : timedFriends(state) ? `从第一手起每 ${t.levelDurationSeconds} 秒盲注翻倍，下一手生效` : "每淘汰一人盲注翻倍，同手淘汰多人累计升级，下一手生效"}。无底注，第一手由房主开始，之后结算展示 5 秒自动续手。无晚报名。已淘汰牌手可申请初始筹码，申请时未淘汰的其他牌手须全员同意，任一拒绝则作废；通过后退出上帝模式，下一手入局，累计投入增加，升盲不重置。已结束不可申请。零筹码且已淘汰的玩家可开启上帝模式，仅旁观已发底牌。同手淘汰按本手起始筹码排序，同额并列。最后一人获胜，可在原房间再开一场。`
      : `初始 ${state.initial} 筹码；每 ${t.levelDurationSeconds / 60} 分钟升级。前两级无底注，其后大盲先付大盲再付底注。底注不抵扣跟注，不随人数减少。无晚报名、补筹码、复活或实时看底牌。同手淘汰按缴底注后起始筹码排序，同额并列。`;
  updateTournamentClocks();
}
function selectPanel(panel, focus = false) {
  if (document.querySelector(`[data-panel="${panel}"]`)?.hidden) return;
  document.querySelectorAll("[data-panel]").forEach((tab) => {
    const selected = tab.dataset.panel === panel;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $("panel-" + tab.dataset.panel).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  if (panel === "history") renderHistoryPanel();
  if(state && document.body.classList.contains('in-game'))roomUI.openTools(panel);
  if(panel==='insight')renderInsight();
  if (panel === "results" && state) renderRoundRecords(state);
}
const toolTabs = [...document.querySelectorAll("[data-panel]")];
toolTabs.forEach((tab) => {
  tab.onclick = () => selectPanel(tab.dataset.panel);
  tab.onkeydown = (event) => {
    const offset =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!offset && !["Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const visible = toolTabs.filter((item) => !item.hidden),
      index = visible.indexOf(tab);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? visible.length - 1
          : (index + offset + visible.length) % visible.length;
    selectPanel(visible[next].dataset.panel, true);
  };
});
document.querySelectorAll("[data-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      mode = b.dataset.mode;
      document
        .querySelectorAll("[data-mode]")
        .forEach((x) => x.classList.toggle("selected", x === b));
      $("settings").hidden = mode === "join";
      $("turnSeconds").disabled = mode === "join";
      configureGameSettings();
      $("joinField").hidden = mode === "create";
    }),
);
let previousGameMode = "friends",
  friendsSettings,
  tournamentTurnSeconds = "60";
function configureGameSettings() {
  const friends = $("gameMode").value === "friends",
    joining = mode === "join";
  $("gameMode").disabled = joining;
  $("blindIntervalField").hidden = joining || !friends;
  $("blindMinutes").disabled = joining || !friends;
  $("chips").disabled = joining;
  $("chips").min = 100;
  $("small").disabled = $("big").disabled = joining || !friends;
  const smallCap = Math.floor(Number($("chips").value) / 100) * 5;
  $("small").max = Math.max(5, smallCap);
  $("big").max = Math.max(10, smallCap * 2);
  $("formatRules").hidden = joining;
  $("formatRules").textContent = friends
    ? `每 ${$("blindMinutes").value || 3} 分钟阶梯升盲，下一手生效 · 无底注 · 补筹码需全员同意`
    : "冻结赛 · 前两级无底注 · 不可补筹码或复活";
}
$("gameMode").onchange = () => {
  const value = $("gameMode").value;
  if (previousGameMode === "friends" && value !== "friends") {
    friendsSettings = {
      chips: $("chips").value,
      small: $("small").value,
      big: $("big").value,
      turnSeconds: $("turnSeconds").value,
    };
    $("chips").value = 5000;
    $("turnSeconds").value = tournamentTurnSeconds;
  }
  if (previousGameMode !== "friends" && value === "friends")
    tournamentTurnSeconds = $("turnSeconds").value;
  if (value === "friends" && friendsSettings)
    for (const [key, value] of Object.entries(friendsSettings))
      $(key).value = value;
  if (value !== "friends") {
    $("small").value = 25;
    $("big").value = 50;
  }
  previousGameMode = value;
  configureGameSettings();
};
$("blindMinutes").oninput = configureGameSettings;
$("chips").oninput = configureGameSettings;
const back = $("back");
back.onclick = () => {
  closeReplay();rejectControlRequests('已离开牌桌');
  roomUI.closeTools();
  stopPlayerLatency();
  feedback.active = false;
  feedback.reset();
  pendingAction = null;
  clearInterval(countdownLoop);
  send("leave");
  state = null;
  playerPanel.close();forecastController.reset();
  historyCache.reset();
  sessionStorage.removeItem(key);
  sessionStorage.removeItem(roomKey);
  $("game").hidden = true;
  document.body.classList.remove("in-game");
  $("lobby").hidden = false;
  send("archives");
};
$("entry").onsubmit = (e) => {
  e.preventDefault();
  setWatchIntent(null);$('watchStatus').hidden=true;
  send(mode, {
    room: $("roomCode").value,
    chips: Number($("chips").value),
    small: Number($("small").value),
    big: Number($("big").value),
    turnSeconds: Number($("turnSeconds").value),
    gameMode: $("gameMode").value,
    ...($("gameMode").value === "friends" ? { blindMinutes: Number($("blindMinutes").value) } : {}),
  });
};
$("rebuy").onsubmit = (e) => {
  e.preventDefault();
  send("rebuy", { amount: Number($("rebuyAmount").value) });
};
$("invite").onclick = async () => {
  try {
    await navigator.clipboard.writeText(location.origin + "/?room=" + state.id);
    toast("邀请链接已复制");
  } catch {
    toast("房间号：" + state.id);
  }
};
const invited = new URLSearchParams(location.search).get("room");
if (invited) {
  document.querySelector('[data-mode="join"]').click();
  $("roomCode").value = invited;
}
document.querySelectorAll("[data-auth-mode]").forEach(
  (b) =>
    (b.onclick = () => {
      setAuthMode(b.dataset.authMode);
      $("authError").hidden = true;
    }),
);
$("authForm").onsubmit = async (event) => {
  event.preventDefault();
  $("authSubmit").disabled = true;
  $("authError").hidden = true;
  try {
    const result = await api(`/api/auth/${authMode}`, "POST", {
      username: $("authUsername").value,
      password: $("authPassword").value,
      nickname: $("authNickname").value,
      inviteCode: $("authInvite").value,
      avatar: authMode === "register" ? registerAvatar : undefined,
    });
    $("authForm").reset();
    registerAvatar = null;
    showAvatar($("registerAvatarPreview"), $("registerAvatarFallback"), null);
    await activate(result.user);
  } catch (error) {
    $("authError").textContent = error.message;
    $("authError").hidden = false;
  } finally {
    $("authSubmit").disabled = false;
  }
};
$("logout").onclick = async () => {
  try {
    await api("/api/auth/logout", "POST", {});
  } catch (error) {
    if (error.status !== 401) return toast(error.message);
  }
  sessionStorage.removeItem(key);
  sessionStorage.removeItem(roomKey);
  showLogin();
};
api("/api/auth/me")
  .then(({ user }) => activate(user))
  .catch((error) =>
    showLogin(error.status === 401 ? "" : "暂时无法连接服务器"),
  );
