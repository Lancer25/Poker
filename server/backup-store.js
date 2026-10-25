import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, unlinkSync, rmdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { createRoomStore, validateRoomData } from './room-store.js';

const require = createRequire(import.meta.url);
const WORKER_TIMEOUT_MS = 120000;

function runBackupWorker(request, timeoutMs = WORKER_TIMEOUT_MS) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > WORKER_TIMEOUT_MS) return Promise.reject(Error('Invalid backup worker timeout'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./backup-worker.js', import.meta.url), {
      workerData: request, execArgv: [], stdout: true, stderr: true,
    });
    worker.stdout.resume(); worker.stderr.resume();
    let response;
    let failure;
    const timer = setTimeout(() => {
      failure = Object.assign(Error('Backup worker timed out'), { code: 'BACKUP_WORKER_TIMEOUT' });
      void worker.terminate().catch(() => {});
    }, timeoutMs);
    worker.once('message', message => { response = message; });
    worker.once('error', () => {
      failure = Object.assign(Error('Backup worker failed'), { code: 'BACKUP_WORKER_FAILED' });
    });
    // Settle only after exit, so callers can close/reopen files on Windows safely.
    worker.once('exit', code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || !response?.ok) reject(Object.assign(Error('Backup worker operation failed'), { code: response?.code || 'BACKUP_WORKER_FAILED' }));
      else resolve(response.result);
    });
  });
}

export function createBackupOffThread(dataDir, {
  mode = process.env.ROOM_STORAGE || 'json', root = path.join(dataDir, 'backups'), keep,
  timeoutMs = WORKER_TIMEOUT_MS,
} = {}) {
  return runBackupWorker({ operation: 'create', dataDir, mode, root, keep }, timeoutMs);
}

