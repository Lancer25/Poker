import {
  readFileSync,
  writeFileSync,
  renameSync,
  statSync,
  chownSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  constants,
} from "node:fs";
import path from "node:path";
import { AccountStore } from "./accounts.js";
import { recoverUnclaimedHost } from "./room-ownership.js";

const directory = process.env.DATA_DIR;
if (!directory)
  throw Error(
    "DATA_DIR is required; stop the game service before applying repairs",
  );
const accounts = new AccountStore(directory);
const admins = accounts.state.users.filter(
  (u) => u.role === "admin" && !u.disabled,
);
if (admins.length !== 1)
  throw Error(
    "Automatic repair requires one active administrator; use the dashboard instead",
  );
const user = accounts.getUser(admins[0].id);
const file = path.join(directory, "rooms.json");
const original = JSON.parse(readFileSync(file, "utf8"));
const next = structuredClone(original);
const repaired = [];
for (const room of next.rooms) {
  const host = room.players.find((p) => p.id === room.host);
  if (!host || host.accountId || !["waiting", "showdown"].includes(room.phase))
    continue;
  if (room.players.some((p) => p.accountId && p.accountId !== user.id))
    continue;
  if (
    !room.players.some((p) => p.accountId === user.id) &&
    !room.requests.length
  )
    continue;
  recoverUnclaimedHost(room, user);
  repaired.push(room.id);
}
const balances = (data) =>
  JSON.stringify({
    ...data,
    rooms: data.rooms.map(({ host, players, ...room }) => ({
      ...room,
      players: players.map(({ name, accountId, ...player }) => player),
    })),
  });
if (balances(original) !== balances(next))
  throw Error("Repair must preserve cards, chips, requests and history");
const [backupDirectory, apply] = process.argv.slice(2);
if (apply === "--apply" && repaired.length) {
  if (!backupDirectory || !path.isAbsolute(backupDirectory))
    throw Error("An absolute private backup path is required");
  mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  for (const name of ["rooms.json", "accounts.json"]) {
    const destination = path.join(backupDirectory, name);
    copyFileSync(
      path.join(directory, name),
      destination,
      constants.COPYFILE_EXCL,
    );
    chmodSync(destination, 0o600);
  }
  const owner = statSync(file);
  writeFileSync(file + ".tmp", JSON.stringify(next), { mode: 0o600 });
  if (process.getuid?.() === 0) chownSync(file + ".tmp", owner.uid, owner.gid);
  renameSync(file + ".tmp", file);
  for (const id of repaired)
    accounts.record(user.id, "recover_host", user.id, {
      room: id,
      reason: "legacy_host_repair",
    });
}
console.log(
  JSON.stringify({
    mode: apply === "--apply" ? "apply" : "preview",
    repairedRooms: repaired,
    chipsAndHistoryPreserved: true,
  }),
);
