export const DENOMINATIONS=[5000,1000,500,100,25,10,5];
export const ROLE_BADGES={
  dealer:{label:'庄家',src:'/assets/badges/role-dealer-v1.webp'},
  'small-blind':{label:'小盲',src:'/assets/badges/role-small-blind-v1.webp'},
  'big-blind':{label:'大盲',src:'/assets/badges/role-big-blind-v1.webp'},
};
export function chipBreakdown(amount,maxGroups=3){
  if(!Number.isSafeInteger(amount)||amount<=0)return [];
  let rest=amount;const groups=[];
  for(const value of DENOMINATIONS){const count=Math.floor(rest/value);if(count){groups.push({value,count});rest-=value*count;}}
  if(groups.length<=maxGroups)return groups;
  const keep=groups.slice(0,Math.max(0,maxGroups-1));
  const remainder=Math.floor(amount/5)*5-keep.reduce((sum,g)=>sum+g.value*g.count,0);
  const value=DENOMINATIONS.find(value=>remainder%value===0);
  return [...keep,{value,count:remainder/value}];
}
export function chipBundle(amount,maxGroups=3){
  const node=document.createElement('div'),groups=chipBreakdown(amount,maxGroups);node.className='chip-bundle wager-chips';node.dataset.groups=String(groups.length);
  node.setAttribute('role','img');node.setAttribute('aria-label',`筹码 ${amount.toLocaleString()}`);node.title=node.getAttribute('aria-label');
  for(const group of groups){
    const column=document.createElement('div');column.className='chip-group';column.dataset.value=String(group.value);column.dataset.count=String(group.count);
    const stack=document.createElement('div');stack.className='chip-stack';
    for(let i=0;i<Math.min(3,group.count);i++){
      const disc=document.createElement('span');disc.className='chip-disc';disc.style.bottom=(i*3)+'px';
      if(i===Math.min(3,group.count)-1){const value=document.createElement('span');value.textContent=group.value>=1000?group.value/1000+'K':String(group.value);disc.append(value);}stack.append(disc);
    }
    column.append(stack);node.append(column);
  }
  return node;
}
export function renderPotChips(amount){const root=document.getElementById('potChips');if(root.dataset.amount===String(amount))return;root.dataset.amount=String(amount);root.replaceChildren(chipBundle(amount));root.hidden=!chipBreakdown(amount).length;}
export function payoutTransfers(before,after){
  if(!before||before.id!==after.id||before.hand!==after.hand||(before.roundNumber||1)!==(after.roundNumber||1))return [];
  return after.players.flatMap(p=>{const old=before.players.find(q=>q.id===p.id);if(!old)return [];
    const amount=p.stack-old.stack+Math.max(0,(p.totalBet||0)-(old.totalBet||0))-Math.max(0,(p.buyin||0)-(old.buyin||0));
    return Number.isSafeInteger(amount)&&amount>0?[{id:p.id,amount}]:[];
  });
}
export function renderSeatCharms(avatar,roles){
  if(!roles.length)return;
  const charms=document.createElement('span');charms.className='seat-charms';
  for(const role of roles){const badge=ROLE_BADGES[role];if(!badge)continue;const label=badge.label;
    const token=document.createElement('span');token.className='role-charm '+role;token.title=label;token.setAttribute('role','img');token.setAttribute('aria-label',label);
    const img=document.createElement('img');img.src=badge.src;img.alt='';img.width=96;img.height=96;token.append(img);charms.append(token);
  }
  avatar.append(charms);
}
