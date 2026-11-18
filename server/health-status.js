// Pure, bounded projection. No I/O, timers, identifiers, raw errors or source objects
// are retained/returned. Parent supplies trusted build metadata and backup catalog.
const MINUTE = 60_000;
const timestamp = value => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const count = value => Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 1_000_000_000) : null;
const signal = (status, code) => ({ status, code });

/**
 * Integration: diagnostics.health = projectHealthStatus({now: Date.now(),
 * buildVersion, latency: metrics.snapshot(), backup: {failedAt, intervalSeconds},
 * backups: await backupSummary()}). Call only inside authenticated admin handlers.
 * buildVersion must come from trusted env/build metadata (never package fallback).
 * backups must be the verified catalog; backup.last alone is not proof of verification.
 * Existing metrics.recent contains completed 60-second windows; current is partial
 * and deliberately excluded, so polling cannot manufacture sustained incidents.
 */
export function projectHealthStatus({ now = Date.now(), buildVersion, latency, backup, backups } = {}) {
  if (!Number.isFinite(now) || now <= 0) throw new TypeError('Invalid health clock');
  const version = typeof buildVersion === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,63}$/.test(buildVersion)
    ? buildVersion : null;
  // Only inspect the bounded tail; do not sort or clone an unbounded input.
  const windows = [];
  for (const item of (Array.isArray(latency?.recent) ? latency.recent.slice(-60) : [])) {
    const at = timestamp(item?.at);
    if (at && at <= now && now - at <= 5 * MINUTE && item.intervalSeconds === 60 &&
        (!windows.length || at > windows.at(-1).at)) windows.push({ at, item });
  }
  const consecutive = n => {
    const tail = windows.slice(-n);
    return tail.length === n && now - tail.at(-1).at <= 2 * MINUTE &&
      tail.every((w, i) => !i || (w.at - tail[i - 1].at >= 45_000 && w.at - tail[i - 1].at <= 75_000)) ? tail : [];
  };
  const latencyTail = consecutive(3);
  const limits = { actionTotalMs: 500, clientRttMs: 300, saveMs: 50, queueMs: 100 };
  const usable = (item, key) => count(item[key]?.count) >= 20 && Number.isFinite(item[key]?.p95) && item[key].p95 >= 0;
  const sustained = Object.entries(limits).some(([key, limit]) => latencyTail.length &&
    latencyTail.every(({ item }) => usable(item, key) && item[key].p95 >= limit));
  const hasLatency = latencyTail.length && Object.keys(limits).some(key => latencyTail.every(({ item }) => usable(item, key)));
  const latencySignal = sustained ? signal('warning', 'latency_sustained') :
    hasLatency ? signal('ok', 'latency_observed') : signal('unknown', 'latency_insufficient');

  const reconnectTail = consecutive(2);
  // Absence of a counter means zero only within a completed, observed metric window.
  const disconnects = item => {
    const values = [item.wsCloseCode1006?.count ?? 0, item.wsHeartbeatTimeout?.count ?? 0, item.slowConnections];
    return values.every(v => count(v) !== null) ? values.reduce((sum, v) => sum + count(v), 0) : null;
  };
  const reconnectCounts = reconnectTail.map(({ item }) => disconnects(item));
  const reconnectSignal = reconnectCounts.length !== 2 || reconnectCounts.includes(null)
    ? signal('unknown', 'reconnect_insufficient')
    : reconnectCounts.every(n => n >= 5) ? signal('warning', 'disconnect_anomaly') : signal('ok', 'disconnect_observed');

  let verifiedAt = null;
  // Existing retention is capped at 90. A truncated catalog is incomplete evidence.
  const catalogKnown = Array.isArray(backups) && backups.length <= 90;
  if (catalogKnown) for (const item of backups) {
    const at = timestamp(item?.createdAt);
    if (item?.valid === true && at && at <= now && (!verifiedAt || at > verifiedAt)) verifiedAt = at;
  }
  const failedAt = timestamp(backup?.failedAt);
  const interval = backup?.intervalSeconds;
  const staleAfterMs = Number.isFinite(interval) && interval > 0
    ? Math.max(24 * 60 * MINUTE, Math.min(interval * 2000, 30 * 24 * 60 * MINUTE)) : 24 * 60 * MINUTE;
  const backupSignal = failedAt && failedAt <= now && (!verifiedAt || failedAt >= verifiedAt)
    ? signal('warning', 'backup_failed') : !catalogKnown ? signal('unknown', 'backup_unavailable')
      : !verifiedAt ? signal('unknown', 'backup_unverified')
        : now - verifiedAt > staleAfterMs ? signal('warning', 'backup_stale') : signal('ok', 'backup_verified');
  const checks = { latency: latencySignal, reconnect: reconnectSignal, backup: backupSignal };
  const status = Object.values(checks).some(s => s.status === 'warning') ? 'warning'
    : !version || Object.values(checks).some(s => s.status === 'unknown') ? 'unknown' : 'ok';
  return { at: new Date(now).toISOString(), status, buildVersion: version,
    lastVerifiedBackupAt: verifiedAt ? new Date(verifiedAt).toISOString() : null,
    backupStaleAfterHours: staleAfterMs / 3_600_000, checks };
}
