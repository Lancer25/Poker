import solver from 'pokersolver';
import {joinRoom,command,snapshot} from './game.js';
import {seatedPlayers,resetSeating} from './friend-room.js';

function editable(room){return room.phase==='waiting'&&room.hand===0&&!room.idleEndRequested&&(!room.seating||room.seating.status==='idle');}
export function botSetup(room,user,id){
  const host=room.players.find(p=>p.id===room.host);
  return {canManage:user?.role==='admin'&&id===room.host&&host?.accountId===user.id&&!host.removed&&editable(room),
    version:room.botVersion||0,capacity:Math.max(0,9-seatedPlayers(room).length),
    bots:seatedPlayers(room).filter(p=>p.isBot).map(p=>({id:p.id,name:p.name}))};
}
export function manageBots(room,user,id,data){
  if(user?.role!=='admin')throw Error('仅管理员可以添加测试陪练');
  const host=room.players.find(p=>p.id===room.host);
  if(id!==room.host||host?.accountId!==user.id||host.removed)throw Error('仅管理员房主可以调整陪练');
  if(!editable(room))throw Error('开局或排座已开始，不能调整陪练');
  if(data.round!==(room.roundNumber||1)||data.version!==(room.botVersion||0))throw Error('陪练配置已更新，请重试');
  if(data.action==='add'){
    if(!Number.isSafeInteger(data.count)||data.count<1||data.count>8)throw Error('陪练数量需为 1 至 8');
    if(seatedPlayers(room).length+data.count>9)throw Error('总人数不能超过 9 人，房间已满');
    for(let i=0;i<data.count;i++){
      room.botSerial=(room.botSerial||0)+1;
      const bot=joinRoom(room,`陪练 ${room.botSerial}`);bot.isBot=true;
    }
  }else if(data.action==='remove'){
    const bot=room.players.find(p=>p.id===data.player&&p.isBot&&!p.removed);
    if(!bot)throw Error('仅可移除有效的陪练席位');
    bot.removed=true;bot.cards=[];bot.inHand=false;
    room.players=room.players.filter(p=>p!==bot);resetSeating(room);
  }else throw Error('未知陪练操作');
  room.testRound=seatedPlayers(room).some(p=>p.isBot);room.botVersion=(room.botVersion||0)+1;
  if(room.controls)room.controls.autoApproveBots=room.testRound;
}
export function botAction(view,random=Math.random){
  const me=view.players.find(p=>p.id===view.me);
  if(view.flopReveal||view.godMode||view.spectating||!['preflop','flop','turn','river'].includes(view.phase)||view.players[view.turn]?.id!==view.me||!me?.inHand||me.folded||me.removed||!(me.stack>0))return null;
  if(me.cards.length!==2||me.cards.some(c=>!/^([2-9TJQKA])[shdc]$/.test(c)))return null;
  const cards=[...me.cards,...view.board];let strong;
  if(cards.length>=5)strong=solver.Hand.solve(cards).rank>=3;
  else{const ranks=me.cards.map(c=>'23456789TJQKA'.indexOf(c[0]));strong=(ranks[0]===ranks[1]&&ranks[0]>=8)||ranks.every(n=>n>=9);}
  const call=Math.min(view.toCall,me.stack),amount=view.currentBet+view.minRaise;
  if(strong&&view.canRaise&&random()<.18&&amount<=me.bet+me.stack*.25)return {type:'raise',amount};
  if(!call)return {type:'check'};
  if(!strong&&call>Math.max(view.big*2,me.stack*.15)&&random()>.2)return {type:'fold'};
  return {type:'call'};
}
export function createBotScheduler({thinkDelay=()=>800+Math.floor(Math.random()*700),random=Math.random}={}){
  const schedules=new WeakMap();
  return {tick(room,online,now=Date.now()){
    const bots=seatedPlayers(room).filter(p=>p.isBot);
    const humanOnline=room.players.some(p=>!p.isBot&&!p.removed&&online.has(p.id));
    if(!humanOnline||!bots.length||room.idleEndRequested||room.phase==='ended'){schedules.delete(room);return false;}
    let pending=schedules.get(room);if(!pending){pending=new Map();schedules.set(room,pending);}
    let changed=false;
    for(const bot of bots){
      const seating=room.seating,rolling=room.phase==='waiting'&&room.hand===0&&seating?.status==='rolling'&&seating.pending.includes(bot.id)&&seating.rolls[bot.id]?.lastRound!==seating.rollRound;
      const voting=room.testRound&&room.requests.find(r=>r.status==='pending'&&r.voters?.includes(bot.id)&&!r.approvals.includes(bot.id));
      const acting=room.players[room.turn]?.id===bot.id&&!room.flopReveal&&['preflop','flop','turn','river'].includes(room.phase)&&bot.inHand&&!bot.folded&&bot.stack>0;
      if(!rolling&&!voting&&!acting){pending.delete(bot.id);continue;}
      const key=rolling?`dice:${seating.version}:${seating.rollRound}`:voting?'vote:'+voting.id:[room.roundNumber,room.hand,room.phase,room.turn,room.deadline].join(':');
      const scheduled=pending.get(bot.id);
      if(!scheduled||scheduled.key!==key){pending.set(bot.id,{key,due:now+thinkDelay()});continue;}
      if(now<scheduled.due)continue;
      pending.delete(bot.id);
      const view=snapshot(room,bot.id,{compact:true});let action;
      if(rolling&&view.seating?.canRoll)action={type:'rollseat',version:view.seating.version,rollRound:view.seating.rollRound};
      else if(voting&&view.requests.some(r=>r.id===voting.id&&r.canApprove))action={type:'approve',request:voting.id};
      else if(acting)action=botAction(view,random);
      if(!action)continue;
      if(!['rollseat','approve'].includes(action.type)&&(!Number.isFinite(room.deadline)||now>=room.deadline))continue;
      command(room,bot.id,action.type,action);changed=true;
    }
    for(const id of pending.keys())if(!bots.some(p=>p.id===id))pending.delete(id);
    return changed;
  }};
}
