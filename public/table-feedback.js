import {objectTransitions} from './table-objects.js?v=realtable1';
import {chipBundle,payoutTransfers} from './chip-display.js?v=fivechips1';
const { preferences, transitions, WarningClock, HapticClock, winnerIds } =
  window.TableExperience;
export class TableFeedback {
  constructor() {
    try {
      this.settings = preferences(
        JSON.parse(localStorage.getItem("holdem-experience")),
      );
    } catch {
      this.settings = preferences();
    }
    this.animations = new Set();
    this.voices = new Set();
    this.warning = new WarningClock();
    let savedHaptics;
    try { savedHaptics = JSON.parse(sessionStorage.getItem('holdem-haptics')); } catch {}
    this.haptics = new HapticClock(savedHaptics);
    this.audio = null;
    this.active = false;
    this.apply();
    document.addEventListener("visibilitychange", () => {
      this.reset();
      if (document.hidden) this.audio?.suspend().catch(() => {});
    });
    window.addEventListener("pagehide", () => {
      this.reset();
      this.audio?.close().catch(() => {});
    });
    document.addEventListener(
      "pointerdown",
      () => {
        if (this.settings.sound) this.unlock();
      },
      { passive: true },
    );
    document.addEventListener("keydown", () => {
      if (this.settings.sound) this.unlock();
    });
  }
  apply() {
    document.body.classList.toggle("motion-off", !this.settings.motion);
    document.body.classList.toggle("four-color", this.settings.fourColor);
  }
  configure(patch) {
    this.settings = preferences({ ...this.settings, ...patch });
    try {
      localStorage.setItem("holdem-experience", JSON.stringify(this.settings));
    } catch {}
    this.apply();
    if (!this.settings.motion) this.clear();
    if (!this.settings.vibration) this.stopVibration();
    if (!this.settings.sound) {
      this.stopSound();
      this.audio?.suspend().catch(() => {});
    } else this.unlock();
  }
  async unlock() {
    if (!this.settings.sound || document.hidden) return false;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return false;
      if(this.audio?.state==='closed')this.audio=null;
      this.audio ??= new Audio();
      await this.audio.resume();
      return this.audio.state === "running";
    } catch {
      return false;
    }
  }
  sound(kind) {
    if (
      !this.settings.sound ||
      !this.settings.volume ||
      document.hidden ||
      this.audio?.state !== "running"
    )
      return;
    // Short filtered noise bursts model contact sounds without downloaded audio.
    if(['dice','flip','fold','check'].includes(kind)) {
      const pulses=kind==='dice'?[0,.09,.2,.34,.51,.72,.88]:kind==='check'?[0,.07]:[0];
      for(const [index,delay] of pulses.entries())this.contactSound(kind,delay,index,pulses.length);
    }
    const sounds = {
      allin: [[330,0,.07],[495,.08,.12]],
      deal: [
        [720, 0, 0.045],
        [540, 0.08, 0.045],
      ],
      chip: [
        [1100, 0, 0.035],
        [790, 0.045, 0.04],
      ],
      turn: [
        [620, 0, 0.1],
        [830, 0.12, 0.15],
      ],
      warning: [[440, 0, 0.13]],
      win: [
        [523, 0, 0.1],
        [659, 0.11, 0.1],
        [784, 0.22, 0.18],
      ],
    };
    try {
      for (const [hz, delay, len] of sounds[kind] || []) {
        if(this.voices.size>=24)break;
        const a = this.audio,
          o = a.createOscillator(),
          g = a.createGain(),
          t = a.currentTime + delay;
        o.type = kind === "chip" ? "triangle" : "sine";
        o.frequency.value = hz;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.14 * this.settings.volume, t + 0.008);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g);
        this.voices.add(o);
        g.connect(a.destination);
        o.start(t);
        o.stop(t + len + 0.02);
        o.onended = () => {
          this.voices.delete(o);
          o.disconnect();
          g.disconnect();
        };
      }
    } catch {}
  }
  contactSound(kind,delay,index,count) {
    if(this.voices.size>=24)return;
    try {
      const a=this.audio,source=a.createBufferSource(),filter=a.createBiquadFilter(),gain=a.createGain();
      const len=kind==='flip'?.075:kind==='fold'?.09:.035;
      const buffer=a.createBuffer(1,Math.ceil(a.sampleRate*len),a.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
      source.buffer=buffer;filter.type='bandpass';filter.frequency.value=kind==='dice'?1800-index*110:kind==='check'?700:2600;filter.Q.value=.7;
      const t=a.currentTime+delay,level=(kind==='dice'?.23*(1-index/count*.45):.13)*this.settings.volume;
      gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(level,t+.003);gain.gain.exponentialRampToValueAtTime(.0001,t+len);
      source.connect(filter);filter.connect(gain);gain.connect(a.destination);this.voices.add(source);
      source.onended=()=>{this.voices.delete(source);source.disconnect();filter.disconnect();gain.disconnect();};
      source.start(t);source.stop(t+len+.01);
    } catch {}
  }
  get moving() {
    return (
      this.settings.motion &&
      !document.hidden &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }
  animate(element, frames, options = {}, cleanup) {
    if (!element || !this.moving || !element.animate) {
      cleanup?.();
      return;
    }
    const animation = element.animate(frames, {
      duration: 260,
      easing: "ease-out",
      ...options,
    });
    this.animations.add(animation);
    const done = () => {
      this.animations.delete(animation);
      cleanup?.();
    };
    animation.onfinish = animation.oncancel = done;
  }
  clear() {
    for (const a of this.animations) a.cancel();
    this.animations.clear();
    document.querySelectorAll(".flying-chip").forEach((e) => e.remove());
  }
  reset() {
    this.stopVibration();
    this.stopSound();
    this.previous = null;
    this.wagerAnchors = new Map();
    this.warning.reset();
    this.clear();
  }
  stopSound() {
    for (const o of this.voices) {
      try {
        o.stop();
      } catch {}
    }
    this.voices.clear();
  }
  tick(room, seconds) {
    this.vibrate(room, seconds);
    if (
      this.previous &&
      this.active &&
      !document.hidden &&
      this.warning.tick(room, seconds)
    )
      this.sound("warning");
  }
  get vibrationSupported() { return typeof navigator.vibrate === 'function'; }
  stopVibration() {
    try { if (this.vibrationSupported && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(0); } catch {}
  }
  vibrate(room, seconds) {
    if (!this.settings.vibration || !this.active || document.hidden || !this.vibrationSupported ||
      navigator.userActivation?.hasBeenActive === false) return;
    const kind = this.haptics.tick(room, seconds);
    if (!kind) return;
    try { sessionStorage.setItem('holdem-haptics', JSON.stringify(this.haptics.entries())); } catch {}
    try { navigator.vibrate(kind === 'warning' ? [100, 100, 100] : 100); } catch {}
  }
  update(room) {
    const previous=this.previous;
    const events = document.hidden ? [] : transitions(this.previous, room);
    const collected=document.hidden?[]:objectTransitions(this.previous,room),oldAnchors=this.wagerAnchors||new Map();
    const table=document.querySelector('.table-wrap'),tableBounds=table?.getBoundingClientRect();
    this.wagerAnchors=new Map();
    if(tableBounds?.width)for(const node of document.querySelectorAll('.table-object .table-wager')){
      const rect=node.getBoundingClientRect();this.wagerAnchors.set(node.parentElement.dataset.player,{x:(rect.left+rect.width/2-tableBounds.left)/tableBounds.width,y:(rect.top+rect.height/2-tableBounds.top)/tableBounds.height});
    }
    if (!this.previous && room.deadline - room.serverTime <= 10000)
      this.warning.key = window.TableExperience.decisionKey(room);
    this.previous = room;
    const settled = ["showdown", "ended"].includes(room.phase);
    const winners = new Set(settled ? winnerIds(room) : []);
    document.querySelectorAll(".seat").forEach((e) => {
      const p = room.players.find((p) => p.id === e.dataset.player);
      e.classList.toggle("winner", !!p && winners.has(p.id));
    });
    if (!this.active || document.hidden) return;
    if(this.moving&&tableBounds?.width){
      const pot=document.getElementById('pot').getBoundingClientRect();
      for(const entry of collected){const from=oldAnchors.get(entry.player);if(!from)continue;
        const chip=chipBundle(entry.amount);chip.classList.add('flying-chip');chip.setAttribute('aria-hidden','true');
        chip.style.left=from.x*tableBounds.width+'px';chip.style.top=from.y*tableBounds.height+'px';table.append(chip);
        this.animate(chip,[{transform:'translate(0,0)',opacity:1},{transform:`translate(${pot.left+pot.width/2-tableBounds.left-from.x*tableBounds.width}px,${pot.top-tableBounds.top-from.y*tableBounds.height}px)`,opacity:0}],{duration:360},()=>chip.remove());
      }
    }
    for (const event of events) {
      if (event.kind === "deal") {
        document
          .querySelectorAll("#myCards .card,.seat .cards .card")
          .forEach((e, i) =>
            this.animate(
              e,
              [
                { opacity: 0, transform: "translateY(-16px) rotate(-8deg)" },
                { opacity: 1, transform: "none" },
              ],
              { delay: Math.min(i, 5) * 35 },
            ),
          );
      }
      if (event.kind === "board")
        document.querySelectorAll("#board .card").forEach((e, i) => {
          if (i >= event.from)
            this.animate(
              e,
              [
                { opacity: 0, transform: "translateY(-24px) rotate(-6deg)" },
                { opacity: 1, transform: "none" },
              ],
              { delay: (i - event.from) * 90 },
            );
        });
      if (event.kind === "bet" && this.moving) {
        const source = [...document.querySelectorAll(".seat")].find(
          (e) => e.dataset.player === event.player,
        );
        const table = document.querySelector(".table-wrap"),
          pot = [...document.querySelectorAll('.table-object')].find(e=>e.dataset.player===event.player)?.querySelector('.wager-chips');
        if (source && table && pot) {
          const s = source.getBoundingClientRect(),
            t = table.getBoundingClientRect(),
            p = pot.getBoundingClientRect();
          for (let i = 0; i < 1; i++) {
            const chip = chipBundle(event.amount);
            chip.classList.add("flying-chip");
            chip.setAttribute("aria-hidden", "true");
            chip.style.left = s.left + s.width / 2 - t.left + "px";
            chip.style.top = s.top + s.height / 2 - t.top + "px";
            table.append(chip);
            this.animate(
              chip,
              [
                { transform: "translate(0,0)", opacity: 1 },
                {
                  transform: `translate(${p.left + p.width / 2 - s.left - s.width / 2 + i * 5}px,${p.top + p.height / 2 - s.top - s.height / 2}px)`,
                  opacity: 0,
                },
              ],
              { duration: 400, delay: i * 45 },
              () => chip.remove(),
            );
          }
        }
      }
      if (event.kind === "settle") {
        if(this.moving) {
          const table=document.querySelector('.table-wrap'),pot=document.getElementById('pot');
          if(table&&pot){const bounds=table.getBoundingClientRect(),source=pot.getBoundingClientRect();
            for(const {id,amount} of payoutTransfers(previous,room)){
              const target=[...document.querySelectorAll('.seat')].find(seat=>seat.dataset.player===id)?.querySelector('.avatar');
              if(!target)continue;const end=target.getBoundingClientRect();
              const chip=chipBundle(amount);chip.classList.add('flying-chip','settlement-flight');chip.setAttribute('aria-hidden','true');chip.dataset.recipient=id;chip.dataset.amount=String(amount);
              table.append(chip);
              const sx=source.left+source.width/2,sy=source.top+source.height/2,dx=end.left+end.width/2-sx,dy=end.top+end.height/2-sy;
              chip.style.left=sx-bounds.left-chip.offsetWidth/2+'px';chip.style.top=sy-bounds.top-chip.offsetHeight/2+'px';
              this.animate(chip,[{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${dx*.5}px,${dy*.5-16}px) scale(.9)`,opacity:1,offset:.5},{transform:`translate(${dx}px,${dy}px) scale(.25)`,opacity:0}],{duration:650,delay:collected.length?360:0},()=>chip.remove());
            }
          }
        }
      }
    }
    const kind = events.some((e) => ["settle", "champion"].includes(e.kind))
      ? "win"
      : events.some((e) => e.kind === "turn")
        ? "turn"
        : events.some((e) => e.kind === "deal")
          ? "deal"
          : events.some((e) => e.kind === "board")
            ? "flip"
          : events.some((e) => e.kind === "bet")
            ? events.some(e=>e.kind==='bet'&&room.players.find(p=>p.id===e.player)?.stack===0)?'allin':"chip"
            : events.some(e=>e.kind==='fold')?'fold':events.some(e=>e.kind==='check')?'check':null;
    if (kind) this.sound(kind);
  }
}
