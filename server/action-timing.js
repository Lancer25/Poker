import {performance} from 'node:perf_hooks';
export const TIMED_ACTIONS = new Set(['fold','check','call','raise','allin']);
export class ActionTiming {
  constructor(clock=()=>performance.now()){this.clock=clock;this.reset();}
  reset(){this.pending=null;this.sent=null;}
  cancel(){this.pending=null;}
  start(id,receivedAt=this.clock()){
    this.pending=null;
    if(id===undefined)return;
    if(typeof id!=='string'||!/^[a-z0-9-]{1,48}$/.test(id))throw Error('操作标识无效');
    this.pending={id,receivedAt};
  }
  receipt(){
    if(!this.pending)return null;
    const {id,receivedAt}=this.pending;this.pending=null;
    const serverMs=Math.max(0,this.clock()-receivedAt);
    this.sent={id,serverMs,sampled:false};return {id,serverMs};
  }
  sample({id,totalMs,renderMs}){
    if(!this.sent||this.sent.id!==id||this.sent.sampled)return null;
    if(!Number.isFinite(totalMs)||totalMs<0||totalMs>120000||!Number.isFinite(renderMs)||renderMs<0||renderMs>30000||renderMs>totalMs+10)
      throw Error('操作性能参数无效');
    this.sent.sampled=true;
    return {actionTotalMs:totalMs,actionServerMs:this.sent.serverMs,actionRenderMs:renderMs,
      actionTransitMs:Math.max(0,totalMs-this.sent.serverMs-renderMs)};
  }
}
