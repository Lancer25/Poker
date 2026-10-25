import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRoomStore as openRoomStore } from '../server/room-store.js';
import { createBackup, createBackupScheduler, createBackupOffThread, listBackupsOffThread, listBackups, verifyBackup, restoreBackup } from '../server/backup-store.js';

const stores = new Map();
function createRoomStore(dir, options) { const store = openRoomStore(dir, options); stores.set(store, dir); return store; }
function sandbox(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'backup-store-'));
  t.after(() => {
    for (const [store, location] of stores) if (location === dir || location.startsWith(dir + path.sep)) { store.close(); stores.delete(store); }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
const dataset = () => ({ rooms: [{ id: 'r', players: [{ id: 'new-id' }], history: [{ hand: 1 }], completedRounds: [] }], sessions: [['secret-token', { player: 'new-id' }]] });

for (const mode of ['json', 'sqlite']) {
  test(`${mode}: immutable snapshot, WAL, accounts ordering, restore and retention`, async t => {
    const root = sandbox(t); const dataDir = path.join(root, 'data');
    const store = createRoomStore(dataDir, { mode }); t.after(() => store.close());
    const data = dataset(); store.save(data);
    if (mode === 'sqlite') assert.ok(store.stats().walBytes > 0);
    mkdirSync(path.join(dataDir, 'avatars')); writeFileSync(path.join(dataDir, 'avatars', 'abc.jpg'), 'picture');
    const wrapped = { ...store, async snapshot(dir) {
      const result = await store.snapshot(dir);
      writeFileSync(path.join(dataDir, 'accounts.json'), '{"users":[{"id":"new-id"}]}');
      return result;
    } };
    const backup = await createBackup(wrapped, dataDir, { root: path.join(root, 'backups'), keep: 1 });
    assert.equal(verifyBackup(backup.path).valid, true);
    assert.equal(JSON.parse(readFileSync(path.join(backup.path, 'accounts.json'))).users[0].id, 'new-id');
    data.rooms[0].history.push({ hand: 2 }); store.save(data);
    const destination = path.join(root, 'restored'); restoreBackup(backup.path, destination);
    const restored = createRoomStore(destination, { mode });
    assert.deepEqual(restored.load(), dataset()); restored.close();
    assert.equal(readFileSync(path.join(destination, 'avatars', 'abc.jpg'), 'utf8'), 'picture');
    assert.throws(() => restoreBackup(backup.path, destination), /NEW/);
    const empty = path.join(root, 'empty'); mkdirSync(empty); assert.throws(() => restoreBackup(backup.path, empty), /NEW/);
    const second = await createBackup(store, dataDir, { root: path.join(root, 'backups'), keep: 1 });
    assert.equal(listBackups(path.join(root, 'backups')).length, 1); assert.equal(existsSync(backup.path), false);
    assert.equal(verifyBackup(second.path).valid, true);
    await assert.rejects(createBackup(store, dataDir, { keep: 0 }));
  });
}

test('tampering and malicious manifest paths are rejected before destination creation', async t => {
  const root = sandbox(t); const dataDir = path.join(root, 'data'); const store = createRoomStore(dataDir, { mode: 'json' }); t.after(() => store.close()); store.save(dataset());
  const backup = await createBackup(store, dataDir);
  writeFileSync(path.join(backup.path, 'rooms.json'), '{}');
  assert.throws(() => verifyBackup(backup.path), /integrity/);
  const dest = path.join(root, 'restore'); assert.throws(() => restoreBackup(backup.path, dest)); assert.equal(existsSync(dest), false);
  const manifestFile = path.join(backup.path, 'manifest.json'); const manifest = JSON.parse(readFileSync(manifestFile));
  manifest.files[0].path = '../accounts.json'; writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => verifyBackup(backup.path), /manifest/);
  assert.equal(listBackups(path.join(dataDir, 'backups'))[0].valid, false);
});

test('unexpected files are rejected', async t => {
  const root = sandbox(t); const store = createRoomStore(path.join(root, 'data'), { mode: 'json' }); t.after(() => store.close());
  const backup = await createBackup(store, path.join(root, 'data'));
  writeFileSync(path.join(backup.path, 'unexpected.txt'), 'extra');
  assert.throws(() => verifyBackup(backup.path), /Unexpected/);
});

test('symlinked avatar directory and duplicate manifest entries are rejected', async t => {
  const root = sandbox(t); const dataDir = path.join(root, 'data');
  const store = createRoomStore(dataDir, { mode: 'json' }); t.after(() => store.close()); store.save(dataset());
  const backup = await createBackup(store, dataDir);
  const manifestFile = path.join(backup.path, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile));
  manifest.files.push(manifest.files[0]); writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => verifyBackup(backup.path), /manifest/);
  manifest.files.pop(); writeFileSync(manifestFile, JSON.stringify(manifest));
  symlinkSync(dataDir, path.join(backup.path, 'avatars'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => verifyBackup(backup.path), /Symbolic/);
});

