import {WebSocket as Socket} from 'ws';
import {randomUUID} from 'node:crypto';
const betting=new Set(['fold','check','call','raise','allin']);
// Existing scenario tests use current-decision packets; protocol-negative tests use raw ws.
export class WebSocket extends Socket{
 constructor(...args){super(...args);this.on('message',raw=>{const msg=JSON.parse(raw);if(msg.type==='state')this.protocolRoom=msg.room;});}
 send(raw,...args){
  if(typeof raw==='string'){
   const msg=JSON.parse(raw);
   if(betting.has(msg.type)&&!Object.hasOwn(msg,'decision')){msg.requestId??=randomUUID();msg.decision=this.protocolRoom?.actionContext;raw=JSON.stringify(msg);}
  }
  return super.send(raw,...args);
 }
}
