import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { AccountStore } from "../server/accounts.js";
import { seedAccounts, testPassword } from "./auth-helpers.js";

async function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "holdem-accounts-"));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, ...(await seedAccounts(directory)) };
}

test("invitation registration hashes passwords and sessions without granting admin privileges", async (t) => {
  const { store, invite, directory } = await fixture(t);
  const input = {
    username: "Alice_01",
    nickname: "Alice",
    password: testPassword,
  };
  await assert.rejects(store.register(input), { status: 403 });
  const account = await store.register({
    ...input,
    inviteCode: invite.code,
    role: "admin",
  });
  assert.equal(account.user.username, "alice_01");
  assert.equal(account.user.role, "user");
  assert.equal(store.findSession(account.token).user.id, account.user.id);
  await assert.rejects(store.register({ ...input, inviteCode: invite.code }), {
    status: 409,
  });
  assert.equal(store.state.invites[0].used, 1);
  const persisted = readFileSync(path.join(directory, "accounts.json"), "utf8");
  assert.ok(!persisted.includes(testPassword));
  assert.ok(!persisted.includes(account.token));
  assert.match(store.state.users[1].passwordHash, /^scrypt\$/);
  assert.equal(
    new AccountStore(directory).findSession(account.token).user.id,
    account.user.id,
  );
});

test("concurrent registrations cannot consume a one-use invite twice", async (t) => {
  const { store, admin } = await fixture(t);
  const invite = store.createInvite(admin.id, { maxUses: 1 });
  const results = await Promise.allSettled(
    ["alice", "bob"].map((username) =>
      store.register({
        username,
        nickname: username,
        password: testPassword,
        inviteCode: invite.code,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(store.state.invites.find((i) => i.id === invite.id).used, 1);
  assert.equal(store.state.users.length, 2);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 403);
});

test("expired and revoked invites reject registration", async (t) => {
  const { store, admin, invite } = await fixture(t);
  store.updateInvite(admin.id, invite.id, false);
  await assert.rejects(
    store.register({
      username: "alice",
      nickname: "Alice",
      password: testPassword,
      inviteCode: invite.code,
    }),
    { status: 403 },
  );
  const expired = store.createInvite(admin.id, { days: 1 });
  store.commit((state) => {
    state.invites.find((i) => i.id === expired.id).expiresAt = Date.now() - 1;
  });
  await assert.rejects(
    store.register({
      username: "alice",
      nickname: "Alice",
      password: testPassword,
      inviteCode: expired.code,
    }),
    { status: 403 },
  );
});

test("admin password and username edits revoke sessions; disabled users cannot login", async (t) => {
  const { store, admin, invite, directory } = await fixture(t);
  const alice = await store.register({
    username: "alice",
    nickname: "Alice",
    password: testPassword,
    inviteCode: invite.code,
  });
  await assert.rejects(
    store.login({ username: "alice", password: "incorrect123" }),
    { status: 401 },
  );
  await assert.rejects(
    store.updateUser(alice.user.id, admin.id, { password: "Hijack123!" }),
    { status: 403 },
  );
  await store.updateUser(admin.id, alice.user.id, { nickname: "New Alice" });
  assert.equal(store.findSession(alice.token).user.nickname, "New Alice");
  const changed = await store.updateUser(admin.id, alice.user.id, {
    username: "alice_new",
    password: "NewFriends123!",
  });
  assert.ok(changed.revoked);
  assert.equal(store.findSession(alice.token), null);
  await assert.rejects(
    store.login({ username: "alice", password: testPassword }),
    { status: 401 },
  );
  const session = await store.login({
    username: "ALICE_NEW",
    password: "NewFriends123!",
  });
  await store.updateUser(admin.id, alice.user.id, { disabled: true });
  assert.equal(store.findSession(session.token), null);
  await assert.rejects(
    store.login({ username: "alice_new", password: "NewFriends123!" }),
    { status: 401 },
  );
  await assert.rejects(
    store.updateUser(admin.id, admin.id, { disabled: true }),
    /管理员/,
  );
  assert.ok(
    !JSON.stringify(store.adminState(admin.id)).includes("passwordHash"),
  );
  assert.ok(
    !readFileSync(path.join(directory, "accounts.json"), "utf8").includes(
      "NewFriends123!",
    ),
  );
});
