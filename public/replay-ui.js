const MAX_EVENTS = 512;
const phases = {preflop: '翻牌前', flop: '翻牌', turn: '转牌', river: '河牌', showdown: '结算', ended: '结算'};
const actions = {fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全下', smallBlind: '小盲', bigBlind: '大盲', ante: '前注'};
const types = {start: '开局', blinds: '盲注', action: '行动', street: '公共牌', card: '公共牌', settlement: '结算'};
const suits = {s: ['spade', '黑桃'], h: ['heart', '红桃'], d: ['diamond', '方块'], c: ['club', '梅花']};
const list = value => Array.isArray(value) ? value : [];
const validCard = value => typeof value === 'string' && /^[2-9TJQKA][shdc]$/.test(value);
const amount = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '0';
const name = value => typeof value === 'string' ? value.slice(0, 64) : '';
let current = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function iconButton(label, icon, handler) {
  const button = node('button', 'replay-icon-button');
  button.type = 'button'; button.title = label; button.setAttribute('aria-label', label);
  const image = node('img'); image.src = `/assets/icons/${icon}.svg`; image.alt = ''; button.append(image);
  button.addEventListener('click', handler);
  return button;
}

function cards(values, count) {
  const row = node('div', 'replay-cards');
  for (let i = 0; i < count; i++) {
    const value = values[i], tile = node('span', 'replay-card');
    if (validCard(value)) {
      const [asset, label] = suits[value[1]];
      tile.setAttribute('aria-label', `${label} ${value[0]}`);
      tile.dataset.suit = value[1];
      tile.append(node('span', '', value[0] === 'T' ? '10' : value[0]));
      const image = node('img'); image.src = `/assets/icons/card-${asset}.svg`; image.alt = ''; tile.append(image);
    } else { tile.classList.add('replay-card-empty'); tile.setAttribute('aria-label', '未发公共牌'); }
    row.append(tile);
  }
  return row;
}

function reveals(hand, ids) {
  const winners = new Set(list(hand.pots).filter(p => p && !p.refund).flatMap(p => list(p.winnerIds)));
  const participants = new Set(list(hand.results).map(p => p?.id)), seen = new Set();
  return [...list(hand.shownWinners).filter(p => winners.has(p?.id) && Number.isSafeInteger(p?.won) && p.won >= 0),
    ...list(hand.shownPlayers).filter(p => participants.has(p?.id))]
    .filter(p => p && ids.has(p.id) && !seen.has(p.id) && Array.isArray(p.cards) && p.cards.length === 2 &&
      p.cards.every(validCard) && p.cards[0] !== p.cards[1] && seen.add(p.id)).slice(0, 9);
}

export function closeReplay() {
  if (!current) return;
  const session = current;
  current = null;
  clearInterval(session.timer);
  session.dialog.close(); session.dialog.remove();
  if (session.focus?.isConnected) session.focus.focus();
}

export function openReplay(hand) {
  closeReplay();
  const dialog = node('dialog', 'hand-replay');
  dialog.setAttribute('aria-labelledby', 'hand-replay-title');
  const session = {dialog, focus: document.activeElement, timer: null};
  current = session;
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeReplay(); });
  dialog.addEventListener('close', () => { if (current === session) closeReplay(); });
  const header = node('div', 'replay-heading');
  const title = node('h2', '', `第 ${Number.isSafeInteger(hand?.hand) ? hand.hand : '-'} 手回放`); title.id = 'hand-replay-title';
  header.append(title, iconButton('关闭回放', 'x', closeReplay)); dialog.append(header);
  const saved = hand?.replay;
  const events = saved?.version === 1 && saved.hand === hand?.hand ? list(saved.events).slice(0, MAX_EVENTS)
    .filter(event => event && Object.hasOwn(types, event.type) && Object.hasOwn(phases, event.phase)) : [];
  if (!events.length) {
    dialog.append(node('p', 'replay-note', '此手未记录过程'));
    document.body.append(dialog); dialog.showModal(); return dialog;
  }
  if (saved.truncated || !saved.complete || list(saved.events).length > MAX_EVENTS || events[0].type !== 'start' || events.at(-1).type !== 'settlement') {
    dialog.append(node('p', 'replay-note', '过程记录不完整'));
  }
  const status = node('p', 'replay-step-status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const board = node('div', 'replay-board'); board.setAttribute('aria-label', '公共牌');
  const table = node('table', 'replay-players');
  const caption = node('caption', 'replay-sr-only', '各玩家筹码与行动'); table.append(caption);
  const head = node('thead'), headings = node('tr');
  for (const label of ['玩家', '筹码', '本轮下注', '累计投入', '行动']) { const th = node('th', '', label); th.scope = 'col'; headings.append(th); }
  head.append(headings); const body = node('tbody'); table.append(head, body);
  const scroll = node('div', 'replay-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', '玩家筹码'); scroll.append(table);
  const summary = node('div', 'replay-settlement');
  const controls = node('div', 'replay-controls');
  let index = 0;
  const pause = () => {
    clearInterval(session.timer); session.timer = null;
    play.children[0].src = '/assets/icons/play.svg';
    play.title = '播放'; play.setAttribute('aria-label', '播放'); play.setAttribute('aria-pressed', 'false');
  };
  const move = target => { pause(); index = Math.max(0, Math.min(events.length - 1, target)); render(); };
  const previous = iconButton('上一步', 'chevron-left', () => move(index - 1));
  const play = iconButton('播放', 'play', () => {
    if (session.timer) { pause(); return; }
    if (index === events.length - 1) index = 0;
    play.children[0].src = '/assets/icons/pause.svg';
    play.title = '暂停'; play.setAttribute('aria-label', '暂停'); play.setAttribute('aria-pressed', 'true');
    render();
    session.timer = setInterval(() => {
      if (current !== session || !dialog.open) { pause(); return; }
      index = Math.min(index + 1, events.length - 1); render();
      if (index === events.length - 1) pause();
    }, 1100);
  }); play.setAttribute('aria-pressed', 'false');
  const next = iconButton('下一步', 'chevron-right', () => move(index + 1));
  const slider = node('input', 'replay-scrub'); slider.type = 'range'; slider.min = '0'; slider.max = String(events.length - 1); slider.step = '1'; slider.value = '0'; slider.setAttribute('aria-label', '回放步骤');
  slider.addEventListener('input', () => move(Number(slider.value)));
  const counter = node('output', 'replay-counter');
  controls.append(previous, play, next, slider, counter);
  const content = node('div', 'replay-content'); content.append(status, board, scroll, summary);
  dialog.append(content, controls);

  function render() {
    const step = events[index];
    const final = index === events.length - 1 && step.type === 'settlement' && ['showdown', 'ended'].includes(step.phase);
    status.textContent = `${phases[step.phase]}${step.type === 'settlement' ? '' : ' · ' + types[step.type]}${Object.hasOwn(actions, step.action) ? ' · ' + actions[step.action] : ''}`;
    const max = {preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5, ended: 5}[step.phase];
    board.replaceChildren(cards([...new Set(list(step.board).filter(validCard))].slice(0, max), 5));
    const latest = new Map();
    for (const entry of events.slice(0, index + 1)) if (typeof entry.player === 'string' && Object.hasOwn(actions, entry.action)) latest.set(entry.player, actions[entry.action]);
    const selected = list(step.players).filter(p => p && typeof p.id === 'string').slice(0, 9);
    body.replaceChildren(...selected.map(p => {
      const row = node('tr'); row.dataset.folded = String(p.folded === true);
      for (const value of [name(p.name), amount(p.stack), amount(p.bet), amount(p.total), p.folded ? '弃牌' : latest.get(p.id) || '-']) row.append(node('td', '', value));
      return row;
    }));
    summary.replaceChildren(); summary.hidden = !final;
    if (final) {
      summary.append(node('h3', '', '派彩与退回'));
      for (const pot of list(step.pots).slice(0, 18)) if (pot) summary.append(node('p', '', `${pot.refund ? '退回' : '派彩'} ${amount(pot.amount)} · ${list(pot.winners).slice(0, 9).map(name).join('、')}`));
      const ids = new Set(selected.map(p => p.id));
      for (const player of reveals(hand, ids)) {
        const row = node('div', 'replay-reveal');
        row.append(node('span', 'replay-reveal-name', name(player.name)), cards(player.cards, 2), node('span', '', name(player.handLabel)));
        summary.append(row);
      }
    }
    previous.disabled = index === 0; next.disabled = index === events.length - 1;
    slider.value = String(index); slider.setAttribute('aria-valuetext', `第 ${index + 1} 步，共 ${events.length} 步`);
    counter.textContent = `${index + 1} / ${events.length}`;
  }
  render(); document.body.append(dialog); dialog.showModal(); return dialog;
}
