(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.HandForecast=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function forecastState(room){
    if(!room||room.flopReveal||room.spectating||room.godMode||!['preflop','flop','turn','river'].includes(room.phase))return null;
    const p=room.players.find(p=>p.id===room.me);
    if(!p||p.removed||p.folded||!p.inHand||p.cards.length!==2||p.cards.some(c=>!/^([2-9TJQKA])[shdc]$/.test(c)))return null;
    if(({preflop:0,flop:3,turn:4,river:5})[room.phase]!==room.board.length)return null;
    return {key:JSON.stringify([room.id,room.me,room.roundNumber||1,room.hand,room.phase,p.cards,room.board]),room:room.id,
      query:{round:room.roundNumber||1,hand:room.hand,phase:room.phase,boardCount:room.board.length}};
  }
  class ForecastController {
    constructor({getRoom,enabled,load,render}){Object.assign(this,{getRoom,enabled,load,render});this.key='';this.sequence=0;this.cache=new Map();}
    reset(){this.key='';this.sequence++;this.cache.clear();this.render({status:'hidden'});}
    sync(){
      const context=this.enabled()?forecastState(this.getRoom()):null;
      if(!context){if(this.key){this.key='';this.sequence++;}this.render({status:'hidden'});return;}
      if(context.key===this.key)return;this.key=context.key;const sequence=++this.sequence;
      if(this.cache.has(context.key)){this.render({status:'ready',data:this.cache.get(context.key)});return;}
      this.render({status:'loading'});
      Promise.resolve().then(()=>this.load(context)).then(payload=>{
        if(sequence!==this.sequence || !this.enabled() || forecastState(this.getRoom())?.key!==context.key)return;
        if(payload.round!==context.query.round||payload.hand!==context.query.hand||payload.phase!==context.query.phase||payload.boardCount!==context.query.boardCount)return;
        this.cache.set(context.key,payload.forecast);while(this.cache.size>16)this.cache.delete(this.cache.keys().next().value);
        this.render({status:'ready',data:payload.forecast});
      }).catch(error=>{if(sequence!==this.sequence || forecastState(this.getRoom())?.key!==context.key)return;this.render({status:error.status===409?'hidden':'error',message:'预测暂不可用'});});
    }
  }
  return {forecastState,ForecastController};
});
