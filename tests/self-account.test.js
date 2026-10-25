import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedAccounts, testPassword } from "./auth-helpers.js";

async function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "holdem-self-"));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  });
  const { store, invite } = await seedAccounts(dir);
  const first = await store.register({
    username: "self_one",
    nickname: "One",
    password: testPassword,
    inviteCode: invite.code,
  });
  const other = await store.register({
    username: "self_two",
    nickname: "Two",
    password: testPassword,
    inviteCode: invite.code,
  });
  return { store, first, other };
}
test("ordinary user edits own nickname without session loss or role escalation", async (t) => {
  const { store, first, other } = await fixture(t);
  const result = await store.updateSelf(first.token, { nickname: "New Nick" });
  assert.equal(result.revoked, false);
  assert.equal(result.user.id, first.user.id);
  assert.equal(result.user.role, "user");
  assert.equal(store.findSession(first.token).user.nickname, "New Nick");
  for (const field of ["role", "id", "disabled", "buyin", "userId"])
    await assert.rejects(
      store.updateSelf(first.token, { [field]: other.user.id }),
    );
  assert.equal(store.getUser(other.user.id).nickname, "Two");
});
test("sensitive changes require current password, revoke all old sessions and preserve identity", async (t) => {
  const { store, first } = await fixture(t);
  const secondSession = await store.login({
    username: "self_one",
    password: testPassword,
  });
  await assert.rejects(
    store.updateSelf(first.token, { username: "changed_one" }),
    /当前密码/,
  );
  await assert.rejects(
    store.updateSelf(first.token, {
      newPassword: "NewFriends123!",
      currentPassword: "wrong",
    }),
    /当前密码/,
  );
  const result = await store.updateSelf(first.token, {
    nickname: "Changed",
    username: "changed_one",
    currentPassword: testPassword,
    newPassword: "NewFriends123!",
  });
  assert.equal(result.user.id, first.user.id);
  assert.equal(result.revoked, true);
  assert.equal(store.findSession(first.token), null);
  assert.equal(store.findSession(secondSession.token), null);
  await assert.rejects(
    store.login({ username: "self_one", password: testPassword }),
  );
  await assert.rejects(
    store.login({ username: "changed_one", password: testPassword }),
  );
  assert.equal(
    (await store.login({ username: "changed_one", password: "NewFriends123!" }))
      .user.id,
    first.user.id,
  );
  assert.ok(!JSON.stringify(store.state).includes("NewFriends123!"));
  assert.ok(!JSON.stringify(store.state.audit).includes(testPassword));
});
test("duplicate usernames and invalid fields leave profile and sessions unchanged", async (t) => {
  const { store, first } = await fixture(t);
  const before = JSON.stringify(store.state);
  await assert.rejects(
    store.updateSelf(first.token, {
      username: "self_two",
      currentPassword: testPassword,
    }),
    /已存在/,
  );
  await assert.rejects(store.updateSelf(first.token, { nickname: "" }));
  await assert.rejects(
    store.updateSelf(first.token, {
      newPassword: "short",
      currentPassword: testPassword,
    }),
  );
  assert.equal(JSON.stringify(store.state), before);
});
