import { parentPort, workerData } from 'node:worker_threads';
import { createRoomStore } from './room-store.js';
import { createBackup, listBackups } from './backup-store.js';

async function execute() {
  if (workerData.operation === 'list') return listBackups(workerData.root);
  if (workerData.operation !== 'create') throw Error('Unknown backup operation');
  const { dataDir, mode, root, keep } = workerData;
  const store = createRoomStore(dataDir, { mode });
  try { return await createBackup(store, dataDir, { root, keep }); }
  finally { store.close(); }
}

if (parentPort) {
  try { parentPort.postMessage({ ok: true, result: await execute() }); }
  catch (error) {
    // Parser errors can quote secrets; only stable filesystem codes cross threads.
    const code = typeof error.code === 'string' && /^E[A-Z0-9_]+$/.test(error.code) ? error.code : 'BACKUP_WORKER_FAILED';
    parentPort.postMessage({ ok: false, code });
  } finally { parentPort.close(); }
}
