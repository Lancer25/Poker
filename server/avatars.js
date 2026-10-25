import sharp from "sharp";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const limit = 128 * 1024;
let processing = 0;
function invalid(message, status = 400) {
  return Object.assign(Error(message), { status });
}
export async function prepareAvatar(input) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (
    typeof input !== "string" ||
    input.length > Math.ceil((limit * 4) / 3) + 64
  )
    throw invalid("头像图片过大或格式不正确");
  const match = input.match(
    /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match) throw invalid("头像仅支持 JPG、PNG 或 WebP 图片");
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > limit || buffer.toString("base64") !== match[2])
    throw invalid("头像图片过大或编码不正确");
  const signature =
    match[1] === "jpeg"
      ? buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
      : match[1] === "png"
        ? buffer
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : buffer.toString("ascii", 0, 4) === "RIFF" &&
          buffer.toString("ascii", 8, 12) === "WEBP";
  if (!signature) throw invalid("图片格式与内容不一致");
  if (processing >= 4) throw invalid("头像处理繁忙，请稍后再试", 429);
  processing++;
  try {
    const image = sharp(buffer, {
      limitInputPixels: 16000000,
      failOn: "warning",
    });
    const meta = await image.metadata();
    if (meta.format !== match[1] || (meta.pages || 1) !== 1)
      throw invalid("请选择静态 JPG、PNG 或 WebP 图片");
    return await image
      .rotate()
      .resize(256, 256, { fit: "cover" })
      .flatten({ background: "#e4e9e6" })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch (error) {
    if (error.status) throw error;
    throw invalid("图片损坏、分辨率过大或无法读取");
  } finally {
    processing--;
  }
}
export function saveAvatar(directory, image) {
  if (image === undefined || image === null) return image;
  const name = createHash("sha256").update(image).digest("hex") + ".jpg";
  const folder = path.join(directory, "avatars");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(path.join(folder, name), image, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return "/avatars/" + name;
}
