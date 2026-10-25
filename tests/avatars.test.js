import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prepareAvatar } from "../server/avatars.js";
import { AccountStore } from "../server/accounts.js";
import { seedAccounts, testPassword } from "./auth-helpers.js";
async function picture() {
  return (
    "data:image/png;base64," +
    (
      await sharp({
        create: { width: 480, height: 320, channels: 3, background: "#478aa1" },
      })
        .png()
        .toBuffer()
    ).toString("base64")
  );
}
test("upload is sanitized to a square JPEG and malformed/active content is rejected", async () => {
  const image = await prepareAvatar(await picture());
  const meta = await sharp(image).metadata();
  assert.equal(meta.width, 256);
  assert.equal(meta.height, 256);
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.exif, undefined);
  assert.equal(await prepareAvatar(undefined), undefined);
  assert.equal(await prepareAvatar(null), null);
  for (const value of [
    "https://evil.example/photo.jpg",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/jpeg;base64,PHN2Zz4=",
    "data:image/png;base64,xxxx",
    "data:image/jpeg;base64," + "a".repeat(200000),
  ])
    await assert.rejects(prepareAvatar(value));
});
test("registration and own-profile avatar changes persist, keep sessions and leave other accounts intact", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "holdem-avatars-"));
  t.after(() => {
    assert.equal(path.dirname(dir), path.resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  });
  const { store, invite, admin } = await seedAccounts(dir);
  const user = await store.register({
    username: "avatar_user",
    nickname: "Avatar",
    password: testPassword,
    inviteCode: invite.code,
    avatar: await picture(),
  });
  assert.match(user.user.avatar, /^\/avatars\/[a-f0-9]{64}\.jpg$/);
  const file = path.join(dir, user.user.avatar);
  assert.ok(existsSync(file));
  assert.equal((await sharp(readFileSync(file)).metadata()).width, 256);
  const restored = new AccountStore(dir);
  assert.equal(restored.findSession(user.token).user.avatar, user.user.avatar);
  assert.equal(restored.getUser(admin.id).avatar, null);
  const result = await restored.updateSelf(user.token, { avatar: null });
  assert.equal(result.revoked, false);
  assert.equal(result.user.avatar, null);
  assert.ok(restored.findSession(user.token));
  const saved = await restored.updateSelf(user.token, {
    avatar: await picture(),
  });
  assert.equal(saved.user.avatar, user.user.avatar);
  await assert.rejects(
    restored.updateSelf(user.token, { avatar: "../accounts.json" }),
  );
  assert.equal(restored.getUser(admin.id).avatar, null);
});
