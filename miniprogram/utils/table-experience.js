(function (root) {
  function preferences(value) {
    const v = value && typeof value === "object" ? value : {};
    return {
      sound: v.sound === true,
      vibration: v.vibration === true,
      motion: v.motion !== false,
      fourColor: v.fourColor === true,
      volume: Number.isFinite(v.volume)
        ? Math.max(0, Math.min(1, v.volume))
        : 0.35,
    };
  }
  function decisionKey(r) {
    return r
      ? [
          r.id,
          r.me,
          r.roundNumber || 1,
          r.hand,
          r.phase,
          r.turn,
          r.deadline,
        ].join(":")
      : "";
  }
  function chipUnit(r) { return r?.chipUnit === 5 ? 5 : 1; }
  function betOptions(r) {
    const me = r.players.find((p) => p.id === r.me);
    const max = (me?.bet || 0) + (me?.stack || 0),
      min = r.currentBet + r.minRaise;
    const clamp = (n) =>
        Math.max(Math.min(min, max), Math.min(max, Math.round(n / chipUnit(r)) * chipUnit(r)));
    const call = Math.min(r.toCall, me?.stack || 0);
    return {
      min,
      max,
      call,
      half: clamp((me?.bet || 0) + call + (r.pot + call) / 2),
      pot: clamp((me?.bet || 0) + call + r.pot + call),
      canRaise: !!r.canRaise && max >= min,
      canAllin: (!!r.canRaise || max <= r.currentBet) && (me?.stack || 0) > 0,
    };
  }
  function betStep(r) {
    const options=betOptions(r),low=Math.min(options.min,options.max),range=options.max-low;
    if(!(range>0))return 0;
    const me=r.players.find(p=>p.id===r.me),blind=Math.max(1,r.big||1);
    const target=Math.max(blind,Math.min(((r.pot||0)+(options.call||0))*.05,(me?.stack||0)*.02));
    const scale=10**Math.floor(Math.log10(Math.max(1,target)));
    const nice=[5,2,1].map(n=>n*scale).find(n=>n<=target)||1;
      return Math.min(range,Math.max(chipUnit(r),Math.round(Math.max(blind,nice)/chipUnit(r))*chipUnit(r)));
  }
  function betImpact(r,value){
    const amount=Number(value),options=betOptions(r),me=r.players.find(p=>p.id===r.me);
    if(!me||!/^\d+$/.test(String(value))||!Number.isSafeInteger(amount)||amount%chipUnit(r)||amount<Math.min(options.min,options.max)||amount>options.max)return null;
    const added=amount-(me.bet||0);return {target:amount,added,remaining:me.stack-added,allin:amount===options.max};
  }
  function connectionStatus(mode){
    return {connecting:'正在建立连接',authenticating:'正在验证账号',resuming:'正在恢复牌局',offline:'网络已断开',waiting:'等待重新连接',idle:'准备连接',stopped:'连接已停止',ready:'已连接'}[mode]||'重新连接中';
  }
  function stepBetAmount(r,value,direction) {
    const options=betOptions(r),low=Math.min(options.min,options.max);
    const parsed=Number(value),valid=/^\d+$/.test(String(value))&&Number.isSafeInteger(parsed);
    const current=valid?Math.max(low,Math.min(options.max,parsed)):low;
      return Math.max(low,Math.min(options.max,Math.round((current+Math.sign(direction)*betStep(r))/chipUnit(r))*chipUnit(r)));
  }
  function winnerIds(r) {
    const ids = new Set();
    for (const pot of r.pots || []) {
      if (pot.refund) continue;
      if (Array.isArray(pot.winnerIds))
        pot.winnerIds.forEach((id) => ids.add(id));
      else
        for (const name of pot.winners) {
          const matches = r.players.filter((p) => p.name === name);
          if (matches.length === 1) ids.add(matches[0].id);
        }
    }
    return [...ids];
  }
  function transitions(a, b) {
    if (
      !a ||
      !b ||
      a.id !== b.id ||
      a.me !== b.me ||
      (b.roundNumber || 1) < (a.roundNumber || 1) ||
      ((b.roundNumber || 1) === (a.roundNumber || 1) && b.hand < a.hand) ||
      (Number.isFinite(a.serverTime) &&
        Number.isFinite(b.serverTime) &&
        b.serverTime < a.serverTime)
    )
      return [];
    const events = [],
      active = (r) => ["preflop", "flop", "turn", "river"].includes(r.phase);
    const sameRound = (b.roundNumber || 1) === (a.roundNumber || 1);
    if ((!sameRound || b.hand > a.hand) && active(b))
      events.push({ kind: "deal" });
    else if (sameRound && b.hand === a.hand) {
      if (b.board.length > a.board.length)
        events.push({ kind: "board", from: a.board.length });
      for (const p of b.players) {
        const old = a.players.find((q) => q.id === p.id);
        if (!old) continue;
        if (p.totalBet > old.totalBet)
          events.push({
            kind: "bet",
            player: p.id,
            amount: p.totalBet - old.totalBet,
          });
        if (p.folded && !old.folded)
          events.push({ kind: "fold", player: p.id });
      }
      const oldActor=a.players[a.turn],actor=b.players.find(p=>p.id===oldActor?.id);
      if(active(a)&&active(b)&&a.phase===b.phase&&!a.flopReveal&&!b.flopReveal&&
        a.turn!==b.turn&&oldActor?.inHand&&actor?.inHand&&!actor.folded&&
        oldActor.stack>0&&oldActor.bet===a.currentBet&&actor.totalBet===oldActor.totalBet)
        events.push({kind:'check',player:actor.id});
    }
    if (
      active(b) &&
      b.players[b.turn]?.id === b.me &&
      decisionKey(a) !== decisionKey(b)
    )
      events.push({ kind: "turn" });
    if (
      sameRound &&
      active(a) &&
      b.hand === a.hand &&
      ["showdown", "ended"].includes(b.phase)
    ) {
      events.push({
        kind: "settle",
        winners: winnerIds(b),
      });
    }
    if (b.tournament?.completed && !a.tournament?.completed)
      events.push({ kind: "champion", player: b.tournament.championId });
    return events;
  }
  class WarningClock {
    tick(r, seconds) {
      if (
        !r ||
        r.players[r.turn]?.id !== r.me ||
        seconds > 10 ||
        seconds <= 0 ||
        !["preflop", "flop", "turn", "river"].includes(r.phase)
      )
        return false;
      const key = decisionKey(r);
      if (this.key === key) return false;
      this.key = key;
      return true;
    }
    reset() {
      this.key = null;
    }
  }
  class HapticClock {
    constructor(saved) {
      this.seen = new Map((Array.isArray(saved) ? saved : []).filter(entry =>
        Array.isArray(entry) && typeof entry[0] === 'string' && entry[0].length < 400 &&
        [1, 3].includes(entry[1])).slice(-64));
    }
    entries() { return [...this.seen]; }
    tick(r, seconds) {
      const me = r?.players?.find(player => player.id === r.me);
      if (!r || r.gameMode !== 'friends' || r.spectating || r.godMode || r.flopReveal ||
        !['preflop','flop','turn','river'].includes(r.phase) || !Number.isFinite(r.deadline) ||
        !Number.isFinite(seconds) || seconds <= 0 || !me?.inHand || me.folded || me.removed ||
        me.eliminated || !(me.stack > 0) || r.players[r.turn]?.id !== r.me) return null;
      const key = decisionKey(r), previous = this.seen.get(key) || 0;
      const next = seconds <= 10 ? 3 : 1;
      if ((previous & next) === next) return null;
      this.seen.set(key, previous | next);
      while (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value);
      return seconds <= 10 ? 'warning' : 'turn';
    }
  }
  const api = {
    chipUnit,
    preferences,
    decisionKey,
    betOptions,
    betImpact,
    connectionStatus,
    betStep,
    stepBetAmount,
    transitions,
    WarningClock,
    HapticClock,
    winnerIds,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TableExperience = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
