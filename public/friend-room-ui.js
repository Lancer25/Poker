let previous;
export function confirmMemberKick(room,member,{send,confirm}) {
  if(room.host!==room.me || room.gameMode!=='friends' || member.id===room.me || member.pendingKick || room.phase==='ended')return;
  if(confirm(`移出 ${member.name}？${!member.spectating && ['preflop','flop','turn','river'].includes(room.phase)?'本手正常结算后生效。':'立即生效。'}本场不能重新入座或观战，筹码和战绩保留。`))send('kick',{player:member.id,round:room.roundNumber||1});
}
export function renderFriendRoomUI(room,{send,connected,confirm,feedback}) {
  const panel=document.getElementById('seatDice'),rows=document.getElementById('seatDiceRows'),roll=document.getElementById('rollSeatDice');
  const s=room.seating,show=room.gameMode==='friends' && room.phase==='waiting' && room.hand===0 && !!s;
  panel.hidden=!show || s.status==='idle';
  document.getElementById('game').classList.toggle('seating-active',show && s.status!=='idle');
  roll.hidden=!show || !!room.spectating;
  if(show) {
    const status=s.status==='ready'?'座位已确定 · 即将发牌':s.rollRound?`同点重掷 · 第 ${s.rollRound+1} 轮`:`掷骰排座 · ${s.entries.filter(e=>!e.needsRoll).length}/${s.entries.length}`;
    document.getElementById('seatDiceStatus').textContent=status;
    const oldRows=new Map([...rows.children].map(row=>[row.dataset.player,row]));
    const recent=s.entries.reduce((best,e)=>(e.rolledAt||0)>(best?.rolledAt||0)?e:best,s.entries.find(e=>e.id===room.me)||s.entries[0])?.id;
    const nextRows=[];let arrived=false;
    for(const entry of s.entries) {
      const resultText=entry.dice.length?`${entry.totals.at(-1)} 点${entry.seatNumber?' · '+entry.seatNumber+' 号位':entry.needsRoll?' · 重掷':''}`:'待掷骰';
      const key=JSON.stringify([s.version,entry.dice,entry.totals]);
      const existing=oldRows.get(entry.id);
      if(existing?.dataset.rollKey===key){existing.children[0].textContent=entry.name+(entry.id===room.me?' · 你':'');existing.children[2].textContent=resultText;existing.dataset.recent=String(entry.id===recent);nextRows.push(existing);continue;}
      const row=document.createElement('div');row.className='table-dice-player';row.dataset.player=entry.id;row.dataset.rollKey=key;
      row.dataset.recent=String(entry.id===recent);
      const name=document.createElement('strong');name.textContent=entry.name+(entry.id===room.me?' · 你':'');
      const dice=document.createElement('div');dice.className='dice-pair';dice.setAttribute('role','img');dice.setAttribute('aria-label',entry.dice.length?`骰子 ${entry.dice.join(' 和 ')}`:'尚未掷骰');
      const fresh=!!feedback?.previous && !document.hidden && previous?.id===room.id && previous.version===s.version && (previous.counts[entry.id]||0)<entry.totals.length;
      if(fresh){arrived=true;if(feedback?.moving)row.classList.add('dice-tumbling');}
      for(let i=0;i<2;i++){const img=document.createElement('img');img.src=entry.dice[i]?`/assets/icons/dice-real-${entry.dice[i]}.svg`:'/assets/icons/dice-real-pending.svg';img.alt='';dice.append(img);}
      const result=document.createElement('span');result.className='dice-result';result.textContent=resultText;
      row.append(name,dice,result);nextRows.push(row);
    }
    for(let i=0;i<nextRows.length;i++)if(rows.children[i]!==nextRows[i])rows.insertBefore(nextRows[i],rows.children[i]||null);
    for(const row of [...rows.children])if(!nextRows.includes(row))row.remove();
    if(arrived)feedback?.sound('dice');
    const idle=s.status==='idle',legacyReady=s.status==='ready'&&!Number.isFinite(s.autoStartAt),canStart=idle||legacyReady;
    roll.disabled=!connected || (canStart?room.host!==room.me || s.entries.length<2:!s.canRoll);
    document.getElementById('rollSeatDiceLabel').textContent=canStart?(room.host===room.me?'开始比赛':'等待房主开局'):s.status==='ready'?'即将发牌':s.canRoll?(s.rollRound?'重掷骰子':'掷骰子'):'等待其他牌手';
    roll.onclick=()=>{roll.disabled=true;if(canStart)send('start');else send('rollseat',{version:s.version,rollRound:s.rollRound});};
  }
  const history=document.getElementById('seatDiceHistory'),historyRows=document.getElementById('seatDiceHistoryRows');
  history.hidden=!s?.entries.some(e=>e.totals.length);
  historyRows.replaceChildren();
  if(!history.hidden)for(const entry of s.entries){const line=document.createElement('p');line.textContent=`${entry.name} · ${entry.totals.join(' / ')||'待掷骰'}${entry.seatNumber?' · '+entry.seatNumber+' 号位':''}`;historyRows.append(line);}
  previous=s?{id:room.id,version:s.version,counts:Object.fromEntries(s.entries.map(e=>[e.id,e.totals.length]))}:null;
  const manager=document.getElementById('friendManager'),members=document.getElementById('friendMembers');
  manager.hidden=room.gameMode!=='friends' || room.host!==room.me || room.phase==='ended';members.replaceChildren();
  if(!manager.hidden)for(const member of room.manageableMembers||[]) {
    const row=document.createElement('div');row.className='member-row';
    const name=document.createElement('span');name.textContent=member.name+(member.spectating?' · 观战':'');
    if(member.pendingKick){const status=document.createElement('span');status.className='muted';status.textContent='本手后移出';row.append(name,status);}
    else {
      const button=document.createElement('button');button.type='button';button.className='icon-button';button.title=`移出 ${member.name}`;button.setAttribute('aria-label',button.title);button.disabled=!connected;
      const icon=document.createElement('img');icon.src='/assets/icons/user-x.svg';icon.alt='';button.append(icon);
      button.onclick=()=>confirmMemberKick(room,member,{send,confirm});
      row.append(name,button);
    }
    members.append(row);
  }
}
