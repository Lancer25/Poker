import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createRoomStore, validateRoomData } from './room-store.js';
import { createBackup, listBackups, verifyBackup, restoreBackup } from './backup-store.js';

function copyIdentity(source, destination) {
  const accounts = path.join(source, 'accounts.json');
  if (existsSync(accounts)) {
    if (!lstatSync(accounts).isFile() || lstatSync(accounts).isSymbolicLink()) throw Error('Invalid accounts file');
    const bytes = readFileSync(accounts); JSON.parse(bytes);
    writeFileSync(path.join(destination, 'accounts.json'), bytes, { flag: 'wx', mode: 0o600 });
  }
  const avatars = path.join(source, 'avatars');
  if (!existsSync(avatars)) return;
  if (!lstatSync(avatars).isDirectory() || lstatSync(avatars).isSymbolicLink()) throw Error('Invalid avatars directory');
  mkdirSync(path.join(destination, 'avatars'), { mode: 0o700 });
  for (const name of readdirSync(avatars)) {
    const file = path.join(avatars, name);
    if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp)$/.test(name) || !lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw Error('Invalid avatar file');
    writeFileSync(path.join(destination, 'avatars', name), readFileSync(file), { flag: 'wx', mode: 0o600 });
  }
}

export function convertStorage(source, destination, { from, to, offline = false } = {}) {
  if (!offline) throw Error('Stop the server and explicitly confirm offline operation');
  if (!['json', 'sqlite'].includes(from) || !['json', 'sqlite'].includes(to) || from === to) throw Error('Invalid conversion modes');
  const sourceFile = path.join(source, from === 'json' ? 'rooms.json' : 'rooms.sqlite');
  if (!existsSync(sourceFile) || !lstatSync(sourceFile).isFile() || lstatSync(sourceFile).isSymbolicLink()) throw Error('Missing or invalid source room file');
  if (existsSync(destination)) throw Error('Conversion destination must be a NEW directory');
  let input;
  if (from === 'json') input = validateRoomData(JSON.parse(readFileSync(sourceFile, 'utf8')));
  else {
    const store = createRoomStore(source, { mode: from });
    try { input = store.load(); } finally { store.close(); }
  }
  mkdirSync(destination, { mode: 0o700 });
  const output = createRoomStore(destination, { mode: to });
  try {
    output.save(input);
    if (!isDeepStrictEqual(output.load(), input)) throw Error('Storage roundtrip mismatch');
  } finally { output.close(); }
  const reopened = createRoomStore(destination, { mode: to });
  try { if (!isDeepStrictEqual(reopened.load(), input)) throw Error('Reopened storage roundtrip mismatch'); }
  finally { reopened.close(); }
  copyIdentity(source, destination);
  return { mode: to, rooms: input.rooms.length, sessions: input.sessions.length, verified: true };
}

async function main(args) {
  const [command, ...rest] = args;
  const offline = rest.includes('--offline');
  const positional = rest.filter(arg => arg !== '--offline');
  const [source, destination] = positional;
  if (command === 'import-json' || command === 'export-json') {
    if (positional.length !== 2) throw Error('Expected source and new destination directories');
    return convertStorage(source, destination, { from: command === 'import-json' ? 'json' : 'sqlite', to: command === 'import-json' ? 'sqlite' : 'json', offline });
  }
  if (command === 'verify' && positional.length === 1) { const result = verifyBackup(source); return { valid: result.valid, mode: result.mode, files: result.files.length }; }
  if (command === 'list' && positional.length === 1) return listBackups(source);
  if (command === 'restore' && positional.length === 2) return restoreBackup(source, destination);
  if (command === 'backup' && positional.length === 2 && offline) {
    const store = createRoomStore(source, { mode: existsSync(path.join(source, 'rooms.sqlite')) ? 'sqlite' : 'json' });
    try { const result = await createBackup(store, source, { root: destination }); return { path: result.path, mode: result.mode }; }
    finally { store.close(); }
  }
  throw Error('Usage: storage-tools.js import-json|export-json SOURCE NEW_DEST --offline; backup DATA ROOT --offline; list ROOT; verify BACKUP; restore BACKUP NEW_DEST');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + '\n')).catch(() => {
    // Parse errors can contain account/session content; never print arbitrary exceptions.
    process.stderr.write('Storage operation failed. Check arguments, offline mode, paths and integrity. Existing data was not replaced.\n');
    process.exitCode = 1;
  });
}
