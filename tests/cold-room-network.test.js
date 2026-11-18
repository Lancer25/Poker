import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {setTimeout as delay} from 'node:timers/promises';import {WebSocket} from 'ws';
import {createRoom} from '../server/game.js';import {createRoomStore} from '../server/room-store.js';import {seedAccounts,apiAt,testPassword} from './auth-helpers.js';

for(const mode of ['json','sqlite'])test(`${mode}: 1001 ended rooms neither block new rooms nor lose authorized history`,{timeout:20000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-cold-network-')),{store,admin,invite}=await seedAccounts(dir),auth=store.startSession(admin.id);
 const outside=await store.register({username:'outside',nickname:'Outside',password:testPassword,inviteCode:invite.code});
 const template=createRoom('Admin').room;template.phase='ended';template.players[0].accountId=admin.id;
 template.hand=1;template.history=[{hand:1,board:['2s','3s','4s'],results:[],pots:[],deck:['private-sentinel']}];
 const rooms=Array.from({length:1001},(_,i)=>({...structuredClone(template),id:String(800000+i)}));
 const storage=createRoomStore(dir,{mode});storage.save({rooms,sessions:[]});storage.close();
 const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:'0',DATA_DIR:dir,ROOM_STORAGE:mode,BACKUP_INTERVAL_MS:'0'},stdio:['ignore','pipe','pipe']});
 let ws;t.after(async()=>{ws?.terminate();if(child.exitCode===null&&child.signalCode===null){const end=once(child,'exit');child.kill();await end;}assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 const port=Number(String((await once(child.stdout,'data'))[0]).match(/localhost:(\d+)/)[1]);
 const diagnostic=()=>apiAt(port,'/api/admin/diagnostics','GET',undefined,auth.token);
 if(mode==='sqlite'){const d=(await diagnostic()).data;assert.equal(d.storage.coldRooms,1001);assert.equal(d.storage.historyReads,0);}
 ws=new WebSocket('ws://127.0.0.1:'+port);const packets=[];ws.on('message',raw=>packets.push(JSON.parse(raw)));await once(ws,'open');
 async function take(type){const end=Date.now()+5000;while(!packets.some(m=>m.type===type)){if(Date.now()>end)throw Error('cold network timeout '+type);await delay(5);}return packets.splice(packets.findIndex(m=>m.type===type),1)[0];}
 ws.send(JSON.stringify({type:'authenticate',token:auth.token,compactState:true}));await take('account');ws.send(JSON.stringify({type:'create',gameMode:'friends'}));await take('session');assert.equal((await take('state')).room.phase,'waiting');
 if(mode==='sqlite')assert.equal((await diagnostic()).data.storage.historyReads,0);
 const resource='/api/rooms/800000/history';
 assert.equal((await apiAt(port,resource,'GET',undefined,outside.token)).status,403);
 const history=await apiAt(port,resource,'GET',undefined,auth.token);assert.equal(history.status,200);assert.equal(history.data.hands.length,1);assert.ok(!JSON.stringify(history.data).includes('private-sentinel'));
 assert.equal((await diagnostic()).data.rooms.total,1002);
});
