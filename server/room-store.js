import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, statSync, chmodSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const own = (value, key) => Object.hasOwn(value, key);
const encode = value => JSON.stringify(value);

export function validateRoomData(value) {
  if (!value || !Array.isArray(value.rooms) || !Array.isArray(value.sessions)) throw Error('Invalid room dataset');
  const ids = new Set();
  for (const room of value.rooms) {
    if (!room || typeof room.id !== 'string' || !room.id || ids.has(room.id)) throw Error('Invalid or duplicate room ID');
    ids.add(room.id);
    for (const key of ['history', 'completedRounds']) {
      if (own(room, key) && !Array.isArray(room[key])) throw Error(`Invalid room ${key}`);
    }
    for (const round of room.completedRounds || []) {
      if (!round || typeof round !== 'object' || (own(round, 'history') && !Array.isArray(round.history))) throw Error('Invalid archived round');
    }
  }
  const keys = new Set();
  for (const entry of value.sessions) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || keys.has(entry[0])) throw Error('Invalid or duplicate session');
    keys.add(entry[0]);
  }
  return value;
}

function metadata(value, fields) {
  const result = { ...value };
  for (const field of fields) if (own(result, field)) result[field] = null;
  return encode(result);
}

export function createRoomStore(dataDir, { mode = process.env.ROOM_STORAGE || 'json' } = {}) {
  if (!['json', 'sqlite'].includes(mode)) throw Error('ROOM_STORAGE must be json or sqlite');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, mode === 'json' ? 'rooms.json' : 'rooms.sqlite');
  let closed = false;
  let writes = 0;
  const check = () => { if (closed) throw Error('Room store is closed'); };
  if (mode === 'json') {
    return {
      mode,
      load() { check(); return validateRoomData(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { rooms: [], sessions: [] }); },
      save(value) {
        check(); validateRoomData(value);
        const temporary = `${file}.${randomUUID()}.tmp`;
        writeFileSync(temporary, encode(value), { mode: 0o600, flag: 'wx' });
        renameSync(temporary, file); writes++;
      },
      async snapshot(destinationDir) {
        check(); mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
        // Read once before yielding: later saves cannot alter these bytes.
        const bytes = existsSync(file) ? readFileSync(file) : Buffer.from(encode({ rooms: [], sessions: [] }));
        validateRoomData(JSON.parse(bytes));
        writeFileSync(path.join(destinationDir, 'rooms.json'), bytes, { flag: 'wx', mode: 0o600 });
        return { mode, file: 'rooms.json' };
      },
      stats() { check(); return { mode, bytes: existsSync(file) ? statSync(file).size : 0, writes }; },
      close() { closed = true; },
    };
  }
  // Loading node:sqlite only in opt-in mode keeps JSON compatible with older runtimes.
  const { DatabaseSync, backup } = require('node:sqlite');
  if (!existsSync(file) && existsSync(path.join(dataDir, 'rooms.json'))) throw Error('Legacy rooms.json exists; use explicit offline import into a new directory');
  if (!existsSync(file)) writeFileSync(file, '', { flag: 'wx', mode: 0o600 });
  if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error('Expected a regular SQLite database file');
  chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  try { db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, position INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS hands (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, position INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(room_id,position));
    CREATE TABLE IF NOT EXISTS archives (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, position INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(room_id,position));
    CREATE TABLE IF NOT EXISTS archive_hands (room_id TEXT NOT NULL, archive_position INTEGER NOT NULL, position INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY(room_id,archive_position,position), FOREIGN KEY(room_id,archive_position) REFERENCES archives(room_id,position) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, position INTEGER NOT NULL, body TEXT NOT NULL);`); }
  catch (error) { db.close(); throw error; }
  let cache = new Map();
  const prepared = new Map();
  const sql = source => {
    if (!prepared.has(source)) prepared.set(source, db.prepare(source));
    return prepared.get(source);
  };
  const remember = room => ({ history: room.history, length: room.history?.length || 0,
    revision: room.historyRevision, round: room.roundNumber,
    archives: (room.completedRounds || []).map(round => ({ history: round.history, length: round.history?.length || 0 })) });
  const syncHands = (table, roomId, archivePosition, hands, previous, force) => {
    const prefix = table === 'hands' ? [roomId] : [roomId, archivePosition];
    const columns = table === 'hands' ? 'room_id' : 'room_id,archive_position';
    const where = table === 'hands' ? 'room_id=?' : 'room_id=? AND archive_position=?';
    const same = previous && previous.history === hands;
    const start = !same || force ? 0 : Math.max(0, previous.length - 1);
    for (let i = start; i < (hands?.length || 0); i++) {
      sql(`INSERT INTO ${table} (${columns},position,body) VALUES (${prefix.map(() => '?').join(',')},?,?) ON CONFLICT DO UPDATE SET body=excluded.body WHERE body<>excluded.body`).run(...prefix, i, encode(hands[i]));
    }
    sql(`DELETE FROM ${table} WHERE ${where} AND position>=?`).run(...prefix, hands?.length || 0);
  };
  return {
    mode,
    load() {
      check();
      const rooms = sql('SELECT id,body FROM rooms ORDER BY position').all().map(row => {
        const room = JSON.parse(row.body);
        if (own(room, 'history')) room.history = sql('SELECT body FROM hands WHERE room_id=? ORDER BY position').all(row.id).map(h => JSON.parse(h.body));
        if (own(room, 'completedRounds')) room.completedRounds = sql('SELECT position,body FROM archives WHERE room_id=? ORDER BY position').all(row.id).map(a => {
          const round = JSON.parse(a.body);
          if (own(round, 'history')) round.history = sql('SELECT body FROM archive_hands WHERE room_id=? AND archive_position=? ORDER BY position').all(row.id, a.position).map(h => JSON.parse(h.body));
          return round;
        });
        return room;
      });
      const result = validateRoomData({ rooms, sessions: sql('SELECT id,body FROM sessions ORDER BY position').all().map(s => [s.id, JSON.parse(s.body)]) });
      cache = new Map(rooms.map(room => [room.id, remember(room)]));
      return result;
    },
    save(value, changedRooms) {
      check(); validateRoomData(value);
      const selected = changedRooms == null ? null : new Set([...changedRooms].map(r => typeof r === 'string' ? r : r.id));
      const nextCache = new Map(cache);
      db.exec('BEGIN IMMEDIATE');
      try {
        const ids = new Set(value.rooms.map(r => r.id));
        for (const row of sql('SELECT id FROM rooms').all()) if (!ids.has(row.id)) {
          sql('DELETE FROM rooms WHERE id=?').run(row.id); nextCache.delete(row.id);
        }
        value.rooms.forEach((room, position) => {
          const previous = cache.get(room.id);
          if (selected && !selected.has(room.id) && previous) {
            sql('UPDATE rooms SET position=? WHERE id=? AND position<>?').run(position, room.id, position); return;
          }
          sql('INSERT INTO rooms VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,body=excluded.body WHERE position<>excluded.position OR body<>excluded.body').run(room.id, position, metadata(room, ['history', 'completedRounds']));
          syncHands('hands', room.id, null, room.history, previous, selected === null || (previous && room.roundNumber !== previous.round));
          (room.completedRounds || []).forEach((round, index) => {
            sql('INSERT INTO archives VALUES (?,?,?) ON CONFLICT DO UPDATE SET body=excluded.body WHERE body<>excluded.body').run(room.id, index, metadata(round, ['history']));
            const old = previous?.archives[index];
            if (selected === null || !old || old.history !== round.history || old.length !== round.history?.length ||
                (room.historyRevision !== previous.revision && round.number === (room.roundNumber || 1))) {
              syncHands('archive_hands', room.id, index, round.history, old, selected === null);
            }
          });
          sql('DELETE FROM archives WHERE room_id=? AND position>=?').run(room.id, room.completedRounds?.length || 0);
          nextCache.set(room.id, remember(room));
        });
        const sessionIds = new Set(value.sessions.map(s => s[0]));
        for (const row of sql('SELECT id FROM sessions').all()) if (!sessionIds.has(row.id)) sql('DELETE FROM sessions WHERE id=?').run(row.id);
        value.sessions.forEach(([id, session], position) => sql('INSERT INTO sessions VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET position=excluded.position,body=excluded.body WHERE position<>excluded.position OR body<>excluded.body').run(id, position, encode(session)));
        db.exec('COMMIT'); cache = nextCache; writes++;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async snapshot(destinationDir) {
      check(); mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
      const destination = path.join(destinationDir, 'rooms.sqlite');
      // Reserve the name before async backup; never overwrite an existing file.
      writeFileSync(destination, '', { flag: 'wx', mode: 0o600 });
      await backup(db, destination);
      // The online backup is complete; make the standalone copy sidecar-free.
      const snapshot = new DatabaseSync(destination);
      try { snapshot.exec('PRAGMA journal_mode=DELETE'); } finally { snapshot.close(); }
      return { mode, file: 'rooms.sqlite' };
    },
    stats() {
      check();
      return { mode, bytes: statSync(file).size, walBytes: existsSync(file + '-wal') ? statSync(file + '-wal').size : 0,
        rooms: Number(sql('SELECT count(*) AS n FROM rooms').get().n), hands: Number(sql('SELECT count(*) AS n FROM hands').get().n),
        archives: Number(sql('SELECT count(*) AS n FROM archives').get().n), writes, changes: Number(sql('SELECT total_changes() AS n').get().n) };
    },
    close() { if (!closed) { db.close(); closed = true; } },
  };
}
