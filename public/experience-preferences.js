// Legacy device choices belong only to the anonymous/device scope.
export class ExperiencePreferences {
  constructor(normalize, storage) {
    this.normalize = normalize;
    this.storage = storage;
    this.memory = new Map();
    this.account = null;
  }
  key(id = this.account) {
    return id === null ? 'holdem-experience' : `holdem-experience:account:${encodeURIComponent(id)}`;
  }
  setAccount(id) {
    this.account = id === null || id === undefined || id === '' ? null : String(id);
    return this.load();
  }
  load() {
    const key = this.key();
    if (!this.memory.has(key)) {
      let saved;
      try { saved = JSON.parse(this.storage?.getItem(key)); } catch {}
      this.memory.set(key, this.normalize(saved));
    }
    return { ...this.memory.get(key) };
  }
  save(value) {
    const settings = this.normalize(value);
    this.memory.set(this.key(), settings);
    try { this.storage?.setItem(this.key(), JSON.stringify(settings)); } catch {}
    return { ...settings };
  }
}
