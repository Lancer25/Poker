const { avatarUrl, avatarData } = require("../../utils/avatar.js");
Page({
  data: {
    nickname: "",
    username: "",
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
    busy: false,
    ready: false,
    avatarPreview: "",
    avatarBusy: false,
    error: "",
  },
  async onLoad() {
    try {
      const { user } = await this.api("/api/auth/me", "GET");
      this.user = user;
      this.setData({ avatarPreview: avatarUrl(user.avatar) });
      this.setData({
        nickname: user.nickname,
        username: user.username,
        ready: true,
      });
    } catch (error) {
      this.setData({ error: error.message });
    }
  },
  api(path, method, data) {
    return new Promise((resolve, reject) =>
      wx.request({
        url: getApp().globalData.apiUrl + path,
        method,
        data,
        header: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + wx.getStorageSync("holdem-account-token"),
        },
        success: (response) => {
          if (response.statusCode === 401) {
            wx.removeStorageSync("holdem-account-token");
            wx.reLaunch({ url: "/pages/table/table" });
          }
          if (response.statusCode >= 200 && response.statusCode < 300)
            resolve(response.data);
          else reject(Error(response.data.error || "请求失败"));
        },
        fail: () => reject(Error("暂时无法连接服务器")),
      }),
    );
  },
  input(e) {
    if (
      [
        "nickname",
        "username",
        "currentPassword",
        "newPassword",
        "confirmPassword",
      ].includes(e.currentTarget.dataset.field)
    )
      this.setData({ [e.currentTarget.dataset.field]: e.detail.value });
  },
  async chooseAvatar(e) {
    this.setData({ avatarBusy: true });
    try {
      this.avatarChange = await avatarData(e.detail.avatarUrl);
      this.setData({ avatarPreview: e.detail.avatarUrl });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ avatarBusy: false });
    }
  },
  clearAvatar() {
    this.avatarChange = null;
    this.setData({ avatarPreview: "" });
  },
  async save() {
    if (this.data.busy || this.data.avatarBusy || !this.data.ready) return;
    const d = this.data;
    if (d.newPassword !== d.confirmPassword)
      return this.setData({ error: "两次输入的新密码不一致" });
    if (
      (d.username.trim().toLowerCase() !== this.user.username ||
        d.newPassword) &&
      !d.currentPassword
    )
      return this.setData({ error: "修改账号或密码需要填写当前密码" });
    this.setData({ busy: true, error: "" });
    try {
      const result = await this.api("/api/account/profile", "PATCH", {
        nickname: d.nickname,
        username: d.username,
        currentPassword: d.currentPassword,
        newPassword: d.newPassword,
        avatar: this.avatarChange,
      });
      this.user = result.user;
      this.avatarChange = undefined;
      this.setData({ avatarPreview: avatarUrl(result.user.avatar) });
      this.setData({
        nickname: result.user.nickname,
        username: result.user.username,
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      if (result.reauthenticate) {
        wx.removeStorageSync("holdem-account-token");
        wx.showToast({ title: "修改成功，请重新登录", icon: "none" });
        wx.reLaunch({ url: "/pages/table/table" });
      } else wx.showToast({ title: "修改已保存", icon: "success" });
    } catch (error) {
      this.setData({ error: error.message });
    } finally {
      this.setData({ busy: false });
    }
  },
});
