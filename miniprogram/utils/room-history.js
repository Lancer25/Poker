(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.RoomHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  class HistoryCache {
    constructor() { this.reset(); }
    reset() {
      this.context = null;
      this.entries = new Map();
      this.rounds = [];
      this.revision = (this.revision || 0) + 1;
      this.catalogRevision = this.revision;
      this.unavailable = {hands:[],total:0,offset:0,loaded:true,loading:false,error:"仅可查看当前场和上一场",revision:this.revision};
    }
    sync(account, room) {
      const compact = room.transportVersion === 2 || room.stateVersion === 2;
      const round = room.roundNumber || 1;
      const previous = Object.prototype.hasOwnProperty.call(room,"previousRoundNumber") ? room.previousRoundNumber : compact ? round>1?round-1:null :
        (room.completedRounds || []).reduce((n,r)=>r.number<round?Math.max(n||0,r.number):n,null);
      const recent = compact ? [] : (room.completedRounds || []).filter(r=>r.number===round || r.number===previous);
      const version = compact ? room.historyVersion : JSON.stringify([room.history || [], recent]);
      const c = this.context;
      if (!c || c.account !== account || c.roomId !== room.id || c.compact !== compact || !compact && c.version !== version) {
        this.reset();
        this.context = { account, roomId: room.id, version, round, previous, compact, count: room.historyCount || 0 };
        if (!compact) {
          this.rounds = recent.filter(r=>r.number===previous).slice(0,1);
          this.seed(round, room.history || []);
          for (const r of this.rounds) this.seed(r.number, r.history || []);
        }
      } else if (c.version !== version || c.round !== round || c.previous !== previous) {
        // Replace the context to invalidate requests while keeping public cached hands.
        this.context = { account, roomId: room.id, version, round, previous, compact, count: room.historyCount || 0 };
        for (const entry of this.entries.values()) entry.loading = false;
        const current = this.entry();
        if (c.round === round && this.context.count >= c.count) {
          const added = this.context.count - c.count;
          current.refreshAdded = (current.refreshAdded || 0) + added;
          current.pendingOffset = current.refreshAdded > 50 ? 0 : (current.pendingOffset ?? current.offset) + added;
        } else {
          current.pendingOffset = 0;
          if (c.round !== round && this.entries.has(c.round)) {
            const archived = this.entries.get(c.round);
            archived.loaded = false;
            archived.pendingOffset = archived.offset;
            archived.error = "";
          }
        }
        current.loaded = false;
        current.error = "";
      }
      for(const number of this.entries.keys())if(!this.allowedRound(number))this.entries.delete(number);
      const rounds=this.rounds.filter(r=>r.number===previous).slice(0,1);
      if(rounds.length!==this.rounds.length){this.rounds=rounds;this.catalogRevision=++this.revision;}
      return compact ? this.restore(room) : recent.length===(room.completedRounds||[]).length ? room : {...room,completedRounds:recent};
    }
    allowedRound(round) { return !!this.context && (round===this.context.round || round===this.context.previous); }
    seed(round, hands) {
      this.entries.set(Number(round), { hands, total: hands.length, offset: hands.length, loaded: true, loading: false, error: "", revision: ++this.revision });
    }
    entry(selected = "current") {
      const round = selected === "current" ? this.context.round : Number(selected);
      if(!this.allowedRound(round))return this.unavailable;
      if (!this.entries.has(round)) this.entries.set(round, { hands: [], total: 0, offset: 0, loaded: false, loading: false, error: "", revision: ++this.revision });
      return this.entries.get(round);
    }
    begin(selected = "current", more = false, retry = false) {
      if (!this.context?.compact) return null;
      if(!this.allowedRound(selected==='current'?this.context.round:Number(selected)))return null;
      const entry = this.entry(selected);
      if (entry.loading || (entry.error && !retry) || (!more && entry.loaded) || (more && (!entry.loaded || entry.offset >= entry.total))) return null;
      entry.loading = true;
      entry.error = "";
      return { context: this.context, entry, selected, round: selected === "current" ? this.context.round : Number(selected), offset: more ? entry.offset : 0 };
    }
    active(request) { return !!request && request.context === this.context && this.allowedRound(request.round); }
    accept(request, page) {
      if (!this.active(request)) return false;
      if (page.roomId !== request.context.roomId || page.version !== request.context.version || page.roundNumber !== request.round || page.currentRound !== request.context.round || page.offset !== request.offset || !Array.isArray(page.hands) || !Array.isArray(page.rounds) || !Number.isInteger(page.total) || page.total < 0) {
        this.fail(request, "记录已更新，请重试");
        return false;
      }
      const hands = new Map(request.entry.hands.map((h) => [h.hand, h]));
      let changed = false;
      for (const hand of page.hands) {
        if (JSON.stringify(hands.get(hand.hand)) !== JSON.stringify(hand)) {
          hands.set(hand.hand, hand);
          changed = true;
        }
      }
      Object.assign(request.entry, {
        hands: changed ? [...hands.values()].sort((a, b) => a.hand - b.hand) : request.entry.hands,
        total: page.total, offset: Math.min(page.total, Math.max(request.entry.pendingOffset || 0, request.offset + page.hands.length)),
        loaded: true, loading: false, error: "",
      });
      delete request.entry.pendingOffset;
      delete request.entry.refreshAdded;
      if (changed) request.entry.revision = ++this.revision;
      const rounds = page.rounds.filter(r=>r.number===this.context.previous).slice(0,1);
      if (JSON.stringify(this.rounds) !== JSON.stringify(rounds)) {
        this.rounds = rounds;
        this.catalogRevision = ++this.revision;
      }
      return true;
    }
    fail(request, message) {
      if (!this.active(request)) return false;
      request.entry.loading = false;
      request.entry.error = message || "暂时无法加载记录";
      return true;
    }
    restore(room) {
      if (!this.context?.compact) return room;
      return { ...room, history: this.entry().hands, completedRounds: this.rounds.map((r) => ({ ...r, history: this.entry(String(r.number)).hands })) };
    }
    url(request) {
      return `/api/rooms/${encodeURIComponent(request.context.roomId)}/history?round=${request.selected}&offset=${request.offset}&limit=50`;
    }
  }
  class LiveMetrics {
    constructor() { this.echo = null; this.lastSample = null; this.renderMs = 0; this.actions=new Map();this.sequence=0;this.prefix=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
    startAction(now) {
      const id=this.prefix+'-'+(++this.sequence).toString(36);this.actions.set(id,now);
      while(this.actions.size>8)this.actions.delete(this.actions.keys().next().value);
      return id;
    }
    cancelActions(){this.actions.clear();}
    actionRendered(receipt,now,renderMs){
      if(!receipt||!this.actions.has(receipt.id)||!Number.isFinite(receipt.serverMs)||receipt.serverMs<0||receipt.serverMs>120000)return null;
      const totalMs=now-this.actions.get(receipt.id);this.actions.delete(receipt.id);
      if(!Number.isFinite(totalMs)||totalMs<0||totalMs>120000||!Number.isFinite(renderMs)||renderMs<0||renderMs>30000)return null;
      return {id:receipt.id,totalMs,renderMs};
    }
    rendered(ms) { this.renderMs = Math.max(0, Math.min(30000, Number.isFinite(ms) ? ms : 0)); }
    ping(now) { this.echo = now; return { echo: now }; }
    receive(message, now) {
      if (!Number.isFinite(message.echo) || message.echo !== this.echo) return null;
      this.echo = null;
      const rttMs = now - message.echo;
      if (rttMs < 0 || rttMs > 120000 || (this.lastSample !== null && now - this.lastSample < 15000)) return null;
      this.lastSample = now;
      return { rttMs, renderMs: this.renderMs };
    }
  }
  return { HistoryCache, LiveMetrics };
});
