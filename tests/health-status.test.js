import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { projectHealthStatus } from '../server/health-status.js';

const now = Date.parse('2026-11-18T12:00:00Z');
const window = (ago, p95 = 20, extra = {}) => ({ at: new Date(now - ago * 60000).toISOString(),
  intervalSeconds: 60, slowConnections: 0, actionTotalMs: { count: 20, p95 }, ...extra });
const input = () => ({ now, buildVersion: 'dock2-dceb120', backup: { intervalSeconds: 21600 },
  backups: [{ valid: true, createdAt: now - 3600000 }],
  latency: { recent: [window(3), window(2), window(1)] } });

test('no data is unknown; complete evidence can be observed', () => {
  const empty = projectHealthStatus({ now });
  assert.equal(empty.status, 'unknown');
  assert.equal(empty.buildVersion, null);
  assert.equal(empty.lastVerifiedBackupAt, null);
  assert.ok(Object.values(empty.checks).every(c => c.status === 'unknown'));
  assert.equal(projectHealthStatus(input()).status, 'ok');
});
test('sustained latency needs the same metric in three completed sampled windows', () => {
  const data = input();
  data.latency.current = window(0, 9999);
  assert.equal(projectHealthStatus(data).checks.latency.status, 'ok');
  data.latency.recent = [window(3, 500), window(2, 500), window(1, 500)];
  const first = projectHealthStatus(data);
  assert.equal(first.checks.latency.code, 'latency_sustained');
  assert.deepEqual(projectHealthStatus(data), first, 'repeated polls do not accumulate');
  data.latency.recent[1].actionTotalMs.count = 19;
  assert.equal(projectHealthStatus(data).checks.latency.status, 'unknown');
  data.latency.recent = [window(3, 700), window(2, 20), window(1, 700)];
  assert.equal(projectHealthStatus(data).checks.latency.status, 'ok');
});
test('stale, future, duplicate and gapped windows cannot prove sustained health', () => {
  for (const recent of [[window(9), window(8), window(7)], [window(2), window(2), window(1)],
    [window(5), window(3), window(1)], [window(-3), window(-2), window(-1)]]) {
    assert.equal(projectHealthStatus({ ...input(), latency: { recent } }).checks.latency.status, 'unknown');
  }
});
test('disconnect anomalies use bounded aggregate signals, not identity or raw payloads', () => {
  const data = input();
  data.latency.recent = [window(2, 20, { wsHeartbeatTimeout: { count: 5 } }),
    window(1, 20, { wsCloseCode1006: { count: 3 }, slowConnections: 2 })];
  assert.equal(projectHealthStatus(data).checks.reconnect.code, 'disconnect_anomaly');
  data.latency.recent[0].wsHeartbeatTimeout.count = 4;
  assert.equal(projectHealthStatus(data).checks.reconnect.status, 'ok');
  delete data.latency.recent[0].slowConnections;
  assert.equal(projectHealthStatus(data).checks.reconnect.status, 'unknown');
});
test('only a verified catalog proves backup success, failure clears with later verification', () => {
  const data = input();
  data.backup.last = { createdAt: now - 10 };
  data.backups = [{ valid: false, createdAt: now - 10 }];
  assert.equal(projectHealthStatus(data).checks.backup.code, 'backup_unverified');
  data.backup.failedAt = now - 100;
  assert.equal(projectHealthStatus(data).checks.backup.code, 'backup_failed');
  data.backups.push({ valid: true, createdAt: now - 50 });
  assert.equal(projectHealthStatus(data).checks.backup.code, 'backup_verified');
  data.backups = [{ valid: true, createdAt: now - 25 * 3600000 }];
  data.backup.failedAt = null;
  assert.equal(projectHealthStatus(data).checks.backup.code, 'backup_stale');
  data.backups = [{ valid: true, createdAt: now + 1 }];
  assert.equal(projectHealthStatus(data).lastVerifiedBackupAt, null);
  delete data.backups;
  assert.equal(projectHealthStatus(data).checks.backup.code, 'backup_unavailable');
});
test('bounded input inspection, allowlisted output, no mutation or reference retention', () => {
  const data = input();
  const secret = '/private/token/cards/identifying-name';
  data.buildVersion = secret;
  data.backups[0].path = secret;
  data.latency.recent[0].raw = secret;
  const before = structuredClone(data);
  const result = projectHealthStatus(data);
  assert.deepEqual(data, before);
  assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(result.status, 'unknown');
  const recent = Array(10000).fill(window(9, 900));
  recent.push(...input().latency.recent);
  assert.equal(projectHealthStatus({ ...input(), latency: { recent } }).checks.latency.status, 'ok');
  assert.equal(projectHealthStatus({ ...input(), backups: Array(91).fill(data.backups[0]) }).checks.backup.status, 'unknown');
  assert.throws(() => projectHealthStatus({ now: NaN }), /clock/);
});

test('admin UI renders absent/stale evidence as unknown and warnings as text only', () => {
  const node = () => ({ dataset: {}, children: [], textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; } });
  const nodes = new Map();
  const context = vm.createContext({
    $: id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); },
    document: { createElement: node }, date: value => String(value),
  });
  const source = readFileSync(new URL('../public/admin.js', import.meta.url), 'utf8');
  vm.runInContext(source.slice(source.indexOf('const healthMessages ='), source.indexOf('async function refreshSystem')), context);
  context.health = projectHealthStatus({ ...input(), now: Date.now() });
  vm.runInContext('renderHealth(null)', context);
  assert.equal(nodes.get('healthStatus').dataset.status, 'unknown');
  context.health.at = new Date(Date.now() - 180000).toISOString();
  vm.runInContext('renderHealth(health)', context);
  assert.equal(nodes.get('healthStatus').dataset.status, 'unknown');
  context.health.at = new Date().toISOString();
  context.health.status = 'warning';
  context.health.checks.backup = { status: 'warning', code: 'backup_failed' };
  context.health.buildVersion = '<img onerror=alert(1)>';
  vm.runInContext('renderHealth(health)', context);
  assert.equal(nodes.get('healthStatus').dataset.status, 'warning');
  assert.equal(nodes.get('healthMetadata').children[0].children[1].textContent, '<img onerror=alert(1)>');
  assert.match(nodes.get('healthChecks').children[2].textContent, /最近备份失败/);
});
