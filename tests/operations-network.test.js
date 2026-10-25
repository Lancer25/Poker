import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import {WebSocket} from 'ws';
import {seedAccounts,apiAt,testPassword} from './auth-helpers.js';import {restoreBackup,verifyBackup} from '../server/backup-store.js';
import {createRoomStore} from '../server/room-store.js';
import {createRoom,joinRoom} from '../server/game.js';
import {startHand} from './game-helpers.js';
const children=new WeakMap();
function cleanup(t,dir){children.set(t,[]);t.after(async()=>{for(const child of children.get(t))if(child.exitCode===null){const end=once(child,'exit');child.kill();await end;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});}
async function server(t,dir,env={}){const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir,BACKUP_INTERVAL_MS:'0',...env},stdio:['ignore','pipe','pipe']});children.get(t).push(child);return Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
for(const mode of ['json','sqlite'])test(`${mode}: private admin backups restore an independent instance with accounts and an active hand`,{timeout:20000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-ops-'));cleanup(t,dir);const {store,admin,invite}=await seedAccounts(dir),auth=store.startSession(admin.id),user=await store.register({username:'operator_user',nickname:'User',password:testPassword,inviteCode:invite.code});
 const {room}=createRoom('Admin',10000,10,20,60,'friends');joinRoom(room,'User');room.players[0].accountId=admin.id;room.players[1].accountId=user.user.id;startHand(room,room.host);
 const storage=createRoomStore(dir,{mode});storage.save({rooms:[room],sessions:[]});storage.close();
 const port=await server(t,dir,{ROOM_STORAGE:mode});
 assert.equal((await apiAt(port,'/api/admin/diagnostics')).status,401);assert.equal((await apiAt(port,'/api/admin/diagnostics','GET',undefined,user.token)).status,403);
 const diagnostics=await apiAt(port,'/api/admin/diagnostics','GET',undefined,auth.token);assert.equal(diagnostics.status,200);assert.equal(diagnostics.data.storage.mode,mode);assert.ok(!JSON.stringify(diagnostics.data).includes(auth.token));
 const backup=await apiAt(port,'/api/admin/backups','POST',{},auth.token);assert.equal(backup.status,200);assert.match(backup.data.backup.id,/^backup-/);
 const catalog=await apiAt(port,'/api/admin/backups','GET',undefined,auth.token);assert.equal(catalog.data.backups[0].valid,true);assert.equal(catalog.data.backups[0].path,undefined);
 const folder=path.join(dir,'backups',backup.data.backup.id);assert.equal(verifyBackup(folder).valid,true);const restored=path.join(dir,'restored');restoreBackup(folder,restored);
 const restoredPort=await server(t,restored,{ROOM_STORAGE:mode});const account=await apiAt(restoredPort,'/api/auth/me','GET',undefined,auth.token);assert.equal(account.status,200);assert.equal(account.data.user.id,admin.id);
 const ws=new WebSocket('ws://127.0.0.1:'+restoredPort),packets=[];ws.on('message',raw=>packets.push(JSON.parse(raw)));t.after(()=>ws.terminate());await once(ws,'open');
 async function take(type){const end=Date.now()+4000;while(!packets.some(m=>m.type===type)){if(Date.now()>end)throw Error('restore message timeout');await delay(5);}return packets.splice(packets.findIndex(m=>m.type===type),1)[0];}
 ws.send(JSON.stringify({type:'authenticate',token:auth.token}));await take('account');ws.send(JSON.stringify({type:'resume',room:room.id}));const state=(await take('state')).room;
 assert.equal(state.phase,'preflop');assert.equal(state.hand,1);assert.equal(state.players.find(p=>p.id!==state.me).cards[0],'??');
 ws.send(JSON.stringify({type:'fold',requestId:'restore-fold',decision:state.actionContext}));await take('action_result');const settled=(await take('state')).room;assert.equal(settled.phase,'showdown');
 const history=await apiAt(restoredPort,`/api/rooms/${room.id}/history`,'GET',undefined,auth.token);assert.equal(history.data.hands[0].replay.complete,true);assert.equal(history.data.hands[0].replay.events[0].type,'start');
});
test('optional secure-auth enforcement rejects HTTP API and plain WebSocket without disabling public security status',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-secure-'));cleanup(t,dir);await seedAccounts(dir);const port=await server(t,dir,{REQUIRE_SECURE_AUTH:'1'});
 const info=await apiAt(port,'/api/security');assert.equal(info.status,200);assert.equal(info.data.enforced,true);assert.equal((await apiAt(port,'/api/auth/login','POST',{username:'admin',password:testPassword})).status,426);
 const ws=new WebSocket('ws://127.0.0.1:'+port),packets=[];ws.on('message',raw=>packets.push(JSON.parse(raw)));const [code]=await once(ws,'close');assert.equal(code,1008);assert.equal(packets[0].code,'secure_transport_required');
});
