export const HAND_REPLAY_VERSION = 1;
export const MAX_HAND_EVENTS = 512;

const active = new WeakMap();
const types = new Set(['start', 'blinds', 'action', 'street', 'card', 'settlement']);
const actions = new Set(['fold', 'check', 'call', 'raise', 'allin', 'smallBlind', 'bigBlind', 'ante']);
const phases = new Set(['preflop', 'flop', 'turn', 'river', 'showdown', 'ended']);
const list = value => Array.isArray(value) ? value : [];
const text = (value, max = 64) => typeof value === 'string' ? value.slice(0, max) : '';
const chips = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const card = value => typeof value === 'string' && /^[2-9TJQKA][shdc]$/.test(value);
const id = value => text(value, 128);

function players(value) {
  const seen = new Set();
  return list(value).filter(p => p && id(p.id) && !seen.has(id(p.id)) && seen.add(id(p.id)))
    .slice(0, 9).map(p => ({id: id(p.id), name: text(p.name), stack: chips(p.stack),
      bet: chips(p.bet), total: chips(p.total), folded: p.folded === true}));
}

function board(value, phase) {
  const max = {preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5, ended: 5}[phase] ?? 0;
  return [...new Set(list(value).filter(card))].slice(0, max);
}

function pots(value, ids) {
  return list(value).slice(0, 18).filter(p => p && Number.isSafeInteger(p.amount) && p.amount >= 0)
    .map(p => ({amount: p.amount, refund: p.refund === true,
      winners: list(p.winners).slice(0, 9).map(name => text(name)),
      winnerIds: [...new Set(list(p.winnerIds).filter(value => ids.has(value)))].slice(0, 9)}));
}

