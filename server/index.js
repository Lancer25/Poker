import http from "node:http";
import {
  readFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  createRoom,
  joinRoom,
  command,
  snapshot,
  expireTurn,
  advanceTournament,
  advanceFlop,
} from "./game.js";
import { AccountStore, AccountError } from "./accounts.js";
import { announceTournamentLevel, recoverFriendCountdown } from "./tournament.js";
import { recentRooms, canViewHistory, adminHistory } from "./room-history.js";
import { historyPage } from "./history-pages.js";
import {playerProfile} from './player-statistics.js';
import {botSetup,manageBots,createBotScheduler} from './practice-bots.js';
import {forecastContext} from './forecast-context.js';
import {ForecastService} from './forecast-service.js';
import {roomMember,roomSpectator,addSpectator,canTakeSeat} from './spectators.js';
import {isRoomKicked,rejoinRemoved,seatedPlayers,resetSeating} from './friend-room.js';
import { createStateSender } from "./state-sender.js";
import { createLatencyMetrics } from "./latency-metrics.js";
import {ActionTiming,TIMED_ACTIONS} from './action-timing.js';
import {BETTING_ACTIONS,validateAction,recordActionReceipt} from './action-protocol.js';
import {transportInfo} from './transport-security.js';
import {createRoomStore} from './room-store.js';
import {createBackupOffThread,listBackupsOffThread} from './backup-store.js';
import {initializeControls,roomControlCommand,requestSpectatorAdmission,updateRoomControls,canContinueRoom,realtimeAllowed} from './room-controls.js';
import {resetLatency,probeLatency,receiveLatencyPong,playerConnections} from './player-latency.js';
import {
  onlinePlayers,
  onlineSpectators,
  updateLifecycle,
  lifecycleView,
  ROOM_IDLE_TIMEOUT_MS,
} from "./room-lifecycle.js";
import {
  bindLegacyPlayer,
  claimLegacyRooms,
  recoverUnclaimedHost,
} from "./room-ownership.js";
import {
  createAccountApi,
  requestToken,
  validCookieOrigin,
} from "./account-api.js";
const root = fileURLToPath(new URL("../", import.meta.url));
const data = process.env.DATA_DIR || path.join(root, "data");
mkdirSync(data, { recursive: true });
const roomStore=createRoomStore(data);
const stored=roomStore.load();
const rooms = new Map(stored.rooms.map((r) => [r.id, r]));
const sessions = new Map(stored.sessions);
const accounts = new AccountStore(data);
const forecasts=new ForecastService();
const botScheduler=createBotScheduler();
const timing = (key, fallback) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
const idleTimeout = timing("ROOM_IDLE_TIMEOUT_MS", ROOM_IDLE_TIMEOUT_MS);
const heartbeatInterval = timing("ROOM_HEARTBEAT_INTERVAL_MS", 15000);
const heartbeatTimeout = timing("ROOM_HEARTBEAT_TIMEOUT_MS", 45000);
const metrics = createLatencyMetrics();
const stateSender = createStateSender({onSlow:()=>metrics.slow(),onSample:s=>{
  metrics.observe('stateBytes',s.bytes);metrics.observe('bufferedBytes',s.bufferedBytes);metrics.observe('queueMs',s.queueMs);
}});
function save(changedRooms) {
  const start=performance.now();
  try {
  roomStore.save({rooms:[...rooms.values()],sessions:[...sessions]},changedRooms==null?undefined:Array.isArray(changedRooms)?changedRooms:[changedRooms]);
  } finally { metrics.observe('saveMs',performance.now()-start); }
}
let initialized = false;
const startupTime = Date.now();
for (const room of rooms.values()) {
  if(room.gameMode==='friends' && room.phase==='waiting' && room.hand===0 && !room.seating){resetSeating(room);initialized=true;}
  if (updateLifecycle(room, new Set(), startupTime, idleTimeout))
    initialized = true;
  if (recoverFriendCountdown(room, startupTime)) initialized = true;
  if (advanceFlop(room,startupTime)) initialized = true;
}
if (initialized) save();
const backupRoot=process.env.BACKUP_DIR||path.join(data,'backups');
const backupKeep=Math.max(1,Math.min(90,Math.floor(Number(process.env.BACKUP_KEEP)||14)));
const backupInterval=process.env.BACKUP_INTERVAL_MS==='0'?0:timing('BACKUP_INTERVAL_MS',6*60*60*1000);
let backupTask=null,lastBackup=null,backupFailedAt=null;
let backupCatalogTask=null;
let backupCatalog=null,backupCatalogAt=0,backupCatalogRevision=0;
function backupSummary(){
 if(backupCatalog&&Date.now()-backupCatalogAt<60000)return Promise.resolve(backupCatalog);
 if(!backupCatalogTask){const revision=backupCatalogRevision;backupCatalogTask=listBackupsOffThread(backupRoot).then(items=>{
   const result=items.map(item=>({id:path.basename(item.path),createdAt:item.createdAt||null,mode:item.mode||null,valid:item.valid}));
   if(revision===backupCatalogRevision){backupCatalog=result;backupCatalogAt=Date.now();}return result;
 }).finally(()=>{backupCatalogTask=null;});}
 return backupCatalogTask;
}
function runBackup(){
 if(backupTask)return backupTask;
 backupTask=createBackupOffThread(data,{mode:roomStore.mode,root:backupRoot,keep:backupKeep}).then(result=>{lastBackup={id:path.basename(result.path),createdAt:result.createdAt,mode:result.mode};backupFailedAt=null;backupCatalog=null;backupCatalogRevision++;return lastBackup;}).catch(()=>{backupFailedAt=new Date().toISOString();throw new AccountError('备份失败，请检查存储空间或权限',503);}).finally(()=>{backupTask=null;});
 return backupTask;
}
if(backupInterval)setInterval(()=>runBackup().catch(()=>console.error('Scheduled backup failed')),backupInterval).unref();
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) return accountApi(req, res, pathname);
  if (/^\/avatars\/[a-f0-9]{64}\.jpg$/.test(pathname)) {
    const file = path.join(data, "avatars", path.basename(pathname));
    if (!existsSync(file)) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    });
    return res.end(readFileSync(file));
  }
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    return res.end();
  }
  const files = {
    "/": "index.html",
    "/app.js": "app.js",
    "/keyed-render.js": "keyed-render.js",
    "/replay-ui.js":"replay-ui.js",
    "/replay-ui.css":"replay-ui.css",
    "/room-controls-ui.js":"room-controls-ui.js",
    "/room-controls-ui.css":"room-controls-ui.css",
    "/table-feedback.js": "table-feedback.js",
    "/table-objects.js": "table-objects.js",
    "/chip-display.js": "chip-display.js",
    "/bot-setup.js": "bot-setup.js",
    "/table-experience.js": "../miniprogram/utils/table-experience.js",
    "/room-history.js": "../miniprogram/utils/room-history.js",
    "/player-latency.js": "../miniprogram/utils/player-latency.js",
    "/experience.css": "experience.css",
    "/theme.js": "theme.js",
    "/themes.css": "themes.css",
    "/table-ui.css": "table-ui.css",
    "/room-ui.js": "room-ui.js",
    "/connection-recovery.js": "connection-recovery.js",
    "/assets/themes/tables-v1.webp": "assets/themes/tables-v1.webp",
    "/assets/themes/tables-wide-v2.webp": "assets/themes/tables-wide-v2.webp",
    "/assets/themes/tables-portrait-v2.webp": "assets/themes/tables-portrait-v2.webp",
    "/assets/themes/tables-portrait-v7.webp": "assets/themes/tables-portrait-v7.webp",
    "/assets/themes/tables-wide-v7.webp": "assets/themes/tables-wide-v7.webp",
    "/assets/themes/avatars-v1.webp": "assets/themes/avatars-v1.webp",
    "/assets/themes/chips-v1.webp": "assets/themes/chips-v1.webp",
    "/table-layout.js": "../miniprogram/utils/table-layout.js",
    "/style.css": "style.css",
    "/game.css": "game.css",
    "/assets/felt.jpg": "assets/felt.jpg",
    "/admin": "admin.html",
    "/admin.js": "admin.js",
    "/admin-rooms.js": "admin-rooms.js",
    "/admin.css": "admin.css",
    "/account": "account.html",
    "/account.js": "account.js",
    "/account.css": "account.css",
    "/avatar-upload.js": "avatar-upload.js",
    "/friend-room-ui.js": "friend-room-ui.js",
    "/forecast-state.js": "../miniprogram/utils/forecast-state.js",
    "/player-panel.js": "player-panel.js",
    "/hand-forecast-ui.js": "hand-forecast-ui.js",
  };
  for (const icon of [
    "user-round","eye","eye-off","minus","plus","scan-eye","circle-slash","check",
    "play","pause","copy",
    "dice-real-1","dice-real-2","dice-real-3","dice-real-4","dice-real-5","dice-real-6","dice-real-pending",
    "card-spade","card-heart","card-diamond","card-club",
    "table-token-rim",
    "charm-dealer","charm-small-blind","charm-big-blind",
    "bot",
    "dice-1","dice-2","dice-3","dice-4","dice-5","dice-6","dices","user-x",
    "spade",
    "share-2",
    "arrow-left",
    "activity",
    "coins",
    "chart-no-axes-column",
    "history",
    "arrow-right",
    "trophy",
    "settings-2",
    "search",
    "refresh-cw",
    "chevron-left",
    "chevron-right",
    "x",
  ]) {
    files[`/assets/icons/${icon}.svg`] = `assets/icons/${icon}.svg`;
  }
  for(const state of ['good','warning','bad','muted'])files[`/assets/icons/signal-${state}.svg`]=`../miniprogram/assets/icons/signal-${state}.svg`;
  for(const role of ['dealer','small-blind','big-blind'])files[`/assets/badges/role-${role}-v1.webp`]=`assets/badges/role-${role}-v1.webp`;
  if (pathname === "/health") {
    res.setHeader("Content-Type", "application/json");
    return res.end('{"ok":true}');
  }
  if (!files[pathname]) {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.setHeader(
    "Content-Type",
    pathname.endsWith(".webp")
      ? "image/webp"
      : pathname.endsWith(".svg")
      ? "image/svg+xml"
      : pathname.endsWith(".jpg")
        ? "image/jpeg"
        : pathname.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : pathname.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8",
  );
  res.setHeader("Cache-Control", pathname.startsWith('/assets/themes/') ? 'public, max-age=31536000, immutable' : "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.end(readFileSync(path.join(root, "public", files[pathname])));
});
const wss = new WebSocketServer({ server, maxPayload: 8192 });
const dirtyLatencyRooms=new Set();
function connections(room,now=Date.now()){
  return playerConnections(room,wss.clients,token=>accounts.findSession(token)?.user,now,heartbeatTimeout);
}
function presence(now = Date.now()) {
  return onlinePlayers(
    wss.clients,
    rooms,
    (token) => accounts.findSession(token)?.user,
    now,
    heartbeatTimeout,
  );
}
function spectatorPresence(now = Date.now()) {
  return onlineSpectators(wss.clients,rooms,token=>accounts.findSession(token)?.user,now,heartbeatTimeout);
}
function view(room, player, online, now = Date.now(), compact = false, spectatorCount = spectatorPresence(now).get(room.id)?.size || 0, connectionMap=connections(room,now)) {
  const state=snapshot(room,player,{compact,now});
  for(const player of state.players)player.connection=connectionMap.get(player.id);
  return {
    ...state,
    spectatorCount,
    ...lifecycleView(
      room,
      online || presence(now).get(room.id) || new Set(),
      now,
      idleTimeout,
    ),
  };
}
function refreshPresence(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const now = Date.now(),
    online = presence(now).get(room.id) || new Set();
  if (updateLifecycle(room, online, now, idleTimeout)) save(room);
  broadcast(room);
}
function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}
function cancelWatch(ws){
  const pending=ws.watchRequest;if(!pending)return;
  ws.watchRequest=null;const room=rooms.get(pending.room);
  if(room?.controls){const before=room.controls.spectatorRequests.length;room.controls.spectatorRequests=room.controls.spectatorRequests.filter(r=>r.id!==pending.request||r.user.id!==ws.accountId);if(before!==room.controls.spectatorRequests.length){room.controls.version++;save(room);broadcast(room);}}
}
function settleAdmission(room,result){
  const waiting=[...wss.clients].filter(client=>client.readyState===WebSocket.OPEN&&!client.identity&&client.accountId===result.user.id&&client.watchRequest?.room===room.id&&client.watchRequest?.request===result.request&&accounts.findSession(client.authToken)?.user.id===result.user.id);
  if(result.status!=='approved')return;
  const user=accounts.getUser(result.user.id);
  if(!user||user.disabled||!waiting.length)return;
  const spectator=addSpectator(room,user);
  for(const client of waiting){client.watchRequest=null;client.identity={room:room.id,player:spectator.id};const token=randomBytes(32).toString('hex');sessions.set(token,client.identity);send(client,{type:'session',token});}
}
function broadcast(room) {
  for(const ws of wss.clients)if(ws.watchRequest?.room===room.id&&ws.readyState===WebSocket.OPEN&&!room.controls?.spectatorRequests.some(r=>r.id===ws.watchRequest.request&&r.user.id===ws.accountId)){
    ws.watchRequest=null;send(ws,{type:'spectate_pending',room:room.id,status:'closed',message:'观战申请未通过或已失效'});
  }
  const now = Date.now(),
    online = presence(now).get(room.id) || new Set();
  const spectatorCount = spectatorPresence(now).get(room.id)?.size || 0;
  const connectionMap=connections(room,now);
  for (const ws of wss.clients)
    if (ws.identity?.room === room.id) {
      const user = authenticated(ws);
      if (!user) continue;
      if (isRoomKicked(room,user.id) || roomMember(room,user.id)?.removed || roomMember(room,user.id)?.id!==ws.identity.player || !canViewHistory(room, user, rooms)) {
        stateSender.clear(ws);
        ws.actionTiming.reset();
        ws.identity = null;
        send(ws, {
          type: "error",
          code: "room_forbidden",
          message: isRoomKicked(room,user.id) ? "你已被房主移出本场" : "无权进入该牌桌，请返回大厅",
        });
        continue;
      }
      if(ws.compactState) {
        stateSender.send(ws,()=>{
          if(ws.identity?.room!==room.id)return null;
          const current=authenticated(ws);
          if(!current||isRoomKicked(room,current.id)||roomMember(room,current.id)?.removed||roomMember(room,current.id)?.id!==ws.identity.player||!canViewHistory(room,current,rooms))return null;
          const start=performance.now();
          const payload=statePayload(ws,room,online,Date.now(),true,spectatorCount,connectionMap);
          metrics.observe('snapshotMs',performance.now()-start);return payload;
        });
      } else send(ws,statePayload(ws,room,online,now,false,spectatorCount,connectionMap));
    }
}
function statePayload(ws,room,online,now,compact,spectatorCount,connectionMap){
  const payload={type:'state',room:view(room,ws.identity.player,online,now,compact,spectatorCount,connectionMap)};
  payload.room.botSetup=botSetup(room,accounts.findSession(ws.authToken)?.user,ws.identity.player);
  const receipt=ws.actionTiming.receipt();
  if(receipt)payload.actionReceipt=receipt;
  return payload;
}
function requireRoomHistory(room, user) {
  if (!canViewHistory(room, user, rooms))
    throw new AccountError("较早的历史房间仅管理员可查看", 403);
}
function expire(ws) {
  stateSender.clear(ws);
  ws.actionTiming.reset();
  const roomId = ws.identity?.room;
  ws.identity = null;
  ws.accountId = null;
  refreshPresence(roomId);
  send(ws, {
    type: "error",
    code: "auth_required",
    message: "登录已失效，请重新登录",
  });
  ws.close(1008, "Authentication required");
}
function authenticated(ws) {
  const session = accounts.findSession(ws.authToken);
  if (!session || session.user.id !== ws.accountId) {
    expire(ws);
    return null;
  }
  return session.user;
}
wss.on("connection", (ws, req) => {
  ws.on('error',()=>{});
  if(process.env.REQUIRE_SECURE_AUTH==='1'&&!transportInfo(req).secure){send(ws,{type:'error',code:'secure_transport_required',message:'请使用 HTTPS 安全连接'});ws.close(1008,'Secure transport required');return;}
  const connectedAt=Date.now();
  ws.actionTiming=new ActionTiming();
  resetLatency(ws);
  ws.lastPongAt = Date.now();
  ws.on("pong", (data) => {
    if(!receiveLatencyPong(ws,data))return;
    ws.lastPongAt = Date.now();
    const room=rooms.get(ws.identity?.room);
    if(room?.players.some(p=>p.id===ws.identity.player && p.accountId===ws.accountId))dirtyLatencyRooms.add(room.id);
  });
  ws.on("close", (code) => {
    metrics.observe('wsCloseCode'+code,1);metrics.observe('wsConnectionMs',Date.now()-connectedAt);
    stateSender.clear(ws);
    const roomId = ws.identity?.room;
    ws.identity = null;
    refreshPresence(roomId);
  });
  let recent = [];
  ws.on("message", (raw) => {
    const receivedAt=performance.now();
    let controlRequestId=null;
    try {
      recent = recent.filter((t) => Date.now() - t < 1000);
      if (recent.length >= 20) throw Error("操作太频繁");
      recent.push(Date.now());
      const msg = JSON.parse(raw.toString());
      let actionResult=null;
      let controlResult=null;
      if(msg.type==='roomcontrol'){
        if(typeof msg.controlRequestId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(msg.controlRequestId))throw Error('房间操作标识无效');
        controlRequestId=msg.controlRequestId;
      }
      if (msg.type === "authenticate") {
        stateSender.clear(ws);
        ws.actionTiming.reset();
        resetLatency(ws);
        ws.compactState=msg.compactState===true;
        const previousRoom = ws.identity?.room;
        ws.identity = null;
        ws.accountId = null;
        refreshPresence(previousRoom);
        if (typeof msg.token === "string") ws.authToken = msg.token;
        else
          ws.authToken = validCookieOrigin(req) ? requestToken(req) : undefined;
        const session = accounts.findSession(ws.authToken);
        if (!session) return expire(ws);
        ws.accountId = session.user.id;
        send(ws, { type: "account", user: session.user });
        probeLatency(ws);return;
      }
      const user = authenticated(ws);
      if (!user) return;
      if(TIMED_ACTIONS.has(msg.type))ws.actionTiming.start(msg.actionId,receivedAt);
      if(msg.type==='action_telemetry'){
        const sample=ws.actionTiming.sample(msg);
        if(sample)for(const [key,value]of Object.entries(sample))metrics.observe(key,value);
        return;
      }
      if(msg.type==='latency') {
        if(!Number.isFinite(msg.echo)||msg.echo<0||msg.echo>1e15)throw Error('延迟参数无效');
        return send(ws,{type:'latency',echo:msg.echo,serverTime:Date.now()});
      }
      if(msg.type==='telemetry') {
        if(Date.now()-(ws.lastTelemetryAt||0)<15000)return;
        if(!Number.isFinite(msg.rttMs)||msg.rttMs<0||msg.rttMs>120000||
          !Number.isFinite(msg.renderMs)||msg.renderMs<0||msg.renderMs>30000)throw Error('性能参数无效');
        ws.lastTelemetryAt=Date.now();metrics.observe('clientRttMs',msg.rttMs);metrics.observe('clientRenderMs',msg.renderMs);return;
      }
      let room;
      if(msg.type==='watchcancel'){cancelWatch(ws);return send(ws,{type:'spectate_pending',status:'cancelled'});}
      if (msg.type === "leave") {
        cancelWatch(ws);
        stateSender.clear(ws);
        ws.actionTiming.reset();
        const previousRoom = ws.identity?.room;
        ws.identity = null;
        refreshPresence(previousRoom);
        return send(ws, { type: "left" });
      }
      if (msg.type === "archives") {
        const archive = new Map();
        const now = Date.now(),
          online = presence(now);
        for (const r of recentRooms(rooms, user)) {
          const player = roomMember(r,user.id);
          if (!player || player.removed || isRoomKicked(r,user.id)) continue;
          const token = [...sessions]
            .reverse()
            .find(
              ([, identity]) =>
                identity.room === r.id && identity.player === player.id,
            )?.[0];
          archive.set(r.id, {
            token,
            id: r.id,
            ...(r.testRound?{testRound:true}:{}),
            phase: r.phase,
            hand: r.hand,
            roundNumber: r.roundNumber || 1,
            completedRoundCount: r.completedRounds?.length || 0,
            finishedAt: r.finishedAt,
            results: resultsForArchive(r),
            ...lifecycleView(
              r,
              online.get(r.id) || new Set(),
              now,
              idleTimeout,
            ),
          });
        }
        return send(ws, { type: "archives", archive: [...archive.values()] });
      }
      if (msg.type === "resume") {
        const session = msg.room
          ? {
              room: String(msg.room),
              player: rooms
                .get(String(msg.room))
                ?.players.find((p) => p.accountId === user.id)?.id,
            }
          : sessions.get(msg.token);
        if (!session) throw Error("身份已失效，请重新进入");
        room = rooms.get(session.room);
        if (!room) throw Error("房间不存在");
        const ownPlayer = roomMember(room,user.id);
        if (!ownPlayer) throw new AccountError("无权进入该房间", 403);
        if(ownPlayer.removed || isRoomKicked(room,user.id))throw new AccountError('你已被房主移出牌桌，请在新一场重新加入',403);
        requireRoomHistory(room, user);
        cancelWatch(ws);
        ownPlayer.avatar = user.avatar;
        ws.identity = { room: room.id, player: ownPlayer.id };
      } else if (msg.type === "create" || msg.type === "join" || msg.type === "watch") {
        if (ws.identity) throw Error("请先退出当前连接");
        if(ws.watchRequest&&(msg.type!=='watch'||ws.watchRequest.room!==String(msg.room)))cancelWatch(ws);
        if (msg.type === "create") {
          cancelWatch(ws);
          if (rooms.size >= 1000) throw Error("房间数量已达上限");
          let created;
          do {
            created = createRoom(
              user.nickname,
              msg.chips,
              msg.small,
              msg.big,
              msg.turnSeconds,
              msg.gameMode,
              msg.blindMinutes,
            );
          } while (rooms.has(created.room.id));
          room = created.room;
          const options=msg.roomOptions||{};
          initializeControls(room,{admission:options.admission,reveal:options.reveal,requireReady:options.requireReady});
          rooms.set(room.id, room);
          created.player.accountId = user.id;
          created.player.avatar = user.avatar;
          ws.identity = { room: room.id, player: created.player.id };
        } else {
          room = rooms.get(String(msg.room));
          if (!room) throw Error("房间不存在");
          if(isRoomKicked(room,user.id))throw new AccountError('你已被房主移出本场',403);
          requireRoomHistory(room, user);
          let p = roomMember(room,user.id);
          if(msg.type==='join' && p?.removed)p=room.phase==='waiting' ? rejoinRemoved(room,p) : null;
          if(msg.type==='watch'){
            const admission=requestSpectatorAdmission(room,user);
            if(admission.status==='pending'){
              ws.watchRequest={room:room.id,request:admission.request.id};save(room);broadcast(room);send(ws,{type:'spectate_pending',room:room.id,status:'pending',request:admission.request.id});return;
            }
            p=addSpectator(room,user);
          }
          else if(!p && room.gameMode==='friends' && room.phase!=='ended' &&
              (room.tournament.startedAt!==null || seatedPlayers(room).length>=9)) {
            return send(ws,{type:'spectate_offer',room:room.id,message:`本场已开始或座位已满，是否申请观战？${realtimeAllowed(room)?'本房允许实时查看已发底牌。':'本房仅可查看公开牌。'}`});
          }
          p ||= joinRoom(room, user.nickname);
          p.accountId = user.id;
          p.avatar = user.avatar;
          ws.identity = { room: room.id, player: p.id };
        }
        const token = randomBytes(32).toString("hex");
        sessions.set(token, ws.identity);
        send(ws, { type: "session", token });
      } else {
        if (!ws.identity) throw Error("请先进入房间");
        room = rooms.get(ws.identity.room);
        if (
          !room || isRoomKicked(room,user.id) || roomMember(room,user.id)?.removed || roomMember(room,user.id)?.id !== ws.identity.player
        )
          throw new AccountError("无权进入该房间", 403);
        requireRoomHistory(room, user);
        const spectator = roomSpectator(room,ws.identity.player);
        if(spectator) {
          if(msg.type!=='sitin')throw Error('观战模式仅可查看，不能操作牌局');
          if(!canTakeSeat(room))throw Error('仅能在新一场等待开局且有空位时入座');
          const player=joinRoom(room,user.nickname);
          player.accountId=user.id;player.avatar=user.avatar;
          room.spectators=room.spectators.filter(p=>p.id!==spectator.id);
          for(const client of wss.clients)if(client.identity?.room===room.id && client.accountId===user.id){
            stateSender.clear(client);client.identity={room:room.id,player:player.id};
          }
          for(const [token,identity]of sessions)if(identity.room===room.id && identity.player===spectator.id)
            sessions.set(token,{room:room.id,player:player.id});
        } else if(msg.type!=='sitin') {
        if(BETTING_ACTIONS.has(msg.type)){
          const duplicate=validateAction(room,ws.identity.player,msg);
          if(duplicate){ws.actionTiming.cancel();send(ws,{type:'action_result',...duplicate});broadcast(room);return;}
        }
        if (
          ["fold", "check", "call", "raise", "allin"].includes(msg.type) &&
          expireTurn(room)
        ) {
          ws.actionTiming.cancel();
          save(room);
          broadcast(room);
          throw Object.assign(Error("行动时间已结束，已自动弃牌"),{code:'action_expired'});
        }
        if(msg.type==='roomcontrol'){
          controlResult=roomControlCommand(room,ws.identity.player,msg.command,msg);
          if(['approved','rejected'].includes(controlResult.status))settleAdmission(room,controlResult);
        }
        else if(msg.type==='testbots')manageBots(room,user,ws.identity.player,msg);
        else command(room, ws.identity.player, msg.type, msg);
        if(BETTING_ACTIONS.has(msg.type))actionResult=recordActionReceipt(room,ws.identity.player,msg);
        }
      }
      room.lastActivityAt = Date.now();
      updateRoomControls(room,room.lastActivityAt);
      const member = roomMember(room,user.id);
      if (member) member.lastVisitedAt = room.lastActivityAt;
      updateLifecycle(
        room,
        presence().get(room.id) || new Set(),
        Date.now(),
        idleTimeout,
      );
      save(room);
      if(actionResult)send(ws,{type:'action_result',...actionResult});
      if(controlResult)send(ws,{type:'roomcontrol_result',requestId:controlRequestId,status:controlResult.status});
      broadcast(room);
    } catch (error) {
      ws.actionTiming.cancel();
      if (error.status === 403 && ws.identity) {
        const previousRoom = ws.identity.room;
        ws.identity = null;
        refreshPresence(previousRoom);
      }
      send(ws, {
        type: "error",
        message: error.message,
        code: error.status === 403 ? "room_forbidden" : error.code,
        ...(controlRequestId?{scope:'roomcontrol',requestId:controlRequestId}:{}),
      });
      if(controlRequestId&&ws.identity){const current=rooms.get(ws.identity.room);if(current){save(current);broadcast(current);}}
      if(error.code==='action_stale'&&ws.identity){const current=rooms.get(ws.identity.room);if(current)broadcast(current);}
    } finally {metrics.observe('messageMs',performance.now()-receivedAt);}
  });
});
function liveRoomMember(user,roomId) {
  const room=rooms.get(String(roomId)),member=room && roomMember(room,user.id);
  if(!room)throw new AccountError('房间不存在',404);
  if(!member || member.removed || isRoomKicked(room,user.id))throw new AccountError('无权查看该牌桌',403);
  requireRoomHistory(room,user);return {room,member};
}
function bindLegacy(user, roomId, playerId) {
  const room = rooms.get(String(roomId));
  const result = bindLegacyPlayer(room, user, playerId);
  save();
  broadcast(room);
  return result;
}
const accountApi = createAccountApi(accounts, {
  diagnostics(user,req){
    const mem=process.memoryUsage();return {at:new Date().toISOString(),uptimeSeconds:Math.floor(process.uptime()),node:process.version,
      storage:roomStore.stats(),memory:{rss:mem.rss,heapUsed:mem.heapUsed},rooms:{total:rooms.size,active:[...rooms.values()].filter(r=>['preflop','flop','turn','river'].includes(r.phase)).length,onlineConnections:[...wss.clients].filter(ws=>ws.readyState===WebSocket.OPEN&&ws.identity).length},
      latency:metrics.snapshot(),transport:transportInfo(req,{enforced:process.env.REQUIRE_SECURE_AUTH==='1'}),backup:{running:!!backupTask,last:lastBackup,failedAt:backupFailedAt,intervalSeconds:backupInterval/1000,keep:backupKeep}};
  },
  async backups(){return {backups:await backupSummary(),running:!!backupTask};},
  async createBackup(user){const result=await runBackup();accounts.record(user.id,'create_backup',null,{id:result.id,mode:result.mode});return {backup:result};},
  playerProfile(user,roomId,target) {
    const {room,member}=liveRoomMember(user,roomId);
    return playerProfile(room,target,member.id,rooms.values());
  },
  async handForecast(user,roomId,params) {
    const {room,member}=liveRoomMember(user,roomId),context=forecastContext(room,member.id,params);
    const forecast=await forecasts.run(context.input);
    const current=liveRoomMember(user,roomId),next=forecastContext(current.room,current.member.id,params);
    if(next.key!==context.key)throw new AccountError('牌局状态已更新',409);
    return {round:context.round,hand:context.hand,phase:context.phase,boardCount:context.boardCount,forecast};
  },
  playerHistory(user,roomId,params) {
    const room=rooms.get(String(roomId));
    if(!room)throw new AccountError('房间不存在',404);
    if(user.role!=='admin') {
      const member=roomMember(room,user.id);
      if(!member || member.removed || isRoomKicked(room,user.id))throw new AccountError('无权查看该房间',403);
      requireRoomHistory(room,user);
    }
    let page;
    try {page=historyPage(room,params,{allowOlder:user.role==='admin'});}catch(error) {throw new AccountError(error.status===403?error.message:'历史分页参数无效',error.status===403?403:400);}
    if(!page)throw new AccountError('场次不存在',404);
    return page;
  },
  expireSessions() {
    for (const ws of wss.clients) if (ws.accountId) authenticated(ws);
  },
  claimLegacy(user, tokens) {
    const result = claimLegacyRooms(rooms, sessions, user, tokens);
    if (result.claimed.length || result.hostRecovered.length) save();
    for (const id of result.hostRecovered) {
      accounts.recordAccount(user.id, "recover_host", user.id, { room: id });
      broadcast(rooms.get(id));
    }
    return result;
  },
  bindLegacy,
  recoverHost(user, roomId) {
    const room = rooms.get(String(roomId));
    const result = recoverUnclaimedHost(room, user);
    save();
    broadcast(room);
    return result;
  },
  roomOwners() {
    const now = Date.now(),
      online = presence(now);
    return [...rooms.values()].map((room) => {
      const host = room.players.find((p) => p.id === room.host);
      return {
        id: room.id,
        ...(room.testRound?{testRound:true}:{}),
        phase: room.phase,
        hand: room.hand,
        createdAt: room.createdAt || null,
        finishedAt: room.finishedAt || null,
        roundNumber: room.roundNumber || 1,
        roundCount: Math.max(
          room.roundNumber || 1,
          room.completedRounds?.length || 0,
        ),
        gameMode: room.gameMode || "cash",
        playerNames: room.players.map((p) => p.name),
        hostName: host?.name || "-",
        unclaimedHost: !!host && !host.accountId,
        hostAccount: host?.accountId
          ? accounts.getUser(host.accountId)?.username
          : null,
        ...lifecycleView(
          room,
          online.get(room.id) || new Set(),
          now,
          idleTimeout,
        ),
      };
    });
  },
  legacyPlayers() {
    const now = Date.now(),
      online = presence(now);
    return [...rooms.values()]
      .flatMap((r) =>
        r.players
          .filter((p) => !p.accountId&&!p.isBot)
          .map((p) => ({
            room: r.id,
            player: p.id,
            name: p.name,
            phase: r.phase,
            hand: r.hand,
            host: r.host === p.id,
            ...lifecycleView(
              r,
              online.get(r.id) || new Set(),
              now,
              idleTimeout,
            ),
          })),
      )
      .slice(-200);
  },
  roomHistory(id) {
    const room = rooms.get(String(id));
    if (!room) throw new AccountError("房间不存在", 404);
    return {
      ...adminHistory(room),
      presence: lifecycleView(
        room,
        presence().get(room.id) || new Set(),
        Date.now(),
        idleTimeout,
      ),
    };
  },
  accountChanged(user, revoked) {
    for (const room of rooms.values()) {
      let changed = false;
      for (const player of [...room.players,...(room.spectators||[])])
        if (player.accountId === user.id) {
          player.name = user.nickname;
          player.avatar = user.avatar;
          changed = true;
        }
      if (changed) broadcast(room);
    }
    save();
    for (const ws of wss.clients)
      if (ws.accountId === user.id) {
        if (revoked) expire(ws);
        else send(ws, { type: "account", user });
      }
  },
});
function resultsForArchive(room) {
  return room.players.map((p) => ({
    name: p.name,
    buyin: p.buyin,
    stack: p.stack,
    net: p.stack - p.buyin,
  }));
}
setInterval(() => {
  const now = Date.now(),
    connected = presence(now);
  const changedRooms = [];
  for (const room of rooms.values())
    try {
      const online = connected.get(room.id) || new Set();
      const controlsVersion=room.controls?.version;
      updateRoomControls(room,now);
      let changed = updateLifecycle(room, online, now, idleTimeout);
      if(controlsVersion!==room.controls?.version)changed=true;
      if(advanceFlop(room,now))changed=true;
      if (expireTurn(room, now)) changed = true;
      if (updateLifecycle(room, online, now, idleTimeout)) changed = true;
      if(botScheduler.tick(room,online,now))changed=true;
      if (
        online.size &&
        !room.idleEndRequested &&
        canContinueRoom(room)&&(advanceTournament(room, now) || announceTournamentLevel(room, now))
      )
        changed = true;
      if (changed) {
        changedRooms.push(room);
      }
    } catch (e) {
      console.error("Timeout:", e.message);
    }
  if (changedRooms.length) {
    save(changedRooms);
    for (const room of changedRooms) broadcast(room);
  }
}, 250).unref();
setInterval(() => {
  const now = Date.now();
  for (const ws of wss.clients) {
    if (now - ws.lastPongAt > heartbeatTimeout) {
      metrics.observe('wsHeartbeatTimeout',1);
      ws.terminate();
      continue;
    }
    if (ws.readyState === WebSocket.OPEN) probeLatency(ws);
  }
}, heartbeatInterval).unref();
setInterval(()=>{
  for(const id of dirtyLatencyRooms){
    dirtyLatencyRooms.delete(id);const room=rooms.get(id);if(!room)continue;
    const now=Date.now(),map=connections(room,now);
    const packet={type:'player_latency',room:id,serverTime:now,players:[...map].map(([id,connection])=>({id,connection}))};
    for(const ws of wss.clients){
      if(ws.identity?.room!==id||ws.readyState!==WebSocket.OPEN||ws.bufferedAmount>65536)continue;
      const user=accounts.findSession(ws.authToken)?.user;
      if(user?.id===ws.accountId && roomMember(room,user.id)?.id===ws.identity.player && canViewHistory(room,user,rooms))send(ws,packet);
    }
  }
},timing('PLAYER_LATENCY_PUBLISH_MS',1000)).unref();
server.listen(
  Number(process.env.PORT || 3000),
  process.env.HOST || "0.0.0.0",
  () =>
    console.log("Friends Holdem: http://localhost:" + server.address().port),
);
