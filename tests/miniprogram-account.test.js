import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
test("native self-account form verifies confirmation, handles saves and clears sensitive inputs", async () => {
  let page;
  let revoked = false;
  const requests = [],
    navigation = [],
    storage = new Map([["holdem-account-token", "test-token"]]);
  const wx = {
    getStorageSync: (key) => storage.get(key),
    removeStorageSync: (key) => storage.delete(key),
    showToast() {},
    reLaunch: ({ url }) => navigation.push(url),
    request(options) {
      requests.push(options);
      options.success({
        statusCode: 200,
        data:
          options.method === "GET"
            ? { user: { id: "self", username: "player", nickname: "Player" } }
            : {
                user: {
                  id: "self",
                  username: options.data.username,
                  nickname: options.data.nickname,
                },
                reauthenticate: revoked,
              },
      });
    },
  };
  vm.runInNewContext(
    readFileSync("miniprogram/pages/account/account.js", "utf8"),
    {
      wx,
      require: () => {
        const context = {
          module: { exports: {} },
          wx,
          getApp: () => ({ globalData: { apiUrl: "https://local.example" } }),
        };
        vm.runInNewContext(
          readFileSync("miniprogram/utils/avatar.js", "utf8"),
          context,
        );
        return context.module.exports;
      },
      getApp: () => ({ globalData: { apiUrl: "https://local.example" } }),
      Page: (definition) => {
        page = {
          ...definition,
          data: structuredClone(definition.data),
          setData(patch) {
            Object.assign(this.data, patch);
          },
        };
      },
    },
  );
  await page.onLoad();
  assert.equal(page.data.ready, true);
  page.setData({ nickname: "New Nick" });
  await page.save();
  assert.equal(requests.at(-1).method, "PATCH");
  assert.equal(requests.at(-1).header.Authorization, "Bearer test-token");
  page.setData({ username: "newplayer" });
  await page.save();
  assert.match(page.data.error, /当前密码/);
  page.setData({
    currentPassword: "old-password",
    newPassword: "new-password",
    confirmPassword: "wrong-password",
  });
  await page.save();
  assert.match(page.data.error, /不一致/);
  page.setData({ confirmPassword: "new-password" });
  revoked = true;
  await page.save();
  assert.equal(page.data.currentPassword, "");
  assert.equal(page.data.newPassword, "");
  assert.equal(page.data.confirmPassword, "");
  assert.equal(storage.has("holdem-account-token"), false);
  assert.equal(navigation.at(-1), "/pages/table/table");
});
