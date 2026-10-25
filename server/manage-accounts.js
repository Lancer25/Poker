import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AccountStore } from "./accounts.js";

const directory =
  process.env.DATA_DIR || fileURLToPath(new URL("../data", import.meta.url));
const accounts = new AccountStore(directory);
const [operation, output] = process.argv.slice(2);
if (!["bootstrap", "reset-admin"].includes(operation) || !output) {
  console.error(
    "Usage: DATA_DIR=... node server/manage-accounts.js bootstrap|reset-admin /private/path/setup.json",
  );
  process.exit(1);
}
const password = randomBytes(18).toString("base64url");
if (existsSync(output)) throw Error("Credential output file already exists");
const adminUrl = new URL('/admin', process.env.PUBLIC_HTTPS_URL || `http://localhost:${process.env.PORT || 3000}`).href;
let admin;
let invite;
if (operation === "bootstrap") {
  admin = await accounts.bootstrapAdmin({
    username: "admin",
    nickname: "管理员",
    password,
  });
  invite = accounts.createInvite(admin.id, { maxUses: 9, days: 30 });
} else {
  admin = accounts.state.users.find((u) => u.role === "admin" && !u.disabled);
  if (!admin) throw Error("No active administrator");
  await accounts.updateUser(admin.id, admin.id, { password });
}
mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
writeFileSync(
  output,
  JSON.stringify(
    {
      username: admin.username,
      password,
      inviteCode: invite?.code,
      inviteUses: invite?.maxUses,
      adminUrl,
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
);
console.log("Administrator credentials written to the specified private file.");
