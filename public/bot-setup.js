export function renderBotSetup(room,{user,connected,send}){
  const section=document.getElementById('botSetup'),setup=room?.botSetup;
  section.hidden=!(user?.role==='admin'&&room.host===room.me&&setup?.canManage);
  if(section.hidden)return;
  const count=document.getElementById('botCount'),add=document.getElementById('addTestBots'),list=document.getElementById('testBotList');
  count.max=String(Math.min(8,setup.capacity));count.disabled=!connected||!setup.capacity;
  if(!/^\d+$/.test(count.value)||Number(count.value)<1||Number(count.value)>Math.max(1,setup.capacity))count.value='1';
  add.disabled=!connected||!setup.capacity;
  const dispatch=data=>{section.querySelectorAll('button').forEach(b=>b.disabled=true);send('testbots',{...data,round:room.roundNumber||1,version:setup.version});};
  add.onclick=()=>{const n=Number(count.value);if(!Number.isSafeInteger(n)||n<1||n>Math.min(8,setup.capacity)){count.reportValidity();return;}dispatch({action:'add',count:n});};
  list.replaceChildren();
  for(const bot of setup.bots){const row=document.createElement('div');row.className='bot-setup-row';
    const name=document.createElement('span');name.textContent=bot.name;
    const remove=document.createElement('button');remove.type='button';remove.className='icon-button';remove.disabled=!connected;remove.title='移除 '+bot.name;remove.setAttribute('aria-label',remove.title);
    const icon=document.createElement('img');icon.src='/assets/icons/user-x.svg';icon.alt='';remove.append(icon);remove.onclick=()=>dispatch({action:'remove',player:bot.id});row.append(name,remove);list.append(row);
  }
}
