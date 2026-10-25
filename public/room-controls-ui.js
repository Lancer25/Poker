const rendered = new WeakMap();
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

export function renderRoomControls(room, {user, connected = false, send} = {}) {
  const panel = document.getElementById('roomControls');
  const settingsPanel = document.getElementById('roomControlSettings');
  if (!panel) { if (settingsPanel) settingsPanel.hidden = true; return; }
  const c = room?.roomControls;
  panel.hidden = room?.gameMode !== 'friends' || !c;
  if (settingsPanel) settingsPanel.hidden = panel.hidden || !c?.canManage;
  if (panel.hidden) { panel.replaceChildren(); settingsPanel?.replaceChildren(); rendered.delete(panel); return; }
  const {clockAt, ...pause} = c.pause || {};
  const signature = JSON.stringify([room.id, room.me, room.phase, connected, user?.id,
    {...c, pause: c.pause ? pause : null}, !!settingsPanel]);
  if (rendered.get(panel) === signature) return;
  rendered.set(panel, signature);
  panel.replaceChildren(); settingsPanel?.replaceChildren();
  panel.classList.add('room-controls');
  settingsPanel?.classList.add('room-control-settings');
  panel.dataset.connected = String(connected);
  panel.dataset.paused = String(c.pause?.state === 'active');
  const status = element('div', 'room-controls-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const viewing = !c.enabled ? '全桌观战：沿用原实时权限' :
    c.realtimeAllowed ? '全桌观战：实时底牌' : '全桌观战：仅公开牌';
  status.append(element('strong', '', viewing));
  status.append(element('span', 'room-controls-connection', connected ? '已连接' : '连接恢复中'));
  panel.append(status);
  const error = element('span', 'room-controls-error');
  error.setAttribute('role', 'alert'); panel.append(error);
  const ended = room.phase === 'ended';
  let busy = false;
  const dispatch = async (type, data = {}) => {
    if (!connected || ended || busy || typeof send !== 'function') return;
    busy = true; error.textContent = '';
    const nodes = [...panel.querySelectorAll('button,input,select'),
      ...(settingsPanel?.querySelectorAll('button,input,select') || [])];
    const disabled = nodes.map(node => node.disabled);
    nodes.forEach(node => { node.disabled = true; });
    try { await send(type, {...data, round: c.round, version: c.version,
      ...((type === 'ready' || type === 'away') ? {readyEpoch: c.readyEpoch ?? 0} : {})}); }
    catch (cause) { error.textContent = cause?.message || '操作未完成，请重试'; }
    finally { busy = false; nodes.forEach((node, i) => { node.disabled = disabled[i]; }); }
  };
  const button = (parent, label, type, data, icon) => {
    const node = element('button', icon ? 'room-control-icon' : 'room-control-command');
    node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
    node.disabled = !connected || ended;
    if (icon) { const image = element('img'); image.src = `/assets/icons/${icon}.svg`; image.alt = ''; node.append(image); }
    else node.textContent = label;
    node.onclick = () => dispatch(type, data); parent.append(node); return node;
  };
  const toggle = (parent, label, checked, disabled, onChange) => {
    const wrapper = element('label', 'room-control-toggle');
    const input = element('input'); input.type = 'checkbox'; input.checked = checked;
    input.disabled = !connected || ended || disabled;
    input.onchange = () => { const value = input.checked; input.checked = checked; onChange(value); };
    wrapper.append(input, element('span', '', label)); parent.append(wrapper);
  };
  if (!c.enabled) {
    if (c.canManage) button(settingsPanel || panel, '启用房间控制', 'settings',
      {settings: {admission: 'approval', reveal: 'public', requireReady: false}}, 'settings-2');
    return;
  }
  const actions = element('div', 'room-controls-actions'); panel.append(actions);
  const me = c.seats.find(p => p.id === room.me);
  if (me?.eligible && !me.isBot) {
    toggle(actions, '准备', me.ready, me.away || me.pendingAway === true,
      value => dispatch('ready', {value}));
    toggle(actions, me.pendingAway === null ? '暂离' : '暂离（本手后生效）',
      me.pendingAway ?? me.away, false, value => dispatch('away', {value}));
    if (!c.pause) button(actions, '申请暂停', 'pause');
  }
  if (c.pause) {
    const p = c.pause;
    actions.append(element('span', 'room-controls-pause', p.state === 'active' ? '牌桌已暂停' :
      `${p.state === 'granted' ? '本手后暂停' : '暂停表决'} ${p.approved}/${p.required}`));
    if (p.state !== 'active') {
      if (p.voters.includes(room.me) && !p.approvals.includes(room.me)) {
        button(actions, '同意暂停', 'pausevote', {request: p.id, value: true}, 'check');
        button(actions, '拒绝暂停', 'pausevote', {request: p.id, value: false}, 'x');
      }
      if (p.requestedBy === room.me || c.canManage)
        button(actions, '撤销暂停申请', 'pausecancel', {request: p.id}, 'circle-slash');
    } else if (c.canManage) {
      const resume = button(actions, '恢复牌桌', 'resume');
      resume.disabled ||= c.seats.some(s => s.eligible && (!s.ready || s.away || s.pendingAway === true));
    }
  }
  const seats = element('ul', 'room-controls-seats'); panel.append(seats);
  for (const s of c.seats.filter(s => s.eligible)) {
    const row = element('li', 'room-control-seat'); row.dataset.player = s.id;
    row.dataset.ready = String(s.ready); row.dataset.away = String(s.away);
    row.append(element('span', 'room-control-name', s.name), element('span', '',
      s.pendingAway === true ? '本手后暂离' : s.pendingAway === false ? '本手后返回' :
        s.away ? '暂离' : s.ready ? '已准备' : '未准备'));
    seats.append(row);
  }
  if (!c.canManage) return;
  const settings = settingsPanel || element('div', 'room-control-settings');
  if (!settingsPanel) panel.append(settings);
  const select = (key, label, options) => {
    const wrapper = element('label', 'room-control-select');
    wrapper.append(element('span', '', label));
    const input = element('select'); input.disabled = !connected || ended;
    for (const [value, title] of options) { const option = element('option', '', title); option.value = value; input.append(option); }
    input.value = c.settings[key];
    input.onchange = () => {
      const value = input.value; input.value = c.settings[key];
      dispatch('settings', {settings: {[key]: value}});
    };
    wrapper.append(input); settings.append(wrapper);
  };
  select('admission', '观战准入', [['approval', '房主审批'], ['open', '开放'], ['closed', '关闭']]);
  select('reveal', '全桌观战', [['public', '仅公开牌'], ['realtime', '实时底牌']]);
  toggle(settings, '开手前全员准备', c.settings.requireReady, false,
    value => dispatch('settings', {settings: {requireReady: value}}));
  for (const request of c.spectatorRequests || []) {
    const row = element('div', 'room-control-request'); row.dataset.request = request.id;
    row.append(element('span', 'room-control-name', request.user.nickname));
    button(row, `允许 ${request.user.nickname} 观战`, 'spectatorapprove', {request: request.id}, 'check');
    button(row, `拒绝 ${request.user.nickname} 观战`, 'spectatorreject', {request: request.id}, 'x');
    settings.append(row);
  }
}
