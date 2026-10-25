import {startHand,rollNetworkSeats} from './game-helpers.js';
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
import {createRoom,joinRoom,command} from '../server/game.js';

test('nine seats plus spectators: explicit consent, readonly authorization, privacy, recovery and all-tab seating',{timeout:25000},async t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'holdem-spectators-'));
 const {store,admin,invite}=await seedAccounts(dir),auth=[store.startSession(admin.id)];
 for(let i=1;i<11;i++)auth.push(await store.register({username:'spectator_'+i,nickname:'P'+i,password:testPassword,inviteCode:invite.code}));
 function table(count){const r=createRoom('Host',undefined,undefined,undefined,300,'friends').room;for(let i=1;i<count;i++)joinRoom(r,'P'+i);r.players.forEach((p,i)=>p.accountId=auth[i].user.id);startHand(r,r.host);return r;}
 const full=table(9),small=table(2);while(small.phase!=='showdown')command(small,small.players[small.turn].id,'fold');
 writeFileSync(dir+'/rooms.json',JSON.stringify({rooms:[full,small],sessions:[]}));
 let child,port;const peers=[];
 async function stop(){for(const p of peers)p.ws.terminate();if(child?.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 t.after(async()=>{await stop();assert.equal(path.dirname(dir),path.resolve(tmpdir()));rmSync(dir,{recursive:true,force:true});});
 async function boot(){child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:'0',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});port=Number((await once(child.stdout,'data'))[0].toString().match(/localhost:(\d+)/)[1]);}
 async function until(check){const end=Date.now()+6000;while(!check()){if(Date.now()>end)throw Error('Spectator network timeout');await delay(5);}}
 async function client(index){const ws=new WebSocket('ws://127.0.0.1:'+port),p={ws,state:null,queue:[],send(type,data={}){ws.send(JSON.stringify({type,...data}));},async take(type){await until(()=>this.queue.some(m=>m.type===type));return this.queue.splice(this.queue.findIndex(m=>m.type===type),1)[0];}};peers.push(p);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='state')p.state=m.room;else p.queue.push(m);});await once(ws,'open');p.send('authenticate',{token:auth[index].token,compactState:true});await p.take('account');return p;}
 await boot();let host=await client(0),watcher=await client(9),tab=await client(9),stranger=await client(10);
 host.send('resume',{room:full.id});await until(()=>host.state);
 watcher.send('join',{room:full.id});await watcher.take('spectate_offer');assert.equal(watcher.state,null);
 watcher.send('watch',{room:full.id,player:full.host});await watcher.take('session');await until(()=>watcher.state);
 assert.equal(watcher.state.players.length,9);assert.equal(watcher.state.spectating,true);assert.notEqual(watcher.state.me,full.host);assert.ok(watcher.state.players.every(p=>p.cards.length===2&&!p.cards.includes('??')));assert.equal(watcher.state.deck,undefined);
 tab.send('watch',{room:full.id});await tab.take('session');await until(()=>tab.state);await until(()=>host.state.spectatorCount===1);assert.equal(host.state.onlineCount,1);
 assert.ok(host.state.players.filter(p=>p.id!==host.state.me).every(p=>p.cards.every(c=>c==='??')));
 const before=JSON.stringify([host.state.players,host.state.hand,host.state.turn,host.state.deadline]);
 for(const type of ['fold','call','raise','allin','start','end','restart','rebuy','approve','reject','godmode','winningcards','sitin']){
  watcher.send(type,{amount:100,enabled:true,round:1});await watcher.take('error');
 }
 assert.equal(JSON.stringify([host.state.players,host.state.hand,host.state.turn,host.state.deadline]),before);
 stranger.send('resume',{room:full.id});await stranger.take('error');assert.equal(stranger.state,null);
 assert.equal((await apiAt(port,'/api/rooms/'+full.id+'/history','GET',undefined,auth[10].token)).status,403);
 const history=await apiAt(port,'/api/rooms/'+full.id+'/history','GET',undefined,auth[9].token);assert.equal(history.status,200);assert.ok(!JSON.stringify(history.data).includes('"cards"'));
 stranger.send('watch',{room:full.id});await stranger.take('session');await until(()=>stranger.state?.spectating);await until(()=>host.state.spectatorCount===2);
 await apiAt(port,'/api/auth/logout','POST',{},auth[10].token);await until(()=>stranger.ws.readyState===WebSocket.CLOSED);await until(()=>host.state.spectatorCount===1);
 await stop();await boot();host=await client(0);watcher=await client(9);tab=await client(9);
 watcher.send('resume',{room:full.id});tab.send('resume',{room:full.id});await until(()=>watcher.state?.spectating&&tab.state?.spectating);assert.equal(watcher.state.players.length,9);
 const seated=await client(0);seated.send('watch',{room:full.id});await seated.take('error');assert.equal(seated.state,null);
 watcher.send('leave');await watcher.take('left');tab.send('leave');await tab.take('left');watcher.state=null;tab.state=null;
 watcher.send('watch',{room:small.id});const oldSession=(await watcher.take('session')).token;tab.send('watch',{room:small.id});await tab.take('session');await until(()=>watcher.state?.id===small.id&&tab.state?.id===small.id);
 host.send('resume',{room:small.id});await until(()=>host.state?.id===small.id);host.send('end');await until(()=>watcher.state.phase==='ended');assert.equal(watcher.state.godMode,false);
 host.send('restart',{round:1});await until(()=>watcher.state.canTakeSeat&&tab.state.canTakeSeat);assert.equal(host.state.players.length,2);
 watcher.send('sitin');tab.send('sitin');await until(()=>!watcher.state.spectating&&!tab.state.spectating);assert.equal(watcher.state.players.length,3);assert.equal(watcher.state.me,tab.state.me);assert.equal(watcher.state.spectatorCount,0);
 const otherSeat=await client(1);otherSeat.send('resume',{room:small.id});await until(()=>otherSeat.state);
 await rollNetworkSeats([host,watcher,otherSeat],until);
 host.send('start');await until(()=>watcher.state.phase==='preflop');assert.ok(watcher.state.players.filter(p=>p.id!==watcher.state.me).every(p=>p.cards.every(c=>c==='??')));
 await stop();await boot();watcher=await client(9);watcher.send('resume',{token:oldSession});await until(()=>watcher.state);assert.equal(watcher.state.spectating,false);assert.equal(watcher.state.players.length,3);
});
