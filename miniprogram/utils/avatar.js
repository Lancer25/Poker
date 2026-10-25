function avatarUrl(value) {
  return value ? getApp().globalData.apiUrl + value : "";
}
async function avatarData(filePath) {
  const compressed = await new Promise((resolve, reject) =>
    wx.compressImage({
      src: filePath,
      quality: 75,
      compressedWidth: 256,
      compressedHeight: 256,
      success: resolve,
      fail: () => reject(Error("头像图片无法处理")),
    }),
  );
  const base64 = await new Promise((resolve, reject) =>
    wx
      .getFileSystemManager()
      .readFile({
        filePath: compressed.tempFilePath,
        encoding: "base64",
        success: (res) => resolve(res.data),
        fail: () => reject(Error("无法读取头像图片")),
      }),
  );
  if (base64.length > Math.ceil((128 * 1024 * 4) / 3))
    throw Error("头像图片过大，请选择较小的图片");
  const format = base64.startsWith("/9j/")
    ? "jpeg"
    : base64.startsWith("iVBORw0KGgo")
      ? "png"
      : base64.startsWith("UklGR")
        ? "webp"
        : null;
  if (!format) throw Error("请选择 JPG、PNG 或 WebP 图片");
  return `data:image/${format};base64,${base64}`;
}
module.exports = { avatarUrl, avatarData };
