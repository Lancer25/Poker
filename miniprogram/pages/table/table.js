const stages = {
  waiting: "等待好友",
  preflop: "翻牌前",
  flop: "翻牌",
  turn: "转牌",
  river: "河牌",
  showdown: "本手结算",
  ended: "本场已结束",
};
const { seatLayout } = require("../../utils/table-layout.js");
const { avatarUrl, avatarData } = require("../../utils/avatar.js");
const {
  preferences,
  decisionKey,
  betOptions,
  betImpact,
  chipUnit,
  transitions,
  WarningClock,
  HapticClock,
  winnerIds,
} = require("../../utils/table-experience.js");
const { playSound } = require("../../utils/table-audio.js");
const { HistoryCache, LiveMetrics } = require("../../utils/room-history.js");
const {latencyBadge}=require('../../utils/player-latency.js');
const {ForecastController}=require('../../utils/forecast-state.js');
const suit = { s: "♠", h: "♥", d: "♦", c: "♣" };
function timedFriends(r) {
  return r.gameMode === "friends" && r.tournament?.blindPolicy === "timed" && r.tournament.levelDurationSeconds > 0;
}
function cards(values, bestCards = []) {
  return values.map((v) => ({
    best: bestCards.includes(v),
    rank: v === "??" ? "" : v[0] === "T" ? "10" : v[0],
    suit: v === "??" ? "" : suit[v[1]],
    text: v === "??" ? "" : (v[0] === "T" ? "10" : v[0]) + suit[v[1]],
    red: v[1] === "h" || v[1] === "d",
    colorSuit: v[1],
    back: v === "??",
  }));
}
function remember(token) {
  const stored = wx.getStorageSync("holdem-archive");
  const tokens = Array.isArray(stored) ? stored : [];
  wx.setStorageSync(
    "holdem-archive",
    [...tokens.filter((t) => t !== token), token].slice(-100),
  );
}
function historyView(r, selected) {
  const list =
    selected === "current"
      ? r.history || []
      : (r.completedRounds || []).find((s) => String(s.number) === selected)
          ?.history || [];
  return list.map((hand) => ({
    ...hand,
    shownWinners:(Array.isArray(hand.shownWinners)?hand.shownWinners:[]).map(w=>({...w,shownCards:cards(w.cards)})),
    shownPlayers:(Array.isArray(hand.shownPlayers)?hand.shownPlayers:[]).map(w=>({...w,shownCards:cards(w.cards)})),
    shownWinnerNote:Array.isArray(hand.shownWinners)?'本手无公开亮牌记录':'旧记录未保存亮牌',
    boardCards: cards(Array.isArray(hand.board) ? hand.board : []),
    boardNote: !Array.isArray(hand.board)
      ? "旧记录未保存公共牌"
      : hand.board.length
        ? `公共牌 · ${hand.board.length} 张`
        : "未发公共牌：本手在翻牌前结束",
  }));
}
Page({
  data: {
    connected: false,
    user: null,
    botCountIndex:0,
    botNumbers:[],
    authMode: "login",
    authUsername: "",
    authPassword: "",
    authNickname: "",
    authInvite: "",
    authError: "",
    authBusy: false,
    authAvatar: null,
    authAvatarPreview: "",
    avatarBusy: false,
    mode: "create",
    gameMode: "friends",
    gameModeIndex: 0,
    gameModes: [
      { label: "好友淘汰局 · 阶梯升盲", value: "friends" },
      { label: "标准淘汰赛 · 10 分钟升盲", value: "standard" },
      { label: "快速淘汰赛 · 5 分钟升盲", value: "turbo" },
    ],
    code: "",
    chips: "10000",
    small: "10",
    big: "20",
    turnSeconds: "30",
    blindMinutes: "3",
    rebuy: "1000",
    raise: "20",
    room: null,
    seats: [],
    winnerFocus: [],
    winnerBoard: [],
    archive: [],
    history: [],
    historyLoading: false,
    historyError: "",
    historyMore: false,
    activePanel: "activity",
    hintsEnabled: true,
    hintExpanded: false,
    forecastValue:{status:'hidden'},
    forecastExpanded:false,
    playerPanelOpen:false,
    playerProfile:null,
    profileError:'',
    profileLoading:false,
    clockSeconds: null,
    clockUrgent: false,
    experience: preferences(),
    settingsOpen: false,
    pendingAction: false,
    pendingReveal: false,
    effect: "",
    pendingRestart: false,
    rematchMode: "reset",
    rematchModeIndex: 0,
    rematchOptions: [],
    historyRound: "current",
    historyRoundIndex: 0,
    historyRoundOptions: [],
    previousRounds: [],
  },
  onLoad(options) {
    this.warning = new WarningClock();
    this.setData({
      hintsEnabled: wx.getStorageSync("holdem-hand-insights") !== "off",
      experience: preferences(wx.getStorageSync("holdem-experience")),
    });
    if (options.room) this.setData({ mode: "join", code: options.room });
    this.restoreAccount();
  },
  onUnload() {
    this.clearControlPending();
    this.resetHistory();
    clearInterval(this.latencyTimer);
    this.clearFeedback();
    try {
      this.audio?.destroy();
    } catch {}
    clearInterval(this.clockTimer);
    this.stopped = true;
    clearTimeout(this.retry);
    if (this.socket) this.socket.close();
  },
  openAccount() {
    wx.navigateTo({ url: "/pages/account/account" });
  },
  async chooseRegisterAvatar(e) {
    this.setData({ avatarBusy: true });
    try {
      const avatar = await avatarData(e.detail.avatarUrl);
      this.setData({
        authAvatar: avatar,
        authAvatarPreview: e.detail.avatarUrl,
      });
    } catch (error) {
      this.setData({ authError: error.message });
    } finally {
      this.setData({ avatarBusy: false });
    }
  },
  clearRegisterAvatar() {
    this.setData({ authAvatar: null, authAvatarPreview: "" });
  },
  requestApi(url, method = "GET", data) {
    const token = wx.getStorageSync("holdem-account-token");
    return new Promise((resolve, reject) =>
      wx.request({
        url: getApp().globalData.apiUrl + url,
        method,
        data,
        header: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        success: (r) =>
          r.statusCode >= 200 && r.statusCode < 300
            ? resolve(r.data)
            : reject(
                Object.assign(Error(r.data.error || "请求失败"), {
                  status: r.statusCode,
                }),
              ),
        fail: () => reject(Error("暂时无法连接服务器")),
      }),
    );
  },
  async restoreAccount() {
    if (!wx.getStorageSync("holdem-account-token")) return;
    try {
      const { user } = await this.requestApi("/api/auth/me");
      await this.activateAccount(user);
    } catch (e) {
      if (e.status === 401) wx.removeStorageSync("holdem-account-token");
      else this.setData({ authError: e.message });
    }
  },
  async activateAccount(user) {
    this.resetHistory();
    this.setData({
      user,
      authPassword: "",
      authError: "",
      authAvatar: null,
      authAvatarPreview: "",
    });
    const stored = wx.getStorageSync("holdem-archive");
    const tokens = [
      ...new Set(
        [
          wx.getStorageSync("holdem-token"),
          ...(Array.isArray(stored) ? stored.slice().reverse() : []),
        ].filter(Boolean),
      ),
    ].slice(0, 100);
    if (tokens.length) {
      try {
        const result = await this.requestApi("/api/auth/claim", "POST", {
          tokens,
        });
        if (result.hostRecovered?.length)
          wx.showToast({ title: "旧房主权限已恢复", icon: "none" });
      } catch {
        wx.showToast({ title: "旧场次关联未完成", icon: "none" });
      }
    }
    if (!this.stopped) this.connect();
  },
  authMode(e) {
    this.setData({ authMode: e.currentTarget.dataset.mode, authError: "" });
  },
  async submitAuth() {
    if (this.data.authBusy) return;
    this.setData({ authBusy: true, authError: "" });
    const d = this.data;
    try {
      const result = await this.requestApi("/api/auth/" + d.authMode, "POST", {
        username: d.authUsername,
        password: d.authPassword,
        nickname: d.authNickname,
        avatar: d.authMode === "register" ? d.authAvatar : undefined,
        inviteCode: d.authInvite,
      });
      wx.setStorageSync("holdem-account-token", result.token);
      await this.activateAccount(result.user);
    } catch (e) {
      this.setData({ authError: e.message });
    } finally {
      this.setData({ authBusy: false });
    }
  },
  showLogin(message = "") {
    this.clearControlPending();
    this.resetHistory();
    clearInterval(this.latencyTimer);
    this.clearFeedback();
    wx.removeStorageSync("holdem-account-token");
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
    this.setData({
      user: null,
      room: null,
      history: [],
      previousRounds: [],
      historyRoundOptions: [],
      activePanel: "activity",
      pendingAction: false,
      pendingRestart: false,
      archive: [],
      seats: [],
      board: [],
      myCards: [],
      me: null,
      connected: false,
      authMode: "login",
      authPassword: "",
      authAvatar: null,
      authAvatarPreview: "",
      authError: message,
    });
  },
  async logout() {
    try {
      await this.requestApi("/api/auth/logout", "POST", {});
    } catch (e) {
      if (e.status !== 401)
        return wx.showToast({ title: e.message, icon: "none" });
    }
    wx.removeStorageSync("holdem-token");
    wx.removeStorageSync("holdem-room");
    this.showLogin();
  },
  connect() {
    if (!this.data.user || this.stopped) return;
    clearInterval(this.latencyTimer);
    this.liveMetrics = new LiveMetrics();
    let ready = false;
    const socket = wx.connectSocket({ url: getApp().globalData.socketUrl });
    this.socket = socket;
    socket.onOpen(() => {
      if (this.socket !== socket) return;
      socket.send({
        data: JSON.stringify({
          type: "authenticate",
          compactState: true,
          token: wx.getStorageSync("holdem-account-token"),
        }),
      });
    });
    socket.onClose(() => {
      if (this.socket !== socket) return;
      this.clearControlPending();
      clearInterval(this.latencyTimer);
      this.clearFeedback();
      this.setData({
        connected: false,
        pendingAction: false,
        pendingRestart: false,
      });
      this.refreshLatencyBadges();
      if (!this.stopped && this.data.user)
        this.retry = setTimeout(() => this.connect(), 1500);
    });
    socket.onError(() => {
      if (this.socket === socket) {
        this.clearControlPending();
        this.clearFeedback();
        this.setData({
          connected: false,
          pendingAction: false,
          pendingRestart: false,
        });
        this.refreshLatencyBadges();
      }
    });
    socket.onMessage((event) => {
      if (this.socket !== socket) return;
      const msg = JSON.parse(event.data);
      if(msg.type==='player_latency'){this.receivePlayerLatency(msg);return;}
      if (msg.type === "account") {
        if (this.data.user?.id !== msg.user.id) this.resetHistory();
        this.setData({ user: msg.user, connected: true });
        if (!ready) {
          ready = true;
          this.latencyTimer = setInterval(() => {
            if (this.socket === socket && this.data.connected && !this.hidden)
              this.send("latency", this.liveMetrics.ping(Date.now()));
          }, 15000);
          const room = wx.getStorageSync("holdem-room");
          const token = wx.getStorageSync("holdem-token");
          const watching=wx.getStorageSync('holdem-watch-intent');
          if(watching)this.send('watch',{room:watching});
          else if (room) this.send("resume", { room });
          else if (token) this.send("resume", { token });
          this.send("archives");
        }
      }
      if (msg.type === "latency") {
        const sample = this.liveMetrics.receive(msg, Date.now());
        if (sample && this.data.connected) this.send("telemetry", sample);
      }
      if(msg.type==='roomcontrol_result'){if(msg.requestId===this.pendingControlId)this.clearControlPending();return;}
      if(msg.type==='spectate_pending'){
        if(msg.status==='pending'){wx.setStorageSync('holdem-watch-intent',String(msg.room));this.setData({watchRoom:String(msg.room),watchStatus:'等待房主审批观战'});}
        else{wx.removeStorageSync('holdem-watch-intent');this.setData({watchRoom:'',watchStatus:''});if(msg.message)wx.showToast({title:msg.message,icon:'none'});}return;
      }
      if (msg.type === "spectate_offer" && !this.watchPrompt) {
        this.watchPrompt=true;
        wx.showModal({title:'进入观战',content:msg.message,confirmText:'观战',cancelText:'取消',
          success:result=>{if(result.confirm && this.socket===socket && this.data.connected && this.data.user){wx.setStorageSync('holdem-watch-intent',String(msg.room));this.send('watch',{room:msg.room});}},
          complete:()=>{this.watchPrompt=false;}});
      }
      if (msg.type === "session") {
        wx.setStorageSync("holdem-token", msg.token);
        remember(msg.token);
      }
      if (msg.type === "archives")
        this.setData({
          archive: msg.archive.map((r) => ({
            ...r,
            statusLabel:
              r.statusLabel ||
              {
                waiting: "等待开局",
                showdown: "本手已结算",
                ended: "本场已结束",
              }[r.phase] ||
              "正在打牌",
          })),
        });
      if (msg.type === "error") {
        if(msg.scope==='roomcontrol'){if(msg.requestId===this.pendingControlId)this.clearControlPending();wx.showToast({title:msg.message,icon:'none'});return;}
        this.setData({pendingReveal:false});
        this.liveMetrics?.cancelActions();
        this.setData({ pendingAction: false, pendingRestart: false });
        if (msg.code === "auth_required") return this.showLogin(msg.message);
        wx.showToast({ title: msg.message, icon: "none" });
        if (
          msg.message.includes("身份已失效") ||
          msg.code === "room_forbidden"
        ) {
          wx.removeStorageSync("holdem-token");
          wx.removeStorageSync("holdem-room");
          this.resetHistory();
          this.setData({ room: null });
          this.closePlayerPanel();this.forecastController?.reset();
          this.send("archives");
        }
      }
      if (msg.type === "state") {
        wx.removeStorageSync('holdem-watch-intent');this.setData({watchRoom:'',watchStatus:''});
        if (
          this.data.room?.id === msg.room.id &&
          msg.room.serverTime < this.data.room.serverTime
        )
          return;
        wx.setStorageSync("holdem-room", msg.room.id);
        this.renderRoom(msg.room,msg.actionReceipt);
      }
    });
  },
  send(type, data = {}) {
    if (!this.data.connected)
      return wx.showToast({ title: "连接尚未就绪", icon: "none" });
    if (["fold", "check", "call", "raise", "allin"].includes(type)) {
      if (
        this.data.pendingAction ||
        !this.data.actionable ||
        this.data.clockSeconds === 0
      )
        return;
      this.pendingKey = decisionKey(this.data.room);
      this.liveMetrics ||= new LiveMetrics();
      const actionId=this.liveMetrics.startAction(Date.now());
      data={...data,actionId,requestId:actionId,decision:this.data.room.actionContext};
      this.setData({ pendingAction: true });
    }
    if (type === "restart") {
      if (this.data.pendingRestart) return;
      this.setData({ pendingRestart: true });
    }
    if(type==='leave')this.liveMetrics?.cancelActions();
    this.socket.send({
      data: JSON.stringify({ type, ...data }),
      fail: () => {
        this.setData({
          connected: false,
          pendingAction: false,
          pendingRestart: false,
        });
        this.socket?.close();
      },
    });
  },
  cancelWatch(){if(this.data.connected)this.send('watchcancel');else{wx.removeStorageSync('holdem-watch-intent');this.setData({watchRoom:'',watchStatus:''});}},
  clearControlPending(){clearTimeout(this.controlTimer);this.pendingControlId=null;this.setData({controlPending:false});},
  controlAction(e){
    const r=this.data.room,c=r?.roomControls,command=e.currentTarget.dataset.command;if(!c||!this.data.connected||this.data.controlPending||r.phase==='ended')return;
    const payload={round:c.round,version:c.version,command,controlRequestId:'n-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)};
    if(command==='ready'||command==='away'){payload.value=!!e.detail.value;payload.readyEpoch=c.readyEpoch;}
    if(command==='pausevote'){payload.request=c.pause?.id;payload.value=e.currentTarget.dataset.value==='yes';}
    if(command==='pausecancel')payload.request=c.pause?.id;
    if(command==='spectatorapprove'||command==='spectatorreject')payload.request=e.currentTarget.dataset.request;
    if(command==='settings'){
      const field=e.currentTarget.dataset.field;
      payload.settings=field==='admission'?{admission:['approval','open','closed'][Number(e.detail.value)]}:field==='reveal'?{reveal:e.detail.value?'realtime':'public'}:field==='requireReady'?{requireReady:!!e.detail.value}:{admission:'approval',reveal:'public',requireReady:false};
    }
    this.pendingControlId=payload.controlRequestId;this.setData({controlPending:true});this.send('roomcontrol',payload);
    this.controlTimer=setTimeout(()=>{if(this.pendingControlId===payload.controlRequestId){this.clearControlPending();wx.showToast({title:'等待确认超时，请刷新状态',icon:'none'});}},10000);
  },
  input(e) {
    if (e.currentTarget.dataset.field === "raise")
      return this.updateRaise(e.detail.value);
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  mode(e) {
    this.setData({ mode: e.currentTarget.dataset.mode });
  },
  gameModeChange(e) {
    const index = Number(e.detail.value),
      gameMode = this.data.gameModes[index]?.value;
    if (!gameMode) return;
    if (this.data.gameMode === "friends" && gameMode !== "friends")
      this.friendsSettings = {
        chips: this.data.chips,
        small: this.data.small,
        big: this.data.big,
        turnSeconds: this.data.turnSeconds,
      };
    if (this.data.gameMode !== "friends" && gameMode === "friends")
      this.tournamentTurnSeconds = this.data.turnSeconds;
    const settings =
      gameMode === "friends"
        ? this.friendsSettings || { chips: "10000", small: "10", big: "20", turnSeconds: "30" }
        : {
            chips: this.data.gameMode === "friends" ? "5000" : this.data.chips,
            small: "25",
            big: "50",
            turnSeconds: this.data.gameMode === "friends" ? this.tournamentTurnSeconds || "60" : this.data.turnSeconds,
          };
    this.setData({ gameModeIndex: index, gameMode, ...settings });
  },
  enter() {
    const d = this.data;
    this.send(d.mode, {
      room: d.code,
      chips: Number(d.chips),
      small: Number(d.small),
      big: Number(d.big),
      turnSeconds: Number(d.turnSeconds),
      gameMode: d.gameMode,
      ...(d.gameMode === "friends" ? { blindMinutes: Number(d.blindMinutes) } : {}),
    });
  },
  renderRoom(r,actionReceipt) {
    const renderStarted = Date.now();
    const revealKey=`${r.id}:${r.roundNumber||1}:${r.hand}`;
    if(!r.canShowCards || this.pendingRevealKey!==revealKey)this.setData({pendingReveal:false});
    if(this.liveRoom?.id!==r.id){this.latencyPacketAt=0;this.latencyPacketReceivedAt=0;}
    const caps = r.tournament?.blindCaps || { earlySmall: Math.floor(r.initial / 20), small: Math.floor(r.initial / 10) };
    this.historyCache ||= new HistoryCache();
    r = this.historyCache.sync(this.historyIdentity(), r);
    const previous = this.data.room,
      sameDecision = decisionKey(previous) === decisionKey(r);
    const sameRound =
      previous?.id === r.id &&
      (previous.roundNumber || 1) === (r.roundNumber || 1);
    const historyRound = sameRound ? this.data.historyRound : "current";
    this.liveRoom = r;
    const { history: omittedHistory, completedRounds: omittedRounds, ...lightRoom } = r;
    const rematchOptions = [
      { label: `重置为 ${r.initial} 筹码`, value: "reset" },
      ...(r.canCarryRound === false
        ? []
        : [{ label: "保留当前筹码", value: "carry" }]),
    ];
    const events = this.hidden ? [] : transitions(this.feedbackRoom, r);
    if (!sameDecision) this.raiseEdited = false;
    const betting = betOptions(r);
    this.clockReceivedAt = Date.now();
    const me = r.players.find((p) => p.id === r.me) || {...r.spectator,cards:[],stack:0};
    const actionable = !r.flopReveal && !!r.players[r.turn] && r.players[r.turn].id === r.me;
    const idle = ["waiting", "showdown"].includes(r.phase);
    const seated = r.tournament?.started
      ? r.players.filter(
          (p) =>
            !p.removed && (!p.eliminated ||
            (["showdown", "ended"].includes(r.phase) && p.inHand)),
        )
      : r.players.filter(p=>!p.removed);
    const seats = seatLayout(seated, r.me).map(({ x, y, index }) => {
      const p = seated[index],
        i = r.players.indexOf(p);
      return {
        key: i,
        playerId:p.id,
        latency:latencyBadge(this.data.connected?p.connection:null,r.serverTime||Date.now()),
        color: [
          "#668bab",
          "#be8063",
          "#a079a0",
          "#67947c",
          "#b59b61",
          "#739fa1",
          "#ab6b72",
        ][i % 7],
        style: `left:${x}%;top:${y}%;`,
        empty: !p,
        name: p ? (p.seatNumber?`${p.seatNumber} · `:'')+p.name : "空座",
        stack: p ? p.stack : "",
        totalBet: p.totalBet || 0,
        largeTotalBet: String(p.totalBet || 0).length >= 7,
        avatar: p ? p.name.slice(0, 1) : "",
        avatarUrl: avatarUrl(p.avatar),
        mine: !!p && p.id === r.me,
        dealer: r.dealer === i,
        smallBlind: r.smallBlind === i,
        bigBlind: r.bigBlind === i,
        active: r.turn === i,
        folded: !!p && p.folded,
        winner:
          ["showdown", "ended"].includes(r.phase) &&
          winnerIds(r).includes(p.id),
        status: p
          ? p.godMode
            ? "上帝模式"
            : p.folded
              ? "弃牌"
              : (r.phase === "showdown" || r.tournament?.completed) &&
                  p.handLabel
                ? p.handLabel + (p.eliminated ? " · 淘汰" : "")
                : p.inHand && p.stack === 0
                  ? "ALL IN"
                  : p.bet
                    ? "本轮 " + p.bet
                    : ""
          : "",
        cards: p ? cards(p.cards) : [],
      };
    });
    const requests = r.requests.map((req) => ({
      ...req,
      name: r.players.find((p) => p.id === req.player)?.name || '',
    }));
    this.latencyFingerprints=new Map(seats.map(s=>[s.playerId,JSON.stringify(s.latency)]));
    this.setData({
      room: { ...lightRoom, history: [], completedRounds: [] },
      pendingRestart:
        this.data.pendingRestart && sameRound && r.phase === "ended",
      rematchMode:
        sameRound && r.canCarryRound !== false
          ? this.data.rematchMode
          : "reset",
      rematchModeIndex:
        sameRound && r.canCarryRound !== false ? this.data.rematchModeIndex : 0,
      rematchOptions,
      historyRound,
      tournament: r.tournament || null,
      tournamentTitle: r.tournament?.completed
        ? "冠军 · " +
          (r.players.find((p) => p.id === r.tournament.championId)?.name || "-")
        : r.tournament?.cancelled
          ? "比赛已取消"
          : r.gameMode === "friends"
            ? "好友淘汰局"
            : r.gameMode === "turbo"
            ? "快速淘汰赛"
            : "标准淘汰赛",
      godHands: r.godMode
        ? r.players
            .filter((p) => p.id !== r.me && p.cards.length && p.cards.every((c) => c !== "??"))
            .map((p) => ({
              id: p.id,
              name: p.name,
              folded: p.folded,
              cards: cards(p.cards),
            }))
        : [],
      nextLevelBlinds:
        (r.tournament?.pendingLevel || r.tournament?.nextLevel) &&
        !r.tournament.completed &&
        !r.tournament.cancelled
          ? r.gameMode === "friends"
            ? `${r.tournament.pendingLevel ? "下一手盲注" : timedFriends(r) ? "下级盲注" : "下次淘汰后盲注"} ${(r.tournament.pendingLevel || r.tournament.nextLevel).small}/${(r.tournament.pendingLevel || r.tournament.nextLevel).big}`
            : `${r.tournament.pendingLevel ? "待生效" : "下级盲注"} ${(r.tournament.pendingLevel || r.tournament.nextLevel).small}/${(r.tournament.pendingLevel || r.tournament.nextLevel).big} · 底注 ${(r.tournament.pendingLevel || r.tournament.nextLevel).ante}`
          : "",
      eventRules: r.gameMode === "friends"
        ? `初始 ${r.initial} 筹码；${r.tournament?.blindStructure === "gentle3" ? `每 ${r.tournament.levelDurationSeconds / 60} 分钟阶梯升盲，前 20 分钟上限 ${caps.earlySmall}/${caps.earlySmall * 2}（小盲为初始筹码的 1/20），最终最高 ${caps.small}/${caps.small * 2}（小盲为初始筹码的 1/10，向下取整），达到后不再升盲，一手最多升一级，下一手生效` : timedFriends(r) ? `从第一手起每 ${r.tournament.levelDurationSeconds} 秒盲注翻倍，下一手生效` : "每淘汰一人盲注翻倍，同手淘汰多人累计升级，下一手生效"}。无底注，第一手由房主开始，之后结算展示 5 秒自动续手。无晚报名。已淘汰牌手可申请初始筹码，申请时未淘汰的其他牌手须全员同意，任一拒绝则作废；通过后退出上帝模式，下一手入局，累计投入增加，升盲不重置。已结束不可申请。零筹码且已淘汰的玩家可开启上帝模式，仅旁观已发底牌。同手淘汰按本手起始筹码排序，同额并列。最后一人获胜，可在原房间再开一场。`
        : "无晚报名、补筹码、复活或实时看底牌。底注不抵扣跟注。同手淘汰按缴底注后起始筹码排序，同额并列。",
      insight: r.insight || null,
      seats,
      me,
      board: cards(r.flopReveal?[...r.board,...Array(Math.max(0,3-r.board.length)).fill('??')]:r.board, r.insight?.bestCards || []),
      myCards: cards(
        me.cards.length ? me.cards : ["??", "??"],
        r.insight?.bestCards || [],
      ),
      turnNotice:
        r.gameMode==='friends' && r.phase==='waiting' && r.seating && !r.godMode && !r.spectating ? r.seating.status==='idle'?'等待房主开始比赛':r.seating.status==='ready'?'座位已确认，即将自动发牌':'等待全员掷骰排座' :
        r.flopReveal ? `翻牌中 · ${r.board.length}/3` :
        r.spectating ? r.phase==='ended' ? '观战中 · 等待房主再开一场' : '观战模式 · 实时底牌' :
        r.phase === "waiting" && (r.roundNumber || 1) > 1
          ? r.host === r.me
            ? "本场已准备，点击开始发牌"
            : "等待房主发牌"
          : r.godMode
            ? "上帝模式 · 仅旁观"
            : r.tournament && me.eliminated
              ? `已淘汰 · 第 ${me.place} 名 · 旁观中`
              : actionable
                ? "轮到你行动"
                : r.players[r.turn]
                  ? `等待 ${r.players[r.turn].name} 行动`
                  : r.phase === "ended"
                    ? "本场已结束，等待房主再开一场"
                    : idle && r.hand
                      ? "本手已结算"
                      : "等待好友入座",
      stage:
        r.flopReveal ? `翻牌中 ${r.board.length}/3` :
        r.phase === "waiting" && (r.roundNumber || 1) > 1
          ? "等待发牌"
          : r.tournament?.completed
            ? "冠军已产生"
            : r.tournament?.cancelled
              ? "比赛已取消"
              : stages[r.phase],
      isHost: r.host === r.me,
      hostName: r.players.find((p) => p.id === r.host)?.name || "-",
      idle,
      actionable,
      call: Math.min(r.toCall, me.stack),
      raise:
        sameDecision && this.raiseEdited
          ? this.data.raise
          : String(Math.min(betting.min, betting.max)),
      betMin: Math.min(betting.min, betting.max),
      betMax: betting.max,
      betUnit: chipUnit(r),
      myReady:!!r.roomControls?.seats?.find(p=>p.id===r.me)?.ready,
      myAway:!!r.roomControls?.seats?.find(p=>p.id===r.me)?.away||r.roomControls?.seats?.find(p=>p.id===r.me)?.pendingAway===true,
      myControlEligible:!!r.roomControls?.seats?.find(p=>p.id===r.me)?.eligible,
      canPauseVote:!!r.roomControls?.pause&&r.roomControls.pause.state!=='active'&&r.roomControls.pause.voters.includes(r.me)&&!r.roomControls.pause.approvals.includes(r.me),
      canCancelPause:!!r.roomControls?.pause&&r.roomControls.pause.state!=='active'&&(r.roomControls.pause.requestedBy===r.me||r.roomControls.canManage),
      admissionIndex:Math.max(0,['approval','open','closed'].indexOf(r.roomControls?.settings?.admission)),
      betImpact:betImpact(r,sameDecision&&this.raiseEdited?this.data.raise:String(Math.min(betting.min,betting.max))),
      betSliderValue: sameDecision && this.raiseEdited
        ? Math.max(
            Math.min(betting.min, betting.max),
            Math.min(betting.max, Number(this.data.raise) || 0),
          )
        : Math.min(betting.min, betting.max),
      betPresets: [
        {
          label: "最小",
          value: Math.min(betting.min, betting.max),
          disabled: !betting.canRaise,
        },
        { label: "½ 底池", value: betting.half, disabled: !betting.canRaise },
        { label: "底池", value: betting.pot, disabled: !betting.canRaise },
        { label: "全下", value: betting.max, disabled: !betting.canAllin },
      ],
      pendingAction:
        this.data.pendingAction && this.pendingKey === decisionKey(r),
      raiseDisabled: !betting.canRaise && !betting.canAllin,
      allinDisabled: !r.canRaise && me.stack + me.bet > r.currentBet,
      startDisabled: r.players.filter((p) => !p.removed && p.stack > 0).length < 2 || (r.gameMode==='friends' && (r.seating?.status==='rolling' || Number.isFinite(r.seating?.autoStartAt))),
      canHostStart:
        r.host === r.me &&
        (r.tournament
          ? r.phase === "waiting"
          : idle),
      requests,
      canManageBots:this.data.user?.role==='admin'&&r.host===r.me&&!!r.botSetup?.canManage,
      botNumbers:Array.from({length:Math.min(8,r.botSetup?.capacity||0)},(_,i)=>String(i+1)),
      botCountIndex:Math.min(this.data.botCountIndex||0,Math.max(0,Math.min(8,r.botSetup?.capacity||0)-1)),
      seatDice:r.seating ? {...r.seating,listHeight:Math.min(5,r.seating.entries.length)*88,entries:r.seating.entries.map(e=>({...e,diceImages:(e.dice.length?e.dice:[0,0]).map(n=>n?`/assets/dice-${n}.svg`:'/assets/dices.svg')}))} : null,
      rebuyQueued:requests.some(req=>req.kind==='friend-rebuy' && req.player===r.me && req.status==='approved'),
      payout: r.pots
        .map(
          (p) =>
            p.winners.join("、") + (p.refund ? "退回 " : "赢得 ") + p.amount,
        )
        .join(" · "),
    }, () => {
      const renderMs=Date.now()-renderStarted;
      this.liveMetrics?.rendered(renderMs);
      const sample=this.liveMetrics?.actionRendered(actionReceipt,Date.now(),renderMs);
      if(sample && this.data.connected && !this.hidden && !this.stopped)this.send('action_telemetry',sample);
    });
    if (!sameRound) {
      this.historyFingerprint = "";
      this.roundsFingerprint = "";
      this.setData({ history: [], previousRounds: [], historyRoundOptions: [], historyRoundIndex: 0, historyLoading: false, historyError: "", historyMore: false });
    }
    this.refreshHistory();
    this.startBadgeClock();
    this.refreshWinnerFocus(r);
    this.liveMetrics?.rendered(Date.now() - renderStarted);
    if (!this.clockTimer)
      this.clockTimer = setInterval(() => this.tickCountdown(), 250);
    if (!r.tournament && this.data.activePanel === "tournament")
      this.setData({ activePanel: "activity" });
    this.tickCountdown();
    this.syncForecast();this.syncPlayerPanel(r);
    if (r.status === "ending")
      this.setData({
        turnNotice: this.data.turnNotice + " · 本手结算后自动结束",
      });
    if (r.phase === "ended" && r.endReason === "idle")
      this.setData({ turnNotice: "无人在线超时，本场已自动结束" });
    if (
      !this.feedbackRoom &&
      this.data.clockSeconds > 0 &&
      this.data.clockSeconds <= 10 &&
      this.warning
    )
      this.warning.key = decisionKey(r);
    this.feedbackRoom = r;
    if (!this.hidden) {
      const kind = events.some((e) => ["settle", "champion"].includes(e.kind))
        ? "win"
        : events.some((e) => e.kind === "turn")
          ? "turn"
          : events.some((e) => ["deal", "board"].includes(e.kind))
            ? "deal"
            : events.some((e) => e.kind === "bet")
              ? "chip"
              : null;
      if (kind) {
        playSound(this, kind);
        if (this.data.experience.motion) {
          clearTimeout(this.effectTimer);
          this.setData({ effect: kind });
          this.effectTimer = setTimeout(
            () => this.setData({ effect: "" }),
            500,
          );
        }
      }
    }
  },
  tickCountdown() {
    this.tickTournamentClocks();
    const r = this.data.room;
    if (!r || r.turn < 0 || !Number.isFinite(r.deadline)) {
      if (
        !r?.tournament?.started ||
        r.tournament.completed ||
        r.tournament.cancelled
      ) {
        clearInterval(this.clockTimer);
        this.clockTimer = null;
      }
      if (this.data.clockSeconds !== null)
        this.setData({ clockSeconds: null, clockUrgent: false });
      return;
    }
    const seconds = Math.max(
      0,
      Math.ceil(
        (r.deadline -
          (r.serverTime || this.clockReceivedAt) -
          (Date.now() - this.clockReceivedAt)) /
          1000,
      ),
    );
    if (seconds !== this.data.clockSeconds)
      this.setData({ clockSeconds: seconds, clockUrgent: seconds <= 10 });
    this.vibrateTurn(r, seconds);
    if (this.feedbackRoom && !this.hidden && this.warning?.tick(r, seconds))
      playSound(this, "warning");
  },
  vibrateTurn(r, seconds) {
    if (this.hidden || this.stopped || !this.data.connected || !this.data.experience.vibration || typeof wx.vibrateShort !== 'function') return;
    if (!this.haptics) {
      let saved;try { saved=wx.getStorageSync('holdem-haptics'); } catch {}
      this.haptics=new HapticClock(saved);
    }
    const kind=this.haptics.tick(r,seconds);
    if (!kind) return;
    try { wx.setStorageSync('holdem-haptics',this.haptics.entries()); } catch {}
    clearTimeout(this.hapticTimer);
    const pulse=()=>{try { wx.vibrateShort({type:'light',fail() {}}); } catch {}};
    pulse();
    if (kind==='warning') this.hapticTimer=setTimeout(()=>{
      const current=this.data.room;
      if (!this.hidden && !this.stopped && this.data.connected && this.data.experience.vibration &&
        current && decisionKey(current)===decisionKey(r) && !current.players.find(p=>p.id===current.me)?.folded) pulse();
    },200);
  },
  tickTournamentClocks() {
    const r = this.data.room,
      t = r?.tournament;
    if (!t) return;
    if(r.roomControls?.pause?.state==='active'){this.setData({levelClock:'升盲已暂停',nextHandClock:'牌桌已暂停'});return;}
    const now =
      (r.serverTime || this.clockReceivedAt) +
      Date.now() -
      this.clockReceivedAt;
    if (r.gameMode === "friends" && !timedFriends(r)) {
      this.setData({
        levelClock: "",
        nextHandClock: t.completed || t.cancelled
          ? ""
          : t.stopRequested
            ? "本手结束后停止"
            : r.phase === "showdown" && t.nextHandAt
              ? r.onlineCount === 0
                ? "暂停 · 等待玩家回桌"
                : "下一手 " + Math.max(0, Math.ceil((t.nextHandAt - now) / 1000))
              : "",
      });
      return;
    }
    const format = (deadline) => {
      const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
      return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    };
    const levelClock = !t.started
      ? "等待开始"
      : t.completed || t.cancelled
        ? ""
        : (timedFriends(r) && t.pendingLevel) || t.scheduledLevel > t.level || (t.nextLevelAt && now >= t.nextLevelAt)
          ? "升盲在下一手生效"
          : t.nextLevelAt
            ? "下级 " + format(t.nextLevelAt)
            : "最高级别";
    let nextHandClock = r.gameMode === "friends"
      ? t.completed || t.cancelled ? "" : t.stopRequested ? "本手结束后停止"
        : r.phase === "showdown" && t.nextHandAt
          ? r.onlineCount === 0 ? "暂停 · 等待玩家回桌"
            : "下一手 " + Math.max(0, Math.ceil((t.nextHandAt - now) / 1000))
          : ""
      : t.nextHandAt
      ? "下一手 " + format(t.nextHandAt)
      : t.stopRequested
        ? "本手结束后停止"
        : "";
    if(r.gameMode==='friends'&&r.phase==='showdown'&&r.roomControls?.canContinue===false)nextHandClock='等待牌手返回或准备';
    if (
      levelClock !== this.data.levelClock ||
      nextHandClock !== this.data.nextHandClock
    )
      this.setData({ levelClock, nextHandClock });
  },
  act(e) {
    let type = e.currentTarget.dataset.type;
    if (type === "restart") {
      const r = this.data.room;
      if (
        this.data.pendingRestart ||
        !this.data.connected ||
        !this.data.isHost ||
        r.phase !== "ended"
      )
        return;
      const chipMode = this.data.rematchMode;
      return wx.showModal({
        title: "再开一场",
        content: `${chipMode === "reset" ? `所有玩家重置为 ${r.initial} 筹码。` : "保留当前筹码，新场输赢重新计算。"}旧战绩保留，未处理筹码申请清除。`,
        success: (result) => {
          if (result.confirm)
            this.send("restart", { round: r.roundNumber || 1, chipMode });
        },
      });
    }
    if (
      ["fold", "check", "call", "raise", "allin"].includes(type) &&
      this.data.clockSeconds === 0
    )
      return;
    if (type === "end")
      return wx.showModal({
        title: "结束房间",
        content: this.data.tournament
          ? "正在进行的手牌会正常结算，之后停止比赛。"
          : "保存本场战绩，之后可以在原房间再开一场。",
        success: (r) => {
          if (r.confirm) this.send("end");
        },
      });
    if (type === "raise") {
      const b = betOptions(this.data.room),
        amount = Number(this.data.raise);
      if (
        !/^\d+$/.test(this.data.raise) ||
        !Number.isSafeInteger(amount) ||
        amount > b.max ||
        amount < Math.min(b.min, b.max)
      )
        return wx.showToast({ title: "请输入合法金额", icon: "none" });
      if(amount % chipUnit(this.data.room))
        return wx.showToast({ title: "筹码必须为 5 的倍数", icon: "none" });
      if (amount === b.max) type = "allin";
    }
    this.send(type, { amount: Number(this.data.raise) });
  },
  switchPanel(e) {
    const panel = e.currentTarget.dataset.panel;
    if (
      ["activity", "chips", "results", "history", "tournament"].includes(panel)
    )
      this.setData({ activePanel: panel });
    this.refreshHistory();
  },
  toggleHints(e) {
    const enabled = e.detail.value;
    wx.setStorageSync("holdem-hand-insights", enabled ? "on" : "off");
    this.setData({ hintsEnabled: enabled });
    this.syncForecast();
  },
  toggleHintDetails() {
    this.setData({ hintExpanded: !this.data.hintExpanded });
  },
  syncForecast() {
    this.forecastController ||= new ForecastController({getRoom:()=>this.data.room,
      enabled:()=>this.data.connected&&!this.hidden&&!this.stopped&&this.data.hintsEnabled,
      load:s=>this.requestApi(`/api/rooms/${s.room}/forecast?`+Object.entries(s.query).map(([k,v])=>k+'='+encodeURIComponent(v)).join('&')),
      render:value=>{const next={...value};if(value.data){const f=value.data,rows=[...f.probabilities].sort((a,b)=>b.count-a.count).map(p=>({...p,text:f.method==='simulation'&&p.count===0?'未采样到':p.percent.toFixed(2)+'%'}));next.topRows=rows.slice(0,3);next.allRows=rows.slice(3);next.methodText=(f.method==='simulation'?'模拟估算 · ':'精确枚举 · ')+f.samples+(f.method==='simulation'?' 次':' 种');next.note=f.ceiling.preflop?'翻牌前上限均可能为皇家同花顺，不代表起手牌强弱；模拟未采样到不等于不可能。':'只按自己的底牌和公共牌计算成牌概率，不是获胜概率。';}this.setData({forecastValue:next});}});
    this.forecastController.sync();
  },
  toggleForecast(){this.setData({forecastExpanded:!this.data.forecastExpanded});},
  openPlayer(e) {
    const r=this.data.room,p=r?.players.find(p=>p.id===e.currentTarget.dataset.player&&!p.removed);
    if(!r||!p||!this.data.connected)return;
    this.playerSelection={id:p.id,room:r.id,round:r.roundNumber||1,viewer:r.me};this.profileMarker='';
    this.setData({playerPanelOpen:true,playerProfile:{player:{...p,avatarUrl:avatarUrl(p.avatar),avatarText:p.name.slice(0,1),net:p.stack-p.buyin},statistics:null},profileError:''});this.syncPlayerPanel(r);
  },
  closePlayerPanel(){this.playerSelection=null;this.profileSequence=(this.profileSequence||0)+1;this.setData({playerPanelOpen:false,playerProfile:null,profileError:'',profileLoading:false});},
  keepPlayerPanel(){},
  syncPlayerPanel(r) {
    const s=this.playerSelection;if(!s)return;
    const p=r?.players.find(p=>p.id===s.id&&!p.removed);
    if(!r||!this.data.connected||r.id!==s.room||(r.roundNumber||1)!==s.round||r.me!==s.viewer||!p)return this.closePlayerPanel();
    const old=this.data.playerProfile||{};
    this.setData({playerProfile:{...old,player:{...(old.player||{}),...p,avatarUrl:avatarUrl(p.avatar),avatarText:p.name.slice(0,1),net:p.stack-p.buyin,status:p.pendingKick?'本手后移出':p.eliminated?'已淘汰':p.folded?'已弃牌':p.inHand?'在赛':'等待开局'},canKick:!!old.canKick&&r.host===r.me&&p.id!==r.me&&!p.pendingKick&&r.phase!=='ended'}});
    const marker=`${r.hand}:${['showdown','ended'].includes(r.phase)}`;if(marker!==this.profileMarker){this.profileMarker=marker;this.refreshPlayerProfile();}
  },
  async refreshPlayerProfile() {
    const s=this.playerSelection;if(!s)return;const sequence=this.profileSequence=(this.profileSequence||0)+1;this.setData({profileLoading:true,profileError:''});
    try{const value=await this.requestApi(`/api/rooms/${s.room}/players/${s.id}`);if(sequence!==this.profileSequence||s!==this.playerSelection)return;if(value.room!==s.room||value.round!==s.round||value.player.id!==s.id)return;
      this.setData({playerProfile:{...value,player:{...value.player,avatarUrl:avatarUrl(value.player.avatar),avatarText:value.player.name.slice(0,1)},rateText:value.statistics.winRate===null?'暂无统计':value.statistics.winRate.toFixed(2)+'%',sinceText:value.statistics.since?new Date(value.statistics.since).toLocaleDateString():'更新后开始统计'}});this.syncPlayerPanel(this.data.room);
    }catch(error){if(sequence!==this.profileSequence)return;if(error.status===403||error.status===404)return this.closePlayerPanel();this.setData({profileError:'统计暂不可用，请重试'});}finally{if(sequence===this.profileSequence)this.setData({profileLoading:false});}
  },
  kickProfile(){if(this.playerSelection)this.kickPlayer({currentTarget:{dataset:{id:this.playerSelection.id}}});},
  toggleGodMode() {
    const r = this.data.room;
    if (!r || !this.data.connected || (r.tournament && r.gameMode !== "friends") || (!r.godMode && !r.canGodMode)) return;
    this.send("godmode", { enabled: !r.godMode });
  },
  request() {
    const r=this.data.room;
    if(r?.gameMode==='friends' && !r.canRequestRebuy)return;
    this.send("rebuy", { amount: r?.gameMode==='friends' ? r.initial : Number(this.data.rebuy) });
  },
  approve(e) {
    this.send(e.currentTarget.dataset.type, {
      request: e.currentTarget.dataset.id,
    });
  },
  rollSeats() {
    const s=this.data.room?.seating;if(!this.data.connected || !s?.canRoll)return;
    this.send('rollseat',{version:s.version,rollRound:s.rollRound});
  },
  botCountChange(e){this.setData({botCountIndex:Number(e.detail.value)});},
  addTestBots(){
    const r=this.data.room;if(!this.data.connected||this.data.user?.role!=='admin'||!r?.botSetup?.canManage)return;
    this.send('testbots',{action:'add',count:Math.min(r.botSetup.capacity,(this.data.botCountIndex||0)+1),round:r.roundNumber||1,version:r.botSetup.version});
  },
  removeTestBot(e){
    const r=this.data.room;if(!this.data.connected||this.data.user?.role!=='admin'||!r?.botSetup?.canManage)return;
    this.send('testbots',{action:'remove',player:e.currentTarget.dataset.id,round:r.roundNumber||1,version:r.botSetup.version});
  },
  kickPlayer(e) {
    const r=this.data.room,target=r?.manageableMembers?.find(p=>p.id===e.currentTarget.dataset.id);
    if(!target || target.pendingKick || r.me!==r.host || !this.data.connected)return;
    const round=r.roundNumber||1;
    wx.showModal({title:'移出成员',content:`移出 ${target.name}？${!target.spectating && ['preflop','flop','turn','river'].includes(r.phase)?'本手正常结算后生效。':'立即生效。'}本场不能重新入座或观战，筹码和战绩保留。`,success:result=>{if(result.confirm)this.send('kick',{player:target.id,round});}});
  },
  copy() {
    wx.setClipboardData({ data: this.data.room.id });
  },
  back() {
    this.clearFeedback();
    this.resetHistory();
    this.send("leave");
    wx.removeStorageSync("holdem-token");
    wx.removeStorageSync("holdem-room");
    this.setData({ room: null, history: [], previousRounds: [], activePanel: "activity" });
    this.send("archives");
  },
  openArchive(e) {
    const room = e.currentTarget.dataset.room;
    wx.setStorageSync("holdem-room", room);
    this.send("resume", { room });
  },
  onShareAppMessage() {
    return {
      title: "好友德州，来一起玩",
      path:
        "/pages/table/table" +
        (this.data.room ? "?room=" + this.data.room.id : ""),
    };
  },
  onShow() {
    this.hidden = false;
    this.syncForecast();
    this.feedbackRoom = null;
    if (this.liveRoom) {
      this.historyCache.sync(this.historyIdentity(), this.liveRoom);
      this.refreshHistory();
      this.refreshWinnerFocus(this.liveRoom);
      this.startBadgeClock();
    }
  },
  onHide() {
    this.hidden = true;
    this.clearFeedback();
  },
  clearFeedback() {
    this.setData({pendingReveal:false});
    clearTimeout(this.hapticTimer);
    this.closePlayerPanel();this.forecastController?.reset();
    clearInterval(this.badgeTimer);this.badgeTimer=null;
    this.feedbackRoom = null;
    this.warning?.reset();
    clearTimeout(this.effectTimer);
    clearTimeout(this.winnerTimer);
    try {
      this.audio?.stop();
    } catch {}
    this.setData({ effect: "", winnerFocus: [] });
  },
  startBadgeClock(){
    if(this.hidden||this.stopped||!this.liveRoom)return;
    this.refreshLatencyBadges();
    if(!this.badgeTimer)this.badgeTimer=setInterval(()=>this.refreshLatencyBadges(),1000);
  },
  receivePlayerLatency(message){
    const r=this.liveRoom;
    if(!r||message.room!==r.id||!Number.isFinite(message.serverTime)||message.serverTime<Math.max(r.serverTime||0,this.latencyPacketAt||0)||!Array.isArray(message.players))return;
    this.latencyPacketAt=message.serverTime;this.latencyPacketReceivedAt=Date.now();
    const values=new Map(message.players.map(p=>[p.id,p.connection]));
    for(const player of r.players)if(values.has(player.id))player.connection=values.get(player.id);
    this.refreshLatencyBadges();
  },
  refreshLatencyBadges(){
    if(this.hidden||!this.liveRoom)return;
    const r=this.liveRoom,now=Math.max((r.serverTime||this.clockReceivedAt)+Date.now()-this.clockReceivedAt,this.latencyPacketAt?this.latencyPacketAt+Date.now()-this.latencyPacketReceivedAt:0);
    const players=new Map(r.players.map(p=>[p.id,p])),patch={};this.latencyFingerprints ||= new Map();
    this.data.seats.forEach((seat,index)=>{
      const badge=latencyBadge(this.data.connected?players.get(seat.playerId)?.connection:null,now),key=JSON.stringify(badge);
      if(this.latencyFingerprints.get(seat.playerId)!==key){this.latencyFingerprints.set(seat.playerId,key);patch[`seats[${index}].latency`]=badge;}
    });
    if(Object.keys(patch).length)this.setData(patch);
  },
  refreshWinnerFocus(r) {
    clearTimeout(this.winnerTimer);
    const key = `${r.id}:${r.roundNumber || 1}:${r.hand}:${r.showdownAt || 0}`;
    if (this.winnerKey !== key) {
      this.winnerKey = key;
      this.winnerExpiresAt = Date.now() + Math.max(0,
        (r.showdownAt || 0) + 5000 - (r.serverTime || Date.now()));
    }
    const remaining = this.winnerExpiresAt - Date.now();
    const winners = !this.hidden && remaining > 0 ? (r.winnerFocus || []) : [];
    this.setData({
      winnerFocus: winners.map((p) => ({ ...p, cards: cards(p.cards), mine: p.id === r.me })),
      winnerBoard: winners.length ? cards(r.board) : [],
    });
    if (winners.length) this.winnerTimer = setTimeout(() => this.setData({ winnerFocus: [] }), remaining);
  },
  winningCardsChange(e) {
    if (!this.data.connected || this.data.room?.gameMode !== "friends") return;
    this.send("winningcards", { enabled: !!e.detail.value });
  },
  showCards() {
    const r=this.data.room;
    if(!this.data.connected || !r?.canShowCards || this.data.pendingReveal) return;
    this.pendingRevealKey=`${r.id}:${r.roundNumber||1}:${r.hand}`;
    this.setData({pendingReveal:true});
    this.send('showcards',{round:r.roundNumber || 1,hand:r.hand});
  },
  toggleExperience() {
    this.setData({ settingsOpen: !this.data.settingsOpen });
  },
  experienceChange(e) {
    const field = e.currentTarget.dataset.field;
    const value =
      field === "volume" ? Number(e.detail.value) / 100 : !!e.detail.value;
    const experience = preferences({ ...this.data.experience, [field]: value });
    try {
      wx.setStorageSync("holdem-experience", experience);
    } catch {}
    this.setData({ experience });
    if (!experience.vibration) clearTimeout(this.hapticTimer);
    if (!experience.sound)
      try {
        this.audio?.stop();
      } catch {}
    if (!experience.motion) {
      clearTimeout(this.effectTimer);
      this.setData({ effect: "" });
    }
  },
  betPreset(e) {
    this.updateRaise(String(e.currentTarget.dataset.amount));
  },
  betSlide(e) {
    this.updateRaise(String(e.detail.value));
  },
  updateRaise(value) {
    this.raiseEdited = true;
    this.setData({
      raise: value,
      betImpact:betImpact(this.data.room,value),
      betSliderValue: Math.max(
        this.data.betMin,
        Math.min(this.data.betMax, Number(value) || 0),
      ),
    });
  },
  rematchChange(e) {
    const index = Number(e.detail.value),
      option = this.data.rematchOptions[index];
    if (option)
      this.setData({ rematchModeIndex: index, rematchMode: option.value });
  },
  historyRoundChange(e) {
    const index = Number(e.detail.value),
      option = this.data.historyRoundOptions[index];
    if (option)
      this.setData({
        historyRoundIndex: index,
        historyRound: option.value,
      });
    this.refreshHistory();
  },
  historyIdentity() {
    return `${this.data.user?.id || ""}:${wx.getStorageSync("holdem-account-token") || ""}`;
  },
  resetHistory() {
    this.historyCache?.reset();
    this.liveRoom = null;
    this.historyFingerprint = "";
    this.roundsFingerprint = "";
  },
  refreshHistory() {
    if (!this.liveRoom || this.hidden || this.stopped) return;
    const r = this.historyCache.restore(this.liveRoom);
    // Archived summaries belong to the results panel; full hands stay outside setData.
    if (["results", "history"].includes(this.data.activePanel)) {
      const previousRounds = (r.completedRounds || []).filter((s) => s.number < (r.roundNumber || 1)).sort((a, b) => b.number - a.number).slice(0,1).map(({ history, ...summary }) => summary);
      const fingerprint = `${this.historyCache.catalogRevision}:${r.id}:${r.roundNumber || 1}`;
      if (fingerprint !== this.roundsFingerprint) {
        this.roundsFingerprint = fingerprint;
        const historyRoundOptions = [{ label: `第 ${r.roundNumber || 1} 场 · 当前`, value: "current" }, ...previousRounds.map((s) => ({ label: `第 ${s.number} 场 · 已结束`, value: String(s.number) }))];
        this.setData({ previousRounds, historyRoundOptions, historyRoundIndex: Math.max(0, historyRoundOptions.findIndex((s) => s.value === this.data.historyRound)) });
      }
    }
    if (this.data.activePanel !== "history") return;
    const selected = this.data.historyRound;
    const entry = this.historyCache.entry(selected);
    const fingerprint = `${entry.revision}:${r.id}:${selected}`;
    const patch = {};
    if (fingerprint !== this.historyFingerprint) {
      this.historyFingerprint = fingerprint;
      patch.history = historyView(r, selected);
    }
    const status = { historyLoading: entry.loading, historyError: entry.error, historyMore: this.historyCache.context.compact && entry.loaded && entry.offset < entry.total };
    for (const [key, value] of Object.entries(status)) if (this.data[key] !== value) patch[key] = value;
    if (Object.keys(patch).length) this.setData(patch);
    this.loadHistory();
  },
  async loadHistory(more = false, retry = false) {
    if (!this.liveRoom || this.hidden || this.stopped || this.data.activePanel !== "history") return;
    const request = this.historyCache.begin(this.data.historyRound, more, retry);
    if (!request) return;
    this.refreshHistory();
    try {
      const page = await this.requestApi(this.historyCache.url(request));
      if (this.stopped || !this.liveRoom || this.historyIdentity() !== request.context.account || this.liveRoom.id !== request.context.roomId) return;
      this.historyCache.accept(request, page);
    } catch (error) {
      this.historyCache.fail(request, error.message);
    }
    if (this.historyCache.active(request)) this.refreshHistory();
  },
  loadOlderHistory() { this.loadHistory(true); },
  retryHistory() { this.loadHistory(this.historyCache.entry(this.data.historyRound).loaded, true); },
});
