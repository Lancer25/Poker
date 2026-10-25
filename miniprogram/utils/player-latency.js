(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PlayerLatency=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  function latencyBadge(connection,now){
    let state='muted',text='--',title='暂无有效延迟采样';
    if(connection?.online===false){text='离线';title='牌手已离线';}
    else if(connection && Number.isFinite(connection.measuredAt) && (now<connection.measuredAt || now-connection.measuredAt>45000 || connection.rttMs===null))title='延迟采样已过期';
    else if(connection?.online===true && Number.isFinite(connection.rttMs) && connection.rttMs>=0 && connection.rttMs<=120000 && Number.isFinite(connection.measuredAt)){
      const ms=Math.round(connection.rttMs);state=ms<=200?'good':ms<=500?'warning':'bad';
      text=ms<1000?ms+'ms':ms<10000?(ms/1000).toFixed(1)+'s':Math.round(ms/1000)+'s';
      title='网络往返延迟 '+ms+' 毫秒（多个连接取最高有效值）';
    }
    return {state,text,title,icon:'/assets/icons/signal-'+state+'.svg'};
  }
  return {latencyBadge};
});
