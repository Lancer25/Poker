export class ConnectionRecovery {
  constructor({reconnect,drop,probe,online=()=>navigator.onLine!==false,visible=()=>!document.hidden,
    now=()=>performance.now(),wallNow=()=>Date.now(),setTimer=(fn,ms)=>setTimeout(fn,ms),clearTimer=id=>clearTimeout(id),random=Math.random}) {
    Object.assign(this,{reconnect,drop,probe,online,visible,now,wallNow,setTimer,clearTimer,random});
    this.mode='stopped';this.attempt=0;this.pending=null;this.lastProbe=-Infinity;this.hiddenAt=null;
  }
  clear(name){if(this[name]!=null)this.clearTimer(this[name]);this[name]=null;}
  clearConnection(){for(const key of ['stageTimer','pulseTimer','probeTimer'])this.clear(key);this.pending=null;}
  armStage(ms){this.clear('stageTimer');this.deadline=this.now()+ms;this.stageTimer=this.setTimer(()=>this.failed('stage_timeout'),ms);}
  connecting(){this.clearConnection();this.clear('retryTimer');this.hiddenAt=null;this.mode='connecting';this.connectionStarted=this.now();this.armStage(8000);}
  opened(){if(this.mode!=='connecting')return;this.mode='authenticating';this.armStage(6000);}
  authenticated(awaitState){if(this.mode==='stopped')return;if(awaitState){this.mode='resuming';this.armStage(6000);}else this.ready();}
  ready(){
    if(this.mode==='stopped'||this.mode==='ready')return;
    this.clearConnection();this.mode='ready';this.attempt=0;this.schedulePulse();
  }
  schedulePulse(){
    this.clear('pulseTimer');if(this.mode!=='ready'||!this.visible())return;
    this.pulseTimer=this.setTimer(()=>{this.pulseTimer=null;if(this.mode==='ready'){this.check();this.schedulePulse();}},10000);
  }
  check(timeout=6000){
    if(this.mode!=='ready'||!this.visible()||this.pending!==null||this.now()-this.lastProbe<1000)return;
    if(!this.online()){this.wake();return;}
    this.lastProbe=this.now();const echo=this.probe();
    if(this.mode!=='ready')return;
    if(!Number.isFinite(echo)){this.failed('probe_unavailable');return;}
    this.pending=echo;this.probeTimer=this.setTimer(()=>this.failed('probe_timeout',{immediate:timeout<6000}),timeout);
  }
  acknowledge(echo){
    if(this.pending===null||echo!==this.pending)return false;
    this.pending=null;this.clear('probeTimer');return true;
  }
  failed(reason='closed',{immediate=false}={}){
    if(['stopped','waiting','offline'].includes(this.mode))return;
    this.clearConnection();this.clear('retryTimer');this.mode=this.online()?'waiting':'offline';this.drop(reason);
    if(this.mode!=='waiting'||!this.visible())return;
    const backoff=Math.min(8000,250*2**Math.min(this.attempt++,6))*(.85+.3*this.random());
    const delay=immediate?0:backoff;
    this.retryTimer=this.setTimer(()=>{this.retryTimer=null;if(!this.online()){this.mode='offline';return;}if(!this.visible())return;this.mode='idle';this.reconnect();},delay);
  }
  suspend(){if(this.mode==='stopped')return;if(this.hiddenAt===null)this.hiddenAt=this.wallNow();this.clearConnection();this.clear('retryTimer');this.lastProbe=-Infinity;}
  wake({force=false}={}){
    if(this.mode==='stopped')return;
    if(!this.online()){
      if(this.mode!=='offline'){this.clearConnection();this.clear('retryTimer');this.mode='offline';this.drop('offline');}return;
    }
    if(!this.visible())return;
    const away=this.hiddenAt===null?0:Math.max(0,this.wallNow()-this.hiddenAt);this.hiddenAt=null;
    if((away>=3000||(force&&this.now()-this.connectionStarted>=1000))&&['ready','connecting','authenticating','resuming'].includes(this.mode)){
      this.failed('foreground_resume',{immediate:true});return;
    }
    if(this.mode==='ready'){this.check(2000);this.schedulePulse();return;}
    if(['idle','waiting','offline'].includes(this.mode)){this.clear('retryTimer');this.mode='idle';this.reconnect();return;}
    if(this.now()>=this.deadline)this.failed('stage_timeout');
    else{this.clear('stageTimer');this.stageTimer=this.setTimer(()=>this.failed('stage_timeout'),this.deadline-this.now());}
  }
  stop(){this.clearConnection();this.clear('retryTimer');this.mode='stopped';this.attempt=0;this.hiddenAt=null;}
}
