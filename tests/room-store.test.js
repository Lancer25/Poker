import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, chmodSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRoomStore as openRoomStore } from '../server/room-store.js';
import { convertStorage } from '../server/storage-tools.js';

const stores = new Map();
function createRoomStore(dir, options) {
  const store = openRoomStore(dir, options); stores.set(store, dir); return store;
}
function sandbox(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'room-store-'));
  t.after(() => {
    for (const [store, location] of stores) if (location === dir || location.startsWith(dir + path.sep)) { store.close(); stores.delete(store); }
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}
function fixture() {
  return { rooms: [{ id: 'legacy', name: 'Table', players: [{ id: 'u', cards: ['As', 'Kd'], stack: 100 }],
    roundNumber: 2, hand: 2, historyRevision: 0, deck: ['Qs'],
    history: [{ hand: 1, oddLegacyField: { a: null } }, { hand: 2, winners: ['u'] }],
    completedRounds: [{ number: 1, history: [{ hand: 99, shownPlayers: [] }], extra: true }, { number: 2, history: [{ hand: 1, oddLegacyField: { a: null } }, { hand: 2, winners: ['u'] }] }],
    opaque: { nested: ['unchanged', null] } }, { id: 'minimal' }], sessions: [['token', { room: 'legacy', player: 'u' }], ['other', 'legacy']] };
}

for (const mode of ['json', 'sqlite']) {
  test(`${mode}: legacy exactness, mutable hands, archives, sessions and reopen`, t => {
    const dir = sandbox(t);
    let store = createRoomStore(dir, { mode });
    t.after(() => store.close());
    const data = fixture();
    store.save(data); assert.deepEqual(store.load(), data);
    data.rooms[0].history.push({ hand: 3, events: [{ type: 'public' }] });
    store.save(data, [data.rooms[0]]);
    data.rooms[0].history.at(-1).shownPlayers = [{ id: 'u', cards: ['As', 'Kd'] }];
    data.rooms[0].completedRounds[1].history.at(-1).shownPlayers = [{ id: 'u', cards: ['As', 'Kd'] }];
    data.rooms[0].historyRevision++;
    store.save(data, ['legacy']);
    assert.deepEqual(store.load(), data);
    data.rooms[0].completedRounds[0].history = [{ hand: 99, edited: true }];
    data.rooms[0].roundNumber = 3; data.rooms[0].history = [];
    data.sessions = [['new', { player: 'u' }]];
    store.save(data); store.close(); store = createRoomStore(dir, { mode });
    assert.deepEqual(store.load(), data);
    data.rooms.reverse(); store.save(data); assert.deepEqual(store.load(), data);
    data.rooms = []; data.sessions = []; store.save(data); assert.deepEqual(store.load(), data);
  });
}

test('SQLite ordinary room save does not serialize old history and bounds SQL writes', t => {
  const store = createRoomStore(sandbox(t), { mode: 'sqlite' }); t.after(() => store.close());
  const data = fixture();
  data.rooms[0].history = Array.from({ length: 1000 }, (_, hand) => ({ hand }));
  data.rooms[0].completedRounds[0].history = Array.from({ length: 1000 }, (_, hand) => ({ hand }));
  store.save(data);
  data.rooms[0].history[0].toJSON = () => { throw Error('Old hand serialized'); };
  data.rooms[0].completedRounds[0].history[0].toJSON = () => { throw Error('Archive serialized'); };
  data.rooms[1].toJSON = () => { throw Error('Unchanged room serialized'); };
  const before = store.stats().changes;
  data.rooms[0].hand++;
  store.save(data, ['legacy']);
  assert.ok(store.stats().changes - before <= 2);
});

test('SQLite failed transaction rolls back rooms, history, sessions and cache', t => {
  const dir = sandbox(t); const store = createRoomStore(dir, { mode: 'sqlite' }); t.after(() => store.close());
  const data = fixture(); store.save(data); const expected = structuredClone(data);
  data.rooms[0].hand = 77; data.rooms[0].history.push({ hand: 77 });
  data.sessions.push(['broken', 1n]);
  assert.throws(() => store.save(data));
  const observer = createRoomStore(dir, { mode: 'sqlite' });
  assert.deepEqual(observer.load(), expected); observer.close();
  data.sessions.pop(); store.save(data); assert.deepEqual(store.load(), data);
  const inspect = new DatabaseSync(path.join(dir, 'rooms.sqlite'), { readOnly: true });
  assert.equal(inspect.prepare('PRAGMA journal_mode').get().journal_mode, 'wal'); inspect.close();
});

test('explicit offline conversion preserves legacy bytes, identity files and roundtrip equality', t => {
  const root = sandbox(t); const source = path.join(root, 'legacy'); mkdirSync(source);
  const bytes = JSON.stringify(fixture(), null, 3); writeFileSync(path.join(source, 'rooms.json'), bytes);
  writeFileSync(path.join(source, 'accounts.json'), '{"users":[]}'); mkdirSync(path.join(source, 'avatars')); writeFileSync(path.join(source, 'avatars', 'abc.jpg'), 'avatar');
  assert.throws(() => createRoomStore(source, { mode: 'sqlite' }), /offline import/);
  const sqlite = path.join(root, 'sqlite'); const exported = path.join(root, 'exported');
  assert.throws(() => convertStorage(source, sqlite, { from: 'json', to: 'sqlite' }), /offline/);
  assert.equal(convertStorage(source, sqlite, { from: 'json', to: 'sqlite', offline: true }).verified, true);
  convertStorage(sqlite, exported, { from: 'sqlite', to: 'json', offline: true });
  assert.deepEqual(JSON.parse(readFileSync(path.join(exported, 'rooms.json'))), fixture());
  assert.equal(readFileSync(path.join(source, 'rooms.json'), 'utf8'), bytes);
  assert.equal(readFileSync(path.join(exported, 'avatars', 'abc.jpg'), 'utf8'), 'avatar');
  assert.throws(() => convertStorage(source, sqlite, { from: 'json', to: 'sqlite', offline: true }), /NEW/);
});

test('invalid dataset cannot replace existing JSON', t => {
  const store = createRoomStore(sandbox(t), { mode: 'json' }); t.after(() => store.close());
  const data = fixture(); store.save(data);
  assert.throws(() => store.save({ rooms: [{ id: 'dup' }, { id: 'dup' }], sessions: [] }));
  assert.deepEqual(store.load(), data);
});

test('SQLite round replacement with an identical array rewrites history and persists archive metadata', t => {
  const store = createRoomStore(sandbox(t), { mode: 'sqlite' }); t.after(() => store.close());
  const data = fixture(); store.save(data);
  const room = data.rooms[0]; room.roundNumber++;
  room.history[0].oddLegacyField = { revised: true };
  room.completedRounds[0].extra = 'updated'; store.save(data);
  assert.deepEqual(store.load(), data);
  store.close(); assert.throws(() => store.load(), /closed/); assert.throws(() => store.save(data), /closed/);
});

test('SQLite global saves preserve arbitrary older-hand mutations and all sessions', t => {
  const store = createRoomStore(sandbox(t), { mode: 'sqlite' }); t.after(() => store.close());
  const data = fixture(); store.save(data);
  data.rooms[0].history[0].oldFieldRevised = true;
  data.rooms[0].completedRounds[0].history[0].shownPlayers.push({ id: 'u', cards: ['As', 'Kd'] });
  data.rooms[1].phase = 'waiting'; data.sessions[0][1].changed = true;
  store.save(data);
  assert.deepEqual(store.load(), data);
  data.sessions.push(['session-only', 'minimal']); store.save(data, []);
  assert.deepEqual(store.load(), data);
});

test('SQLite database is private on creation and reopening in an existing data directory', t => {
  const root = sandbox(t); const dataDir = path.join(root, 'permissive'); mkdirSync(dataDir, { mode: 0o755 });
  const file = path.join(dataDir, 'rooms.sqlite');
  let store = createRoomStore(dataDir, { mode: 'sqlite' }); store.save(fixture()); store.close();
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  chmodSync(file, 0o644);
  store = createRoomStore(dataDir, { mode: 'sqlite' });
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(store.load(), fixture()); store.close();
  if (process.platform === 'win32') t.diagnostic('Windows does not expose POSIX 0600 semantics; creation/reopen exercised, ACL enforcement requires host configuration');
});

test('CLI requires offline assertion and reports only safe conversion metadata', t => {
  const root = sandbox(t); const source = path.join(root, 'source'); mkdirSync(source);
  writeFileSync(path.join(source, 'rooms.json'), JSON.stringify(fixture()));
  const destination = path.join(root, 'converted');
  const cli = fileURLToPath(new URL('../server/storage-tools.js', import.meta.url));
  const invoke = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const denied = invoke(['import-json', source, destination]);
  assert.equal(denied.status, 1); assert.equal(denied.stdout, '');
  const success = invoke(['import-json', source, destination, '--offline']);
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout), { mode: 'sqlite', rooms: 2, sessions: 2, verified: true });
  assert.equal(success.stdout.includes('token'), false);
  const refused = invoke(['import-json', source, destination, '--offline']); assert.equal(refused.status, 1);
  writeFileSync(path.join(source, 'rooms.json'), 'secret-credential-not-json');
  const invalid = invoke(['import-json', source, path.join(root, 'invalid'), '--offline']);
  assert.equal(invalid.status, 1); assert.equal(invalid.stderr.includes('secret-credential'), false);
});