function event(value, terminal = false) {
  if (!value || !types.has(value.type) || !phases.has(value.phase)) return null;
  if (value.type === 'settlement' && (!terminal || !['showdown', 'ended'].includes(value.phase))) return null;
  const selected = players(value.players), ids = new Set(selected.map(p => p.id));
  const result = {type: value.type, at: chips(value.at), phase: value.phase,
    board: board(value.board, value.phase), players: selected};
  const actor = typeof value.player === 'string' ? value.player : value.player?.id;
  if (ids.has(actor)) result.player = actor;
  if (actions.has(value.action)) result.action = value.action;
  if (Number.isSafeInteger(value.amount) && value.amount >= 0) result.amount = value.amount;
  if (value.type === 'start' || value.type === 'blinds') {
    for (const key of ['small', 'big', 'ante']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  if (value.type === 'settlement') result.pots = pots(value.pots, ids);
  return result;
}

function capture(room, type, details, now, state) {
  // State, never caller-provided details, owns all balance and board snapshots.
  // All-in runout keeps room.phase at flop while exposing turn/river cards.
  const count = list(room.board).length;
  const phase = (type === 'card' || type === 'street') && phases.has(room.phase)
    ? count >= 5 ? 'river' : count === 4 ? 'turn' : count > 0 ? 'flop' : room.phase
    : room.phase;
  return event({type, at: now, phase, players: list(room.players).filter(p => state.ids.has(p.id)),
    board: room.board, pots: type === 'settlement' ? room.pots : undefined,
    player: details.player, action: details.action, amount: details.amount,
    small: room.small, big: room.big, ante: room.ante}, type === 'settlement');
}

function persistPending(room, state) {
  room.replayPending = {version: HAND_REPLAY_VERSION, hand: state.hand, round: state.round,
    startedAt: state.startedAt, truncated: state.truncated, events: state.events};
}

function pendingState(room) {
  const cached = active.get(room);
  if (cached && cached.hand === room.hand && cached.round === (room.roundNumber || 1)) return cached;
  active.delete(room);
  const saved = room.replayPending;
  if (!saved || saved.version !== HAND_REPLAY_VERSION || saved.hand !== room.hand ||
      saved.round !== (room.roundNumber || 1) || !Number.isSafeInteger(saved.hand) || saved.hand < 1 ||
      !Number.isSafeInteger(saved.round) || saved.round < 1 || !Array.isArray(saved.events)) {
    delete room.replayPending;
    return null;
  }
  // Rebuild from public allowlists on reload; never retain deserialized raw entries.
  const source = saved.events.slice(0, MAX_HAND_EVENTS - 1);
  const events = source.map(value => event(value)).filter(Boolean);
  if (!events.length || events[0].type !== 'start') { delete room.replayPending; return null; }
  const state = {hand: saved.hand, round: saved.round, startedAt: chips(saved.startedAt),
    ids: new Set(events[0].players.map(p => p.id)), events,
    truncated: saved.truncated === true || saved.events.length > source.length || events.length !== source.length};
  active.set(room, state);
  persistPending(room, state);
  return state;
}

export function beginHandEvents(room, now = Date.now()) {
  if (!Number.isSafeInteger(room.hand) || room.hand < 1 ||
      !Number.isSafeInteger(room.roundNumber || 1) || (room.roundNumber || 1) < 1) {
    active.delete(room); delete room.replayPending; return;
  }
  const selected = players(list(room.players).filter(p => p?.inHand));
  const state = {hand: room.hand, round: room.roundNumber || 1, startedAt: chips(now),
    ids: new Set(selected.map(p => p.id)), events: [], truncated: false};
  active.set(room, state);
  const first = capture(room, 'start', {}, now, state);
  if (first) state.events.push(first);
  persistPending(room, state);
}

export function recordHandEvent(room, type, details = {}, now = Date.now()) {
  const state = pendingState(room);
  if (!state || state.hand !== room.hand || state.round !== (room.roundNumber || 1) ||
      !types.has(type) || type === 'start' || type === 'settlement') return false;
  const next = capture(room, type, details || {}, now, state);
  if (!next) return false;
  // Keep the final slot for settlement even if an unusually long hand overflows.
  if (state.events.length >= MAX_HAND_EVENTS - 1) { state.truncated = true; persistPending(room, state); return false; }
  state.events.push(next);
  persistPending(room, state);
  return true;
}

export function finishHandEvents(room, now = Date.now()) {
  const state = pendingState(room);
  active.delete(room);
  delete room.replayPending;
  if (!state || state.hand !== room.hand || state.round !== (room.roundNumber || 1)) return null;
  const last = capture(room, 'settlement', {}, now, state);
  if (last) state.events.push(last);
  return {version: HAND_REPLAY_VERSION, hand: state.hand, startedAt: state.startedAt,
    finishedAt: chips(now), truncated: state.truncated,
    complete: !state.truncated && state.events[0]?.type === 'start' && !!last, events: state.events};
}

function publicReveals(hand, ids) {
  const winners = new Set(list(hand.pots).filter(p => p && !p.refund).flatMap(p => list(p.winnerIds)));
  const participants = new Set(list(hand.results).map(p => p?.id));
  const seen = new Set();
  return [...list(hand.shownWinners).map(p => ({p, allowed: winners.has(p?.id) && Number.isSafeInteger(p?.won) && p.won >= 0})),
    ...list(hand.shownPlayers).map(p => ({p, allowed: participants.has(p?.id)}))]
    .filter(({p, allowed}) => allowed && p && ids.has(p.id) && !seen.has(p.id) &&
      Array.isArray(p.cards) && p.cards.length === 2 && p.cards.every(card) && p.cards[0] !== p.cards[1] && seen.add(p.id))
    .slice(0, 9).map(({p}) => ({id: id(p.id), name: text(p.name), cards: [...p.cards], handLabel: text(p.handLabel)}));
}

export function publicReplay(hand) {
  const saved = hand?.replay;
  if (!saved || saved.version !== HAND_REPLAY_VERSION || saved.hand !== hand.hand || !Array.isArray(saved.events)) return null;
  const oversized = saved.events.length > MAX_HAND_EVENTS;
  const source = oversized ? [...saved.events.slice(0, MAX_HAND_EVENTS - 1), saved.events.at(-1)] : saved.events;
  const events = source.map((value, i) => event(value, i === source.length - 1)).filter(Boolean);
  if (!events.length) return null;
  const last = events.at(-1);
  if (last.type === 'settlement') {
    last.shownPlayers = publicReveals(hand, new Set(last.players.map(p => p.id)));
  }
  const truncated = saved.truncated === true || oversized || events.length !== source.length;
  return {version: HAND_REPLAY_VERSION, hand: saved.hand, startedAt: chips(saved.startedAt), finishedAt: chips(saved.finishedAt),
    truncated, complete: saved.complete === true && !truncated && events[0].type === 'start' && last.type === 'settlement', events};
}
