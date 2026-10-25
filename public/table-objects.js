import {chipBundle,chipBreakdown} from './chip-display.js?v=hardening1';
const active=phase=>['preflop','flop','turn','river'].includes(phase);
export function wagerView(room,player,index) {
  const roles=[];
  if(room.hand>0&&!player.removed)for(const [seat,role] of [[room.dealer,'dealer'],[room.smallBlind,'small-blind'],[room.bigBlind,'big-blind']])if(seat===index)roles.push(role);
  const amount=active(room.phase)&&!player.removed?Math.max(0,Number(player.bet)||0):0;
  return {roles,amount};
}
export function objectTransitions(a,b) {
  if(!a||!b||a.id!==b.id||(a.roundNumber||1)!==(b.roundNumber||1)||a.hand!==b.hand||!active(a.phase)||
    (Number.isFinite(a.serverTime)&&Number.isFinite(b.serverTime)&&b.serverTime<a.serverTime))return [];
  const boundary=(active(b.phase)&&a.phase!==b.phase)||['showdown','ended'].includes(b.phase);
  return boundary?a.players.filter(p=>p.bet>0).map(p=>({player:p.id,amount:p.bet})):[];
}
const overlap=(a,b)=>Math.max(0,Math.min(a.left+a.width,b.left+b.width)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.top+a.height,b.top+b.height)-Math.max(a.top,b.top));
export function paddedObstacle(rect,gap){
  return {left:rect.left-gap,top:rect.top-gap,width:rect.width+gap*2,height:rect.height+gap*2};
}
export function placeObject({x,y,width,height,bounds,obstacles,edgeWeight=300000,allowed=()=>true}) {
  const pad=6,clamp=(n,min,max)=>Math.max(min,Math.min(Math.max(min,max),n));
  const candidates=[];
  for(const dy of [0,-8,8,-16,16,-24,24,-40,40,-60,60,-80,80,-100,100])for(const dx of [0,-8,8,-16,16,-24,24,-40,40,-60,60])candidates.push([x+dx,y+dy]);
  for(const py of [.18,.28,.38,.48,.58,.68,.78,.86])for(const px of [.2,.3,.4,.5,.6,.7,.8])candidates.push([bounds.width*px,bounds.height*py]);
  for(const r of obstacles)candidates.push([r.left-width/2-pad,y],[r.left+r.width+width/2+pad,y],[x,r.top-height/2-pad],[x,r.top+r.height+height/2+pad]);
  let best,score=Infinity;
  const consider=(cx,cy)=>{
    const r={left:clamp(cx-width/2,pad,bounds.width-width-pad),top:clamp(cy-height/2,pad,bounds.height-height-pad),width,height};
    if(!allowed(r))return;
    const rx=Math.max(1,bounds.width*.43-width/2),ry=Math.max(1,bounds.height*.41-height/2);
    const edge=Math.max(0,((r.left+width/2-bounds.width/2)/rx)**2+((r.top+height/2-bounds.height/2)/ry)**2-1);
    let cost=edge*edgeWeight+(r.left+width/2-x)**2+(r.top+height/2-y)**2;
    if(cost>=score)return;
    for(const obstacle of obstacles){cost+=overlap(r,obstacle)*1000000;if(cost>=score)return;}
    if(cost<score){best=r;score=cost;}
  };
  for(const [cx,cy]of candidates)consider(cx,cy);
  if(score>50000){
    const step=Math.max(3,Math.min(bounds.width,bounds.height)/60);
    for(let cy=pad+height/2;cy<=bounds.height-pad-height/2;cy+=step)
      for(let cx=pad+width/2;cx<=bounds.width-pad-width/2;cx+=step)consider(cx,cy);
  }
  return best;
}
export function renderTableObjects(room) {
  const layer=document.getElementById('tableObjects');layer.replaceChildren();
  for(const player of room.players){
    const view=wagerView(room,player,room.players.indexOf(player));
    if(!view.amount)continue;
    const node=document.createElement('div');node.className='table-object';node.dataset.player=player.id;
    node.dataset.columns=String(chipBreakdown(view.amount).length);node.dataset.wager='true';
    node.dataset.counted=String(chipBreakdown(view.amount).some(g=>g.count>3));
    node.dataset.long=String(view.amount>=1000000);
    if(view.amount){
      const wager=document.createElement('div');wager.className='table-wager';wager.dataset.amount=String(view.amount);
      wager.setAttribute('aria-label',`${player.name} 本轮下注 ${view.amount.toLocaleString()}`);wager.title=wager.getAttribute('aria-label');
      const img=chipBundle(view.amount);
      const amount=document.createElement('span');amount.className='wager-amount';amount.textContent=view.amount.toLocaleString();wager.append(img,amount);node.append(wager);
    }
    layer.append(node);
  }
}
export function arrangeTableObjects(scene) {
  const layer=document.getElementById('tableObjects');if(!layer?.children.length)return;
  const bounds=scene.getBoundingClientRect(),local=r=>({left:r.left-bounds.left,top:r.top-bounds.top,width:r.width,height:r.height});
  const obstacles=[...scene.querySelectorAll('.seat .avatar,.role-charm,.seat .name,.seat .stack,.seat .hand-total,.seat .bet,.seat .cards .card,#personalHand .card,#stage,#board .card,#pot,.contribution')]
    .filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>local(e.getBoundingClientRect())).filter(r=>r.width>0&&r.height>0).map(r=>paddedObstacle(r,Math.min(4,bounds.width/75)));
  for(const node of layer.children){
    const seat=[...scene.querySelectorAll('.seat')].find(e=>e.dataset.player===node.dataset.player);
    if(!seat){node.hidden=true;continue;}node.hidden=false;
    const compact=scene.dataset.density==='mobile-compact'&&scene.querySelectorAll('.seat').length>=7;
    if(node.dataset.compact!==String(compact)){
      const wager=node.querySelector('.table-wager'),amount=Number(wager.dataset.amount),groups=chipBreakdown(amount);
      wager.querySelector('.chip-bundle').replaceWith(chipBundle(amount));
      node.dataset.columns=String(groups.length);node.dataset.counted=String(groups.some(g=>g.count>3));node.dataset.compact=String(compact);
    }
    const object=node.getBoundingClientRect(),width=object.width,height=object.height;
    const hand=seat.classList.contains('mine')?scene.querySelector('#personalHand'):seat.querySelector('.cards');
    const source=hand?.getClientRects().length?hand:seat.querySelector('.avatar'),r=local(source.getBoundingClientRect());
    const x=scene.clientWidth/2+(r.left+r.width/2-scene.clientWidth/2)*.65;
    const y=scene.clientHeight/2+(r.top+r.height/2-scene.clientHeight/2)*.65;
    const box=placeObject({x,y,width,height,bounds:{width:scene.clientWidth,height:scene.clientHeight},obstacles});
    node.style.left=box.left+'px';node.style.top=box.top+'px';obstacles.push(paddedObstacle(box,3));
  }
}
