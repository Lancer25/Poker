export async function avatarFromFile(file) {
  if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw Error("请选择 JPG、PNG 或 WebP 图片");
  if (file.size > 10 * 1024 * 1024) throw Error("图片不能超过 10 MB");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 16000000)
      throw Error("图片分辨率过大，请选择较小的图片");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d");
    context.fillStyle = "#e4e9e6";
    context.fillRect(0, 0, 256, 256);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(
      image,
      (image.naturalWidth - side) / 2,
      (image.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function showAvatar(image, fallback, src) {
  image.hidden = !src;
  fallback.hidden = !!src;
  if (src) image.src = src;
  else image.removeAttribute("src");
  image.onerror = () => {
    image.hidden = true;
    fallback.hidden = false;
  };
}