test('scheduler coalesces requests, drains shutdown, and rejects work after stopping', async t => {
  const root = sandbox(t); const dataDir = path.join(root, 'data');
  const store = createRoomStore(dataDir, { mode: 'json' }); store.save(dataset());
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let snapshots = 0;
  const wrapper = { async snapshot(dir) { snapshots++; await gate; return store.snapshot(dir); } };
  const scheduler = createBackupScheduler(wrapper, dataDir);
  const first = scheduler.run(); assert.equal(scheduler.run(), first);
  assert.equal(scheduler.stats().running, true);
  let drained = false;
  const shutdown = scheduler.stop().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false); assert.equal(snapshots, 1);
  release(); const backup = await first; await shutdown;
  assert.equal(verifyBackup(backup.path).valid, true);
  assert.equal(scheduler.stats().completed, 1); assert.equal(scheduler.stats().running, false);
  await assert.rejects(scheduler.run(), /stopped/); await scheduler.stop();
});

test('scheduler timer runs automatically and recovers after a failed snapshot', async t => {
  const root = sandbox(t); const dataDir = path.join(root, 'data');
  const store = createRoomStore(dataDir, { mode: 'json' });
  t.mock.timers.enable({ apis: ['setInterval'] });
  let fail = true;
  const wrapper = { async snapshot(dir) { if (fail) throw Error('private credential'); return store.snapshot(dir); } };
  const scheduler = createBackupScheduler(wrapper, dataDir, { intervalMs: 1000 });
  t.mock.timers.tick(1000);
  await assert.rejects(scheduler.run(), /private credential/);
  assert.equal(scheduler.stats().failed, 1); assert.equal(JSON.stringify(scheduler.stats()).includes('credential'), false);
  fail = false; t.mock.timers.tick(1000); await scheduler.run();
  assert.equal(scheduler.stats().completed, 1);
  await scheduler.stop(); t.mock.timers.tick(10000); assert.equal(scheduler.stats().completed, 1);
  assert.throws(() => createBackupScheduler(store, dataDir, { intervalMs: 0 }));
});

for (const mode of ['json', 'sqlite']) {
  test(`${mode}: worker snapshot and catalog preserve source and restore with parent store open`, async t => {
    const root = sandbox(t); const dataDir = path.join(root, 'data');
    const store = createRoomStore(dataDir, { mode }); store.save(dataset());
    writeFileSync(path.join(dataDir, 'accounts.json'), '{"users":[{"id":"new-id"}]}');
    mkdirSync(path.join(dataDir, 'avatars')); writeFileSync(path.join(dataDir, 'avatars', 'abc.jpg'), 'picture');
    const jsonBefore = mode === 'json' ? readFileSync(path.join(dataDir, 'rooms.json')) : null;
    if (mode === 'sqlite') assert.ok(store.stats().walBytes > 0);
    let eventLoopRan = false;
    const pending = createBackupOffThread(dataDir, { mode, root: path.join(root, 'backups'), keep: 1 });
    setImmediate(() => { eventLoopRan = true; });
    const backup = await pending;
    assert.equal(eventLoopRan, true); assert.equal(verifyBackup(backup.path).valid, true);
    assert.deepEqual(await listBackupsOffThread(path.join(root, 'backups')), listBackups(path.join(root, 'backups')));
    const destination = path.join(root, 'restored'); restoreBackup(backup.path, destination);
    const restored = createRoomStore(destination, { mode }); assert.deepEqual(restored.load(), dataset()); restored.close();
    assert.equal(readFileSync(path.join(destination, 'avatars', 'abc.jpg'), 'utf8'), 'picture');
    assert.deepEqual(JSON.parse(readFileSync(path.join(destination, 'accounts.json'))), { users: [{ id: 'new-id' }] });
    if (mode === 'json') assert.deepEqual(readFileSync(path.join(dataDir, 'rooms.json')), jsonBefore);
    const updated = dataset(); updated.rooms[0].history.push({ hand: 2 }); store.save(updated);
    assert.deepEqual(store.load(), updated);
    const next = await createBackupOffThread(dataDir, { mode, root: path.join(root, 'backups'), keep: 1 });
    assert.equal(existsSync(backup.path), false); assert.equal((await listBackupsOffThread(path.join(root, 'backups')))[0].path, next.path);
    writeFileSync(path.join(next.path, 'accounts.json'), '{}');
    assert.equal((await listBackupsOffThread(path.join(root, 'backups')))[0].valid, false);
  });
}

test('workers propagate sanitized errors, enforce deadlines and never auto-import JSON', async t => {
  const root = sandbox(t); const dataDir = path.join(root, 'data');
  const store = createRoomStore(dataDir, { mode: 'json' }); store.save(dataset());
  const before = readFileSync(path.join(dataDir, 'rooms.json'));
  await assert.rejects(createBackupOffThread(dataDir, { mode: 'sqlite' }), { code: 'BACKUP_WORKER_FAILED' });
  assert.equal(existsSync(path.join(dataDir, 'rooms.sqlite')), false);
  assert.deepEqual(readFileSync(path.join(dataDir, 'rooms.json')), before);
  writeFileSync(path.join(dataDir, 'accounts.json'), 'secret-password-not-json');
  await assert.rejects(createBackupOffThread(dataDir, { mode: 'json' }), error => error.code === 'BACKUP_WORKER_FAILED' && !String(error).includes('secret-password'));
  const file = path.join(root, 'file'); writeFileSync(file, 'not a directory');
  await assert.rejects(listBackupsOffThread(file));
  assert.deepEqual(await listBackupsOffThread(path.join(root, 'missing')), []);
  await assert.rejects(listBackupsOffThread(root, { timeoutMs: 1 }), { code: 'BACKUP_WORKER_TIMEOUT' });
  await assert.rejects(listBackupsOffThread(root, { timeoutMs: 0 }), /timeout/);
});
