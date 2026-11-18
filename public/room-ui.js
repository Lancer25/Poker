import {arrangeTableObjects,placeObject,paddedObstacle} from './table-objects.js?v=hardening1';
export function portraitPosition(name) {
  let hash=0;for(const char of String(name||''))hash=(hash*31+char.charCodeAt(0))>>>0;
  const index=hash%9;return `${index%3*50}% ${Math.floor(index/3)*50}%`;
}
export function paintPortrait(node,name,index) {
  node.classList.add('illustrated-avatar');node.style.backgroundPosition=Number.isInteger(index)?`${index%3*50}% ${Math.floor(index%9/3)*50}%`:portraitPosition(name);
}
export function fitTableFrame(width,height,ratio) {
  if(![width,height,ratio].every(value=>Number.isFinite(value)&&value>0))return {width:0,height:0};
  if(width/height<=ratio)return {width,height:width/ratio};
  return {width:height*ratio,height};
}
export function viewingMode(room) {
  if(room?.spectating)return 'spectator';
  if(room?.godMode)return 'god';
  const player=room?.players?.find(player=>player.id===room.me);
  return player?.eliminated&&!player.inHand?'eliminated':null;
}
export function fitCenterY(height,contentHeight,upperBottom,lowerTop,gap=10) {
  const min=upperBottom+gap+contentHeight/2,max=lowerTop-gap-contentHeight/2;
  return min<=max?Math.max(min,Math.min(max,height*.48)):(upperBottom+lowerTop)/2;
}
export function safeTopFallback({ios,tablet=false,width,landscape=false,nativeTop=0,standalone=false}) {
  if(!ios||!standalone||nativeTop>0||!Number.isFinite(width)||width<=0||(!tablet&&width>920))return 0;
  return landscape?20:tablet?24:44;
}
export function seatDensity(width,height,count,portrait){
  if(portrait)return width<310||(count>=7&&width<340)?'mobile-compact':count<=6?'mobile-roomy':'mobile';
  return width>=1200&&height>=600?(count>=7?'desktop-large-dense':'desktop-large'):height>=420&&(count<7||height>=520)?'desktop':'desktop-compact';
}
export function portraitSeatScale(width,portrait){
  return portrait?Math.min(1,Math.max(0,width)/240):1;
}
export function holeCardSide(x,y,portrait,own=false){
  return x<40?'right':x>60?'left':y<50?'bottom':'top';
}
export function inwardHandAnchor(x,y,own=false){
  return {x:50+(x-50)*(own?0:.74),y:!own&&(x<15||x>85)?y:50+(y-50)*(own?.65:.68)};
}
export function radialHandAngle(x,y,width,height,own=false,faceUp=false){
  return own||faceUp?0:Math.atan2((50-x)*width,(y-50)*height)*180/Math.PI;
}
export function viewportLayout(innerHeight,viewport,previousHeight,editing=false){
  const zoomed=(viewport?.scale||1)>1.01;
  const height=zoomed?(previousHeight||innerHeight):Math.min(innerHeight,viewport?.height||innerHeight);
  return {zoomed,height,keyboardInset:zoomed?0:Math.max(0,Math.round(innerHeight-height-(viewport?.offsetTop||0))),keyboardOpen:!zoomed&&editing&&height<innerHeight-120};
}
export function outerSeatPositions(count,portrait){
  const side=portrait?2:4,far=100-side,bottom=portrait?94:92;
  const tables={
    1:[[50,bottom]],
    2:[[50,bottom],[50,6]],
    3:[[50,bottom],[25,7],[75,7]],
    4:[[50,bottom],[side,48],[50,6],[far,48]],
    5:[[50,bottom],[side,67],[25,7],[75,7],[far,67]],
    6:[[50,bottom],[side,71],[side,36],[50,6],[far,36],[far,71]],
    7:[[50,bottom],[side,72],[side,38],[28,7],[72,7],[far,38],[far,72]],
    8:[[50,bottom],[side,76],[side,52],[side,28],[50,6],[far,28],[far,52],[far,76]],
    9:[[50,bottom],[side,77],[side,53],[side,29],[30,6],[70,6],[far,29],[far,53],[far,77]],
  };
  return tables[count]||[];
}
export function raisePanelPlacement(anchor, viewport, width, height) {
  const gap = 8;
  const top = viewport.top + gap;
  const bottom = viewport.bottom - gap;
  const above = Math.max(0, Math.min(bottom, anchor.top - gap) - top);
  const below = Math.max(0, bottom - Math.max(top, anchor.bottom + gap));
  const opensAbove = above >= height || above >= below;
  return {
    left: Math.max(viewport.left + gap, Math.min(anchor.right - width, viewport.right - gap - width)),
    top: opensAbove ? top + above : bottom - below,
    maxHeight: opensAbove ? above : below,
    opensAbove,
  };
}
export class RoomUI {
  constructor() {
    this.mobile=matchMedia('(max-width: 920px)');
    this.stage=document.querySelector('.table-wrap');this.scene=document.querySelector('.table-scene');
    this.personalHand=document.getElementById('personalHand');this.scene.append(this.personalHand);
    this.tools=document.querySelector('.room-tools');
    this.backdrop=document.getElementById('drawerBackdrop');
    const insight=document.getElementById('insightSection');
    const handPanel=document.getElementById('panel-insight');
    this.observerEmpty=document.createElement('p');this.observerEmpty.id='observerEmpty';this.observerEmpty.className='muted';this.observerEmpty.textContent='暂无可查看的底牌';this.observerEmpty.hidden=true;
    handPanel.append(document.getElementById('godHands'),this.observerEmpty,insight);
    this.aux=document.createElement('div');this.aux.className='aux-controls';
    for(const id of ['showCardsControls','dockHostActions','godControls'])this.aux.append(document.getElementById(id));
    document.querySelector('.decision-actions').append(this.aux);
    document.querySelector('.decision-actions').prepend(document.getElementById('winnerFocus'));
    const winnerDialog=document.getElementById('winnerDialog');
    document.getElementById('closeWinnerDialog').onclick=()=>winnerDialog.close();
    winnerDialog.addEventListener('click',event=>{const r=winnerDialog.getBoundingClientRect();if(event.target===winnerDialog&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom))winnerDialog.close();});
    this.setupRaisePanel();
    const accountSlot=document.createElement('div');accountSlot.className='room-account-links';this.accountLinks=[];
    for(const id of ['profileLink','adminLink','logout']){const source=document.getElementById(id),link=source.cloneNode(false);link.removeAttribute('id');link.textContent=source.textContent;if(id==='logout')link.onclick=()=>source.click();accountSlot.append(link);this.accountLinks.push([source,link]);}
    document.querySelector('.settings-content').append(accountSlot);
    document.querySelectorAll('.tool-tabs button').forEach(tab=>{const icon=tab.querySelector('img'),frame=document.createElement('span'),glyph=document.createElement('span');if(!icon)return;frame.className='menu-icon';frame.setAttribute('aria-hidden','true');glyph.className='menu-glyph';glyph.style.setProperty('--glyph',`url('${icon.getAttribute('src')}')`);frame.append(glyph);icon.replaceWith(frame);});
    this.backdrop.onclick=()=>this.closeTools();
    document.getElementById('showObservedCards').onclick=()=>document.getElementById('tab-insight').click();
    const experience=document.getElementById('experienceSettings'),management=document.getElementById('roomManagement');
    experience.querySelector('summary').addEventListener('click',()=>{if(!experience.open)management.open=false;});
    management.querySelector('summary').addEventListener('click',()=>{if(!management.open)experience.open=false;});
    experience.addEventListener('toggle',()=>{if(experience.open)management.open=false;});
    management.addEventListener('toggle',()=>{if(management.open)experience.open=false;});
    document.getElementById('closeTools').onclick=()=>this.closeTools();
    document.addEventListener('keydown',event=>{
      if(event.key==='Escape' && document.body.classList.contains('tools-open')){this.closeTools();return;}
      if(event.key!=='Tab'||!this.mobile.matches||!document.body.classList.contains('tools-open'))return;
      const nodes=[...this.tools.querySelectorAll('button,a,input,select,summary,[tabindex="0"]')].filter(node=>!node.disabled && node.getClientRects().length);
      const first=nodes[0],last=nodes.at(-1);if(!first)return;
      if((event.shiftKey && document.activeElement===first)||(!event.shiftKey&&document.activeElement===last)){event.preventDefault();(event.shiftKey?last:first).focus();}
    });
    this.mobile.addEventListener('change',()=>{this.closeTools();this.arrange();});
    window.addEventListener('resize',()=>this.arrange());
    window.addEventListener('holdem-theme-change',()=>this.arrange());
    if(typeof ResizeObserver!=='undefined'){this.sceneObserver=new ResizeObserver(()=>{
      if(this.arrangeFrame)return;
      this.arrangeFrame=requestAnimationFrame(()=>{this.arrangeFrame=0;this.arrange();});
    });this.sceneObserver.observe(this.stage);}
    const insetProbe=document.createElement('div');insetProbe.setAttribute('aria-hidden','true');
    insetProbe.style.cssText='position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding-top:env(safe-area-inset-top,0px)';document.body.append(insetProbe);
    const tablet=/iPad/.test(navigator.userAgent)||(!/iPhone|iPod/.test(navigator.userAgent)&&navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const ios=tablet||/iPhone|iPod/.test(navigator.userAgent);
    const fitViewport=()=>{
      const angle=screen.orientation?.angle??window.orientation??0;
      const standalone=navigator.standalone===true||matchMedia('(display-mode: standalone)').matches;
      const fallback=safeTopFallback({ios,tablet,standalone,width:innerWidth,landscape:Math.abs(angle)%180===90,nativeTop:parseFloat(getComputedStyle(insetProbe).paddingTop)||0});
      document.documentElement.style.setProperty('--compat-safe-top',fallback+'px');
      const metrics=viewportLayout(innerHeight,window.visualViewport,this.layoutHeight,!!document.activeElement?.closest('#betSizing'));
      const restoring=this.zoomed&&!metrics.zoomed;this.zoomed=metrics.zoomed;
      if(metrics.zoomed)return;
      this.layoutHeight=metrics.height;
      document.documentElement.style.setProperty('--app-height',Math.round(metrics.height)+'px');
      document.documentElement.style.setProperty('--keyboard-inset',metrics.keyboardInset+'px');
      document.body.classList.toggle('keyboard-open',metrics.keyboardOpen);
      if(restoring)requestAnimationFrame(()=>this.arrange());
    };
    window.visualViewport?.addEventListener('resize',fitViewport);
    window.addEventListener('orientationchange',fitViewport);
    window.addEventListener('resize',fitViewport);
    document.addEventListener('focusin',fitViewport);document.addEventListener('focusout',()=>setTimeout(fitViewport,0));fitViewport();
    document.getElementById('togglePassword').onclick=()=>{
      const input=document.getElementById('authPassword'),visible=input.type==='password',button=document.getElementById('togglePassword');
      input.type=visible?'text':'password';button.setAttribute('aria-pressed',String(visible));button.setAttribute('aria-label',visible?'隐藏密码':'显示密码');button.title=visible?'隐藏密码':'显示密码';button.querySelector('img').src=visible?'/assets/icons/eye-off.svg':'/assets/icons/eye.svg';
    };
  }
  openTools(panel) {
    const tab=document.querySelector(`[data-panel="${panel}"]`);if(!tab)return;
    document.getElementById('drawerTitle').textContent=tab.querySelector(':scope > span:last-child')?.textContent||'牌桌信息';
    if(this.mobile.matches){document.body.classList.add('tools-open');this.backdrop.hidden=false;this.tools.setAttribute('role','dialog');this.tools.setAttribute('aria-modal','true');this.tools.setAttribute('aria-label','牌桌信息');}
    document.querySelectorAll('[data-panel]').forEach(button=>button.setAttribute('aria-expanded',String(button===tab)));
  }
  closeTools() {
    this.closeRaise(false);
    const open=document.body.classList.contains('tools-open');document.body.classList.remove('tools-open');this.backdrop.hidden=true;
    this.tools.removeAttribute('role');this.tools.removeAttribute('aria-modal');this.tools.removeAttribute('aria-label');
    document.querySelectorAll('[data-panel]').forEach(button=>button.setAttribute('aria-expanded','false'));
    if(open)document.querySelector('[data-panel][aria-selected="true"]')?.focus();
  }
  setupRaisePanel() {
    const dialog = this.raiseDialog = document.getElementById('raiseDialog');
    const sizing = document.getElementById('betSizing');
    const amount = document.getElementById('betAmount');
    const row = amount.closest('.bet-amount');
    const label = row.querySelector('label');
    label.htmlFor = amount.id;
    row.append(label, amount.closest('.amount-stepper'), document.getElementById('betSlider'));
    sizing.append(row, document.getElementById('betPresets'), document.getElementById('betImpact'));
    document.getElementById('raiseSlot').append(sizing);

    const confirm = document.getElementById('confirmRaise');
    document.getElementById('closeRaise').onclick = () => this.closeRaise();
    confirm.onclick = () => {
      if (!confirm.disabled) this.raiseSubmit?.();
    };
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.closeRaise();
    });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right ||
          event.clientY < bounds.top || event.clientY > bounds.bottom) this.closeRaise();
    });
    amount.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      confirm.click();
    });
    let frame;
    const position = () => {
      if (!dialog.open || frame) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        this.positionRaisePanel();
      });
    };
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, {passive: true});
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
  }
  positionRaisePanel() {
    const dialog = this.raiseDialog;
    if (!dialog.open) return;
    const trigger = document.querySelector('#controls [data-action=raise]');
    if (this.mobile.matches || !trigger?.getClientRects().length) {
      delete dialog.dataset.placement;
      if(this.mobile.matches){
        const view=window.visualViewport,board=document.getElementById('board');
        const bottom=(view?.offsetTop||0)+(view?.height||innerHeight);
        const rect=board?.getClientRects().length?board.getBoundingClientRect():null;
        const available=rect?.height?bottom-rect.bottom-12:bottom-16;
        dialog.style.setProperty('--raise-available-height',Math.max(200,available)+'px');
      }
      return;
    }
    const view = window.visualViewport;
    const left = view?.offsetLeft ?? 0;
    const top = view?.offsetTop ?? 0;
    const viewport = {
      left, top,
      right: left + (view?.width ?? document.documentElement.clientWidth),
      bottom: top + (view?.height ?? document.documentElement.clientHeight),
    };
    dialog.style.setProperty('--raise-width', Math.max(0, viewport.right - left - 16) + 'px');
    const placement = raisePanelPlacement(trigger.getBoundingClientRect(), viewport,
      dialog.offsetWidth, dialog.scrollHeight + dialog.offsetHeight - dialog.clientHeight);
    dialog.style.setProperty('--raise-left', placement.left + 'px');
    dialog.style.setProperty('--raise-top', placement.top + 'px');
    dialog.style.setProperty('--raise-max-height', placement.maxHeight + 'px');
    dialog.dataset.placement = placement.opensAbove ? 'above' : 'below';
  }
  openRaise(key,submit) {
    if(document.getElementById('betAmount').disabled)return;
    this.closeTools();this.raiseKey=key;this.raiseSubmit=submit;
    document.getElementById('raiseError').hidden=true;document.getElementById('betAmount').removeAttribute('aria-invalid');
    this.raiseInput=document.getElementById('betAmount').value;
    if(!this.raiseDialog.open)this.raiseDialog.showModal();
    this.raiseDialog.scrollTop = 0;
    document.getElementById('closeRaise').focus({preventScroll:true});
    this.positionRaisePanel();
  }
  closeRaise(restore=true) {
    if(!this.raiseDialog?.open)return;
    this.raiseSubmit=null;this.raiseKey='';this.raiseDialog.close();
    delete this.raiseDialog.dataset.placement;
    if(restore)document.querySelector('#controls [data-action=raise]:not(:disabled)')?.focus({preventScroll:true});
  }
  showRaiseError(message) {
    this.raiseInput=document.getElementById('betAmount').value;
    const error=document.getElementById('raiseError');error.textContent=message;error.hidden=false;
    document.getElementById('betAmount').setAttribute('aria-invalid','true');
    this.positionRaisePanel();
  }
  refreshRaise(available,key) {
    const value=document.getElementById('betAmount').value;
    const error = document.getElementById('raiseError');
    const errorCleared = this.raiseInput !== value && !error.hidden;
    if(this.raiseInput!==value){error.hidden=true;document.getElementById('betAmount').removeAttribute('aria-invalid');this.raiseInput=value;}
    const source=document.querySelector('#controls [data-action=raise]'),submit=document.getElementById('confirmRaise');
    submit.disabled=!available||!source||source.disabled;
    submit.textContent='确认'+(source?.getAttribute('aria-label')||'加注');
    if(this.raiseDialog.open&&(!available||this.raiseKey!==key||submit.disabled))this.closeRaise(false);
    else if (errorCleared) this.positionRaisePanel();
  }
  sync(room) {
    this.room=room;document.body.dataset.phase=room.phase;
    const mode=viewingMode(room),game=document.getElementById('game');game.classList.toggle('viewing-layout',!!mode);game.dataset.viewing=mode||'';
    const auxParent=mode?document.querySelector('.action-dock'):document.querySelector('.decision-actions');
    if(this.aux.parentElement!==auxParent)auxParent.append(this.aux);
    const winnerParent=mode?document.getElementById('observerControls'):document.querySelector('.decision-actions');
    if(document.getElementById('winnerFocus').parentElement!==winnerParent)winnerParent.prepend(document.getElementById('winnerFocus'));
    this.personalHand.dataset.player=room.me;
    this.personalHand.classList.toggle('folded',!!room.players.find(player=>player.id===room.me)?.folded);
    document.getElementById('observerControls').hidden=!mode;
    document.getElementById('observerTitle').textContent=mode==='god'?'上帝模式':mode==='spectator'?'观战模式':'旁观中';
    document.getElementById('observerNotice').textContent=document.getElementById('dockWaitingLabel').textContent||document.getElementById('stage').textContent;
    const observed=document.getElementById('godHands').children.length,canObserve=!!room.godMode&&observed>0;
    document.getElementById('showObservedCards').hidden=!canObserve;
    document.getElementById('showObservedCards').textContent=`查看底牌${canObserve?' · '+observed:''}`;
    this.observerEmpty.hidden=!mode||canObserve;
    document.querySelector('#panel-insight > h3').textContent=mode?'已发底牌':'牌面与预测';
    document.querySelector('#tab-insight > span:last-child').textContent=mode?'底牌':'牌面';
    if(document.getElementById('tab-insight').getAttribute('aria-selected')==='true')document.getElementById('drawerTitle').textContent=mode?'底牌':'牌面';
    const active=['preflop','flop','turn','river'].includes(room.phase);
    const manager=document.getElementById('roomManagement');
    manager.hidden=room.host!==room.me;
    if(manager.hidden)manager.open=false;
    this.accountLinks.forEach(([source,link])=>{link.hidden=source.hidden;});
    game.classList.toggle('room-idle',!active);
    const dice=document.getElementById('seatDice');dice.dataset.status=room.seating?.status||'';
    this.arrange();
  }
  arrange() {
    if((window.visualViewport?.scale||1)>1.01)return;
    const portrait=this.mobile.matches,ratio=Number(getComputedStyle(document.documentElement).getPropertyValue(portrait?'--table-ratio':'--table-wide-ratio'));
    const frame=fitTableFrame(this.stage.clientWidth,this.stage.clientHeight,ratio);
    if(!frame.width)return;
    const seats=[...document.querySelectorAll('#seats .seat')];
    this.scene.style.width=frame.width+'px';this.scene.style.height=frame.height+'px';this.scene.dataset.compact=String(portrait?frame.width<310:frame.height<(seats.length===2?540:400));
    this.scene.dataset.orientation=portrait?'portrait':'landscape';
    this.scene.dataset.density=seatDensity(frame.width,frame.height,seats.length,portrait);
    const scale=portraitSeatScale(frame.width,portrait);
    this.scene.style.setProperty('--seat-scale',scale);
    const positions=outerSeatPositions(seats.length,portrait);
    if(!positions.length)return;
    const avatarSize=parseFloat(getComputedStyle(this.scene).getPropertyValue('--seat-avatar'))||44;
    const minY=(avatarSize/2+12*scale)/frame.height*100;
    seats.forEach((seat,index)=>{const [x,y]=positions[index];positions[index]=[x,Math.max(y,minY)];seat.style.left=x+'%';seat.style.top=positions[index][1]+'%';seat.dataset.side=x>60?'right':x<40?'left':'center';seat.dataset.holeSide=holeCardSide(x,y,portrait,seat.classList.contains('mine'));});
    // Seat labels stay on screen; cards are positioned independently on the felt.
    const stageBounds=this.stage.getBoundingClientRect();
    seats.forEach((seat,index)=>{
      const content=[...seat.querySelectorAll('.avatar,.role-charm,.name,.stack,.hand-total,.bet')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden').map(e=>e.getBoundingClientRect());
      if(!content.length)return;
      const left=Math.min(...content.map(r=>r.left)),right=Math.max(...content.map(r=>r.right)),top=Math.min(...content.map(r=>r.top)),bottom=Math.max(...content.map(r=>r.bottom));
      const dx=Math.max(0,stageBounds.left+5-left)-Math.max(0,right-stageBounds.right+5);
      const dy=Math.max(0,stageBounds.top+5-top)-Math.max(0,bottom-stageBounds.bottom+5);
      positions[index]=[positions[index][0]+dx/frame.width*100,positions[index][1]+dy/frame.height*100];
      seat.style.left=positions[index][0]+'%';seat.style.top=positions[index][1]+'%';
    });
    const sceneBounds=this.scene.getBoundingClientRect();
    const privateScale=portrait?Math.min(1,frame.width/250):1;
    this.personalHand.style.setProperty('--private-scale',privateScale);
    for(const seat of seats){
      const own=seat.classList.contains('mine'),hand=own?this.personalHand:seat.querySelector('.cards');
      if(!hand.getClientRects().length)continue;
      const avatar=seat.querySelector('.avatar').getBoundingClientRect(),root=seat.getBoundingClientRect();
      const anchor=inwardHandAnchor((avatar.left+avatar.width/2-sceneBounds.left)/frame.width*100,(avatar.top+avatar.height/2-sceneBounds.top)/frame.height*100,own);
      const handScale=own?privateScale:scale,w=hand.offsetWidth*handScale,h=hand.offsetHeight*handScale;
      const x=Math.max(frame.width*.08,Math.min(frame.width*.92-w,frame.width*anchor.x/100-w/2));
      let y=Math.max(frame.height*.08,Math.min(frame.height*.92-h,frame.height*anchor.y/100-h/2));
      if(!own&&avatar.top+avatar.height/2<sceneBounds.top+frame.height*.3){
        const labels=[...seat.querySelectorAll('.name,.stack,.hand-total,.bet')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect());
        for(const label of labels)if(label.right>sceneBounds.left+x&&label.left<sceneBounds.left+x+w&&label.top<sceneBounds.top+y+h&&label.bottom>sceneBounds.top+y)y=Math.max(y,label.bottom-sceneBounds.top+6);
      }
      hand.style.left=(own?x:(x-root.left+sceneBounds.left)/scale)+'px';
      hand.style.top=(own?y:(y-root.top+sceneBounds.top)/scale)+'px';
      const faceUp=!!hand.querySelector('.card:not(.back)');
      const angle=radialHandAngle((avatar.left+avatar.width/2-sceneBounds.left)/frame.width*100,(avatar.top+avatar.height/2-sceneBounds.top)/frame.height*100,frame.width,frame.height,own,faceUp);
      hand.dataset.rotation=String(angle);hand.style.transformOrigin=own?'top left':'center center';
      hand.style.right='auto';hand.style.transform=own?'scale('+privateScale+')':`rotate(${angle}deg)`;
    }
    // Settlement text changes the center height; fit against actual seat contents.
    const center=this.scene.querySelector('.center'),bounds=this.scene.getBoundingClientRect(),middle=center.getBoundingClientRect();
    let upper=0,lower=frame.height;
    if(this.personalHand.getClientRects().length)lower=this.personalHand.getBoundingClientRect().top-bounds.top;
    seats.forEach((seat,index)=>{
      const y=positions[index][1];if(y>=35&&y<=70)return;
      const children=[...seat.children].filter(node=>node.getClientRects().length).map(node=>node.getBoundingClientRect());
      const relevant=children.filter(rect=>rect.right>middle.left-10&&rect.left<middle.right+10);
      if(!relevant.length)return;
      if(y<35)upper=Math.max(upper,...relevant.map(rect=>rect.bottom-bounds.top));
      else lower=Math.min(lower,...relevant.map(rect=>rect.top-bounds.top));
    });
    center.style.top=fitCenterY(frame.height,middle.height,upper,lower)+'px';
    // Protect the actual rotated corners, not the unrotated hand's layout box.
    const visible=e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
    const local=r=>({left:r.left-sceneBounds.left,top:r.top-sceneBounds.top,width:r.width,height:r.height});
    const occupied=[...this.scene.querySelectorAll('.seat .avatar,.role-charm,.seat .name,.seat .stack,.seat .hand-total,.seat .bet,#stage,#board .card,#pot,.contribution')]
      .filter(visible).map(e=>local(e.getBoundingClientRect())).filter(r=>r.width>0&&r.height>0).map(r=>paddedObstacle(r,3*scale));
    const hands=[this.personalHand,...seats.filter(seat=>!seat.classList.contains('mine')).map(seat=>seat.querySelector('.cards'))].filter(visible);
    for(const hand of hands){
      const seat=hand===this.personalHand?seats.find(s=>s.classList.contains('mine')):hand.closest('.seat');
      const avatar=seat.querySelector('.avatar').getBoundingClientRect();
      const ax=(avatar.left+avatar.width/2-sceneBounds.left)/frame.width-.5,ay=(avatar.top+avatar.height/2-sceneBounds.top)/frame.height-.5;
      const allowed=r=>{
        const hx=(r.left+r.width/2)/frame.width-.5,hy=(r.top+r.height/2)/frame.height-.5;
        const inside=[r.left,r.left+r.width].every(x=>[r.top,r.top+r.height].every(y=>((x/frame.width-.5)/.44)**2+((y/frame.height-.5)/.44)**2<=1));
        return inside&&Math.hypot(hx,hy)<Math.hypot(ax,ay)&&Math.abs(Math.atan2(ax*hy-ay*hx,ax*hx+ay*hy))<Math.PI*2/Math.max(3,seats.length)*.44;
      };
      for(let attempt=0;attempt<4;attempt++){
        const cards=[...hand.querySelectorAll('.card')].filter(visible).map(e=>local(e.getBoundingClientRect()));
        if(!cards.length)break;
        const left=Math.min(...cards.map(r=>r.left)),top=Math.min(...cards.map(r=>r.top));
        const width=Math.max(...cards.map(r=>r.left+r.width))-left,height=Math.max(...cards.map(r=>r.top+r.height))-top;
        const box=placeObject({x:left+width/2,y:top+height/2,width,height,bounds:frame,obstacles:occupied,edgeWeight:0,allowed});
        const blocked=!box||occupied.some(r=>box.left<r.left+r.width&&box.left+box.width>r.left&&box.top<r.top+r.height&&box.top+box.height>r.top);
        if(blocked&&attempt<3){
          const fit=.9**(attempt+1);
          hand.style.transform=hand===this.personalHand?`scale(${privateScale*fit})`:`rotate(${hand.dataset.rotation}deg) scale(${fit})`;
          continue;
        }
        if(!box)break;
        const parentScale=hand===this.personalHand?1:scale;
        hand.style.left=(parseFloat(hand.style.left)+(box.left-left)/parentScale)+'px';
        hand.style.top=(parseFloat(hand.style.top)+(box.top-top)/parentScale)+'px';
        occupied.push(paddedObstacle(box,3*scale));
        break;
      }
    }
    arrangeTableObjects(this.scene);
  }
}
