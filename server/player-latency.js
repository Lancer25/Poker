import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
export const LATENCY_SAMPLE_MAX_AGE_MS=45000;
export function resetLatency(ws){ws.pendingLatencyPing=null;ws.latencySample=null;}
export function probeLatency(ws,now=performance.now(),nonce=randomBytes(8)){
  if(ws.readyState!==1||ws.pendingLatencyPing)return false;
  ws.pendingLatencyPing={nonce,startedAt:now};
  try{ws.ping(nonce);}catch{ws.pendingLatencyPing=null;return false;}
  return true;
}
export function receiveLatencyPong(ws,data,now=performance.now(),wallNow=Date.now()){
  const pending=ws.pendingLatencyPing;
  if(!pending||!Buffer.isBuffer(data)||!pending.nonce.equals(data)||now<pending.startedAt||now-pending.startedAt>120000)return false;
  ws.pendingLatencyPing=null;
  ws.latencySample={rttMs:Math.round(now-pending.startedAt),measuredAt:wallNow,accountId:ws.accountId};
  return true;
}
export function playerConnections(room,sockets,getUser,now=Date.now(),heartbeatTimeout=45000){
  const result=new Map(room.players.map(p=>[p.id,{online:false,rttMs:null,measuredAt:null}]));
  for(const ws of sockets){
    if(ws.readyState!==1||ws.identity?.room!==room.id||!Number.isFinite(ws.lastPongAt)||now-ws.lastPongAt>heartbeatTimeout)continue;
    const player=room.players.find(p=>p.id===ws.identity.player),user=getUser(ws.authToken);
    if(!player||player.removed||!user||user.id!==ws.accountId||player.accountId!==user.id)continue;
    const connection=result.get(player.id);connection.online=true;
    const sample=ws.latencySample;
    if(!sample||sample.accountId!==user.id||!Number.isFinite(sample.measuredAt)||!Number.isFinite(sample.rttMs)||sample.rttMs<0||sample.rttMs>120000)continue;
    const fresh=now>=sample.measuredAt && now-sample.measuredAt<=LATENCY_SAMPLE_MAX_AGE_MS;
    if(fresh && (connection.rttMs===null || sample.rttMs>=connection.rttMs)){
      connection.rttMs=sample.rttMs;connection.measuredAt=sample.measuredAt;
    }else if(connection.rttMs===null)connection.measuredAt=Math.max(connection.measuredAt||0,sample.measuredAt);
  }
  return result;
}
