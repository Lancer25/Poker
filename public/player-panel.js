import {confirmMemberKick} from '/friend-room-ui.js?v=playerforecast1';
import {paintPortrait} from '/room-ui.js?v=charms1';
export class PlayerPanel {
  constructor({getRoom,load,send,connected,networkNow=()=>Date.now()}) {
    Object.assign(this,{getRoom,load,send,connected,networkNow});this.selected=null;this.sequence=0;this.data=null;this.marker='';
    this.overlay=document.getElementById('playerDialog');this.dialog=this.overlay.querySelector('[role=dialog]');
    document.getElementById('closePlayerDialog').onclick=()=>this.close();document.getElementById('refreshPlayerStats').onclick=()=>this.refresh();
    this.overlay.onclick=e=>{if(e.target===this.overlay)this.close();};
    document.addEventListener('keydown',e=>{if(!this.selected)return;if(e.key==='Escape'){e.preventDefault();this.close();return;}if(e.key==='Tab'){const buttons=[...this.dialog.querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled),i=buttons.indexOf(document.activeElement);if(buttons.length && (i<0||(e.shiftKey&&i===0)||(!e.shiftKey&&i===buttons.length-1))){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0].focus();}}});
  }
  open(id) {
    const r=this.getRoom(),p=r?.players.find(p=>p.id===id&&!p.removed);if(!p||!this.connected())return;
    this.previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';this.selected={id,room:r.id,round:r.roundNumber||1,viewer:r.me};this.data=null;document.getElementById('profileStatsNote').textContent='';this.marker='';this.overlay.hidden=false;this.sync();document.getElementById('closePlayerDialog').focus();
  }
  close(){const id=this.selected?.id;if(this.selected)document.body.style.overflow=this.previousOverflow||'';this.selected=null;this.sequence++;this.data=null;this.overlay.hidden=true;document.getElementById('profileStats').replaceChildren();if(id)document.querySelector(`#seats .seat[data-player="${id}"] .avatar`)?.focus();}
  sync() {
    if(!this.selected)return;const r=this.getRoom(),s=this.selected;
    if(!this.connected()||!r||r.id!==s.room||(r.roundNumber||1)!==s.round||r.me!==s.viewer||!r.players.some(p=>p.id===s.id&&!p.removed)){this.close();return;}
    const marker=`${r.hand}:${['showdown','ended'].includes(r.phase)}`;
    this.render();if(marker!==this.marker){this.marker=marker;this.refresh();}
  }
  async refresh(){
    if(!this.selected)return;const selected=this.selected,sequence=++this.sequence;
    this.data=null;document.getElementById('profileStats').textContent='统计加载中';document.getElementById('refreshPlayerStats').disabled=true;
    try{const value=await this.load(selected);if(sequence!==this.sequence||this.selected!==selected)return;
      if(value.room!==selected.room||value.round!==selected.round||value.player.id!==selected.id)return;
      this.data=value;this.render();
    }catch(error){if(sequence!==this.sequence)return;if(error.status===403||error.status===404){this.close();return;}document.getElementById('profileStats').textContent='统计暂不可用，请重试';}
    finally{if(sequence===this.sequence)document.getElementById('refreshPlayerStats').disabled=false;}
  }
  render(){
    if(!this.selected)return;const r=this.getRoom(),p=r.players.find(p=>p.id===this.selected.id&&!p.removed);if(!p)return this.close();
    if(r.players[r.turn]?.id!==r.me)document.getElementById('profileTurn').hidden=true;
    document.getElementById('playerTitle').textContent=p.name;
    const avatar=document.getElementById('profileAvatar');avatar.replaceChildren();paintPortrait(avatar,p.name,r.players.indexOf(p));
    avatar.classList.toggle('bot-avatar',!!p.isBot);
    if(p.isBot){avatar.classList.remove('illustrated-avatar');const img=document.createElement('img');img.src='/assets/icons/bot.svg';img.alt='测试陪练';avatar.append(img);}
    else if(p.avatar){const img=document.createElement('img');img.src=p.avatar;img.alt=p.name+'的头像';avatar.append(img);}else avatar.textContent=p.name.slice(0,1);
    const index=r.players.indexOf(p),roles=r.hand>0?[[r.dealer,'庄家'],[r.smallBlind,'小盲'],[r.bigBlind,'大盲']].filter(([seat])=>seat===index).map(([,label])=>label):[];
    document.getElementById('profileStatus').textContent=[r.host===p.id?'房主':'牌手',p.seatNumber?p.seatNumber+' 号位':'',...roles,p.pendingKick?'本手后移出':p.eliminated?'已淘汰':p.folded?'已弃牌':p.inHand?(p.stack===0?'全下':'在赛'):'等待开局'].filter(Boolean).join(' · ');
    const network=p.isBot?{text:'服务器陪练',title:'测试机器人',state:'muted'}:window.PlayerLatency.latencyBadge(this.connected()?p.connection:null,this.networkNow());
    const fields=[['当前筹码',p.stack],['累计投入',p.buyin],['本场净输赢',p.stack-p.buyin],['本手总下注',p.totalBet||0],['网络延迟',network.text]],info=document.getElementById('profileInfo');info.replaceChildren();
    for(const [label,value]of fields){const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=typeof value==='number'?value.toLocaleString():value;if(label==='网络延迟'){dd.title=network.title;dd.className='profile-network '+network.state;}row.append(dt,dd);info.append(row);}
    if(this.data){const stats=this.data.statistics,node=document.getElementById('profileStats');node.replaceChildren();for(const [label,value]of [['已统计手数',stats.hands],['获胜手数',stats.wins],['全服胜率',stats.winRate===null?'暂无统计':stats.winRate.toFixed(2)+'%']]){const item=document.createElement('div'),name=document.createElement('span'),v=document.createElement('strong');name.textContent=label;v.textContent=String(value);item.append(name,v);node.append(item);}document.getElementById('profileStatsNote').textContent=!stats.available?'未关联账号，暂无全服统计':stats.since?'统计起点 '+new Date(stats.since).toLocaleDateString('zh-CN')+' · 平分计获胜，退款不计胜':'从更新后的实际参与手牌开始统计';}
    const kick=document.getElementById('profileKick');kick.hidden=!(this.data?.canKick && r.host===r.me && p.id!==r.me && !p.pendingKick && r.phase!=='ended');kick.disabled=!this.connected();kick.onclick=()=>confirmMemberKick(r,p,{send:this.send,confirm:window.confirm.bind(window)});
  }
  tick(room,seconds){if(!this.selected)return;const node=document.getElementById('profileTurn');node.hidden=room?.players[room.turn]?.id!==room?.me || !Number.isFinite(seconds);node.textContent=`轮到你行动 · ${seconds}`;node.classList.toggle('urgent',seconds<=10);}
}