export function listBackupsOffThread(root, { timeoutMs = WORKER_TIMEOUT_MS } = {}) {
  return runBackupWorker({ operation: 'list', root }, timeoutMs);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const allowed = name => ['rooms.json', 'rooms.sqlite', 'accounts.json'].includes(name) || /^avatars\/[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(name);
function directory(folder) {
  const stat = lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Expected a real directory');
}
function filesIn(folder, prefix = '') {
  directory(folder);
  const result = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const name = prefix + entry.name;
    const file = path.join(folder, entry.name);
    if (lstatSync(file).isSymbolicLink()) throw Error('Symbolic links are not allowed');
    if (entry.isDirectory() && name === 'avatars') result.push(...filesIn(file, 'avatars/'));
    else if (entry.isFile() && (allowed(name) || name === 'manifest.json')) result.push(name);
    else throw Error('Unexpected backup path');
  }
  return result;
}
function safeBytes(root, name) {
  if (!allowed(name)) throw Error('Invalid manifest path');
  if (name.startsWith('avatars/')) directory(path.join(root, 'avatars'));
  const file = path.join(root, ...name.split('/'));
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Expected a regular backup file');
  return readFileSync(file);
}
function removeVerified(folder) {
  verifyBackup(folder);
  for (const name of filesIn(folder)) unlinkSync(path.join(folder, ...name.split('/')));
  if (existsSync(path.join(folder, 'avatars'))) rmdirSync(path.join(folder, 'avatars'));
  rmdirSync(folder);
}

export function verifyBackup(folder) {
  const inventory = filesIn(folder);
  const manifest = JSON.parse(readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !['json', 'sqlite'].includes(manifest.mode) || !Array.isArray(manifest.files)) throw Error('Invalid backup manifest');
  const names = new Set();
  for (const entry of manifest.files) {
    if (!entry || !allowed(entry.path) || names.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw Error('Invalid manifest entry');
    names.add(entry.path);
    const bytes = safeBytes(folder, entry.path);
    if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw Error('Backup integrity mismatch');
  }
  const roomFile = manifest.mode === 'sqlite' ? 'rooms.sqlite' : 'rooms.json';
  if (!names.has(roomFile) || names.has(manifest.mode === 'sqlite' ? 'rooms.json' : 'rooms.sqlite') || inventory.length !== names.size + 1 || inventory.some(n => n !== 'manifest.json' && !names.has(n))) throw Error('Backup inventory mismatch');
  if (names.has('accounts.json')) JSON.parse(safeBytes(folder, 'accounts.json'));
  if (manifest.mode === 'json') validateRoomData(JSON.parse(safeBytes(folder, roomFile)));
  else {
    const header = safeBytes(folder, roomFile);
    if (header.subarray(0, 16).toString() !== 'SQLite format 3\0' || header[18] !== 1 || header[19] !== 1) throw Error('Expected standalone SQLite snapshot');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(folder, roomFile), { readOnly: true });
    try {
      if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Invalid SQLite snapshot');
      for (const table of ['rooms', 'hands', 'archives', 'archive_hands', 'sessions']) {
        for (const row of db.prepare(`SELECT body FROM ${table}`).iterate()) JSON.parse(row.body);
      }
    } finally { db.close(); }
  }
  return { ...manifest, valid: true };
}

export function listBackups(root) {
  if (!existsSync(root)) return [];
  directory(root);
  return readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && /^backup-[0-9T_Z-]+-[a-f0-9-]+$/.test(e.name)).map(e => {
    const folder = path.join(root, e.name);
    try { const manifest = verifyBackup(folder); return { path: folder, createdAt: manifest.createdAt, mode: manifest.mode, valid: true }; }
    catch { return { path: folder, valid: false }; }
  }).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export function restoreBackup(folder, newEmptyDestination) {
  const manifest = verifyBackup(folder);
  const destination = path.resolve(newEmptyDestination);
  if (existsSync(destination)) throw Error('Restore destination must be a NEW directory');
  // mkdir without recursive also refuses concurrent creation and missing parents.
  mkdirSync(destination, { mode: 0o700 });
  for (const entry of manifest.files) {
    if (entry.path.startsWith('avatars/') && !existsSync(path.join(destination, 'avatars'))) mkdirSync(path.join(destination, 'avatars'), { mode: 0o700 });
    const bytes = safeBytes(folder, entry.path);
    if (hash(bytes) !== entry.sha256) throw Error('Backup changed during restore');
    writeFileSync(path.join(destination, ...entry.path.split('/')), bytes, { flag: 'wx', mode: 0o600 });
  }
  const store = createRoomStore(destination, { mode: manifest.mode });
  try { validateRoomData(store.load()); } finally { store.close(); }
  return { path: destination, mode: manifest.mode, files: manifest.files.length };
}

export async function createBackup(store, dataDir, { root = path.join(dataDir, 'backups'), keep } = {}) {
  if (keep !== undefined && (!Number.isSafeInteger(keep) || keep < 1)) throw Error('keep must be a positive integer');
  mkdirSync(root, { recursive: true, mode: 0o700 }); directory(root);
  const folder = path.join(realpathSync(root), `backup-${new Date().toISOString().replace(/[:.]/g, '_')}-${randomUUID()}`);
  mkdirSync(folder, { mode: 0o700 });
  const snapshot = await store.snapshot(folder);
  // Accounts are read AFTER the room snapshot so newly referenced IDs are included.
  if (existsSync(path.join(dataDir, 'accounts.json'))) {
    const bytes = safeBytes(dataDir, 'accounts.json'); JSON.parse(bytes);
    writeFileSync(path.join(folder, 'accounts.json'), bytes, { flag: 'wx', mode: 0o600 });
  }
  if (existsSync(path.join(dataDir, 'avatars'))) {
    mkdirSync(path.join(folder, 'avatars'), { mode: 0o700 });
    for (const name of filesIn(path.join(dataDir, 'avatars'), 'avatars/')) {
      if (!allowed(name)) throw Error('Unexpected avatar path');
      writeFileSync(path.join(folder, ...name.split('/')), safeBytes(dataDir, name), { flag: 'wx', mode: 0o600 });
    }
  }
  const manifest = { version: 1, createdAt: new Date().toISOString(), mode: snapshot.mode,
    files: filesIn(folder).map(name => { const bytes = safeBytes(folder, name); return { path: name, bytes: bytes.length, sha256: hash(bytes) }; }) };
  writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  verifyBackup(folder);
  // Exercise the actual restore/load path before calling this a completed backup.
  const drill = path.join(realpathSync(root), `.restore-check-${randomUUID()}`);
  restoreBackup(folder, drill);
  for (const name of filesIn(drill)) unlinkSync(path.join(drill, ...name.split('/')));
  if (existsSync(path.join(drill, 'avatars'))) rmdirSync(path.join(drill, 'avatars'));
  rmdirSync(drill);
  if (keep !== undefined) for (const old of listBackups(root).filter(b => b.valid).slice(keep)) removeVerified(old.path);
  return { path: folder, ...manifest };
}

export function createBackupScheduler(store, dataDir, {
  root = path.join(dataDir, 'backups'), keep = 7, intervalMs = 6 * 60 * 60 * 1000,
} = {}) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 2147483647) throw Error('Invalid backup interval');
  if (!Number.isSafeInteger(keep) || keep < 1) throw Error('keep must be a positive integer');
  let stopped = false;
  let current = null;
  let completed = 0;
  let failed = 0;
  let lastSuccessAt = null;
  let lastFailureAt = null;
  function run() {
    if (stopped) return Promise.reject(Error('Backup scheduler is stopped'));
    if (current) return current;
    current = Promise.resolve().then(() => createBackup(store, dataDir, { root, keep })).then(result => {
      completed++; lastSuccessAt = new Date().toISOString(); return result;
    }, error => {
      failed++; lastFailureAt = new Date().toISOString(); throw error;
    }).finally(() => { current = null; });
    return current;
  }
  // Timer failures are observable through stats; manual callers receive rejection.
  const timer = setInterval(() => { void run().catch(() => {}); }, intervalMs);
  timer.unref?.();
  return {
    run,
    async stop() { stopped = true; clearInterval(timer); if (current) await current; },
    stats() { return { stopped, running: current !== null, intervalMs, keep, completed, failed, lastSuccessAt, lastFailureAt }; },
  };
}
