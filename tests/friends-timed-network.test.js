import {startHand} from './game-helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import { WebSocket } from "./protocol-peer.js";
import {seedAccounts,testPassword,apiAt} from './auth-helpers.js';
import {createRoom,joinRoom} from '../server/game.js';
test('friends WS:180s gentle announcement, eliminated god toggles, private ordinary views and persisted reconnect',{timeout:15000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-friend-clock-'));
 const {store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id)];
 for(let i=1;i<3;i++)auth.push(await store.register({username:'clock_'+i,nickname:'P'+i,password:testPassword,inviteCode:invite.code}));
 const {room}=createRoom('Host',undefined,undefined,undefined,undefined,'friends');joinRoom(room,'P1');joinRoom(room,'P2');
 room.players.forEach((p,i)=>p.accountId=auth[i].user.id);
 Object.assign(room.players[1],{stack:0,eliminated:true,place:3});room.players[0].stack=room.players[2].stack=15000;
 startHand(room,room.host);room.tournament.startedAt=Date.now()-179000;
 writeFileSync(dir+'/rooms.json',JSON.stringify({rooms:[room],sessions:[]}));
 let child,port;const peers=[];
 async function boot(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
 async function stop(){if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 t.after(async()=>{for(const p of peers)p.ws.terminate();await stop();assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 async function until(check){const end=Date.now()+5000;while(!check()){if(Date.now()>end)throw Error('Timed friends network state timeout');await delay(5);}}
 async function client(index){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));}};peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')p.state=m.room;else p.queue.push(m);});await once(ws,'open');p.send('authenticate',{token:auth[index].token,compactState:true});await until(()=>p.queue.some(m=>m.type==='account'));p.send('resume',{room:room.id});await until(()=>p.state);return p;}
 await boot();const owner=await client(0),observer=await client(1);
 assert.equal(observer.state.canGodMode,true);observer.send('godmode',{enabled:true});await until(()=>observer.state.godMode);
 assert.ok(observer.state.players.filter(p=>p.id!==observer.state.me).every(p=>p.cards.length===2&&p.cards.every(c=>c!=='??')));
 assert.ok(owner.state.players.find(p=>p.id===room.players[2].id).cards.every(c=>c==='??'));
 assert.equal(observer.state.deck,undefined);assert.equal(observer.state.board.length,0);
 await until(()=>owner.state.tournament.pendingLevel?.big===30);assert.deepEqual([owner.state.small,owner.state.big],[10,20]);
 const history=await apiAt(port,'/api/rooms/'+room.id+'/history','GET',undefined,auth[1].token);assert.equal(history.status,200);assert.ok(!JSON.stringify(history.data).includes('"cards"'));
 await stop();await boot();const restored=await client(1);assert.equal(restored.state.godMode,true);
 restored.send('call');await until(()=>restored.queue.some(m=>m.type==='error'));
 restored.send('godmode',{enabled:false});await until(()=>!restored.state.godMode);
 assert.ok(restored.state.players.filter(p=>p.id!==restored.state.me).every(p=>p.cards.every(c=>c==='??')));
});
