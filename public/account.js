import { avatarFromFile, showAvatar } from "/avatar-upload.js?v=avatar1";
const $ = (id) => document.getElementById(id);
let avatarChange;
$("avatarFile").onchange = async () => {
  if (!$("avatarFile").files.length) return;
  $("saveProfile").disabled = true;
  try {
    avatarChange = await avatarFromFile($("avatarFile").files[0]);
    showAvatar($("avatarPreview"), $("avatarFallback"), avatarChange);
  } catch (error) {
    status(error.message, true);
  } finally {
    $("saveProfile").disabled = false;
    $("avatarFile").value = "";
  }
};
$("clearAvatar").onclick = () => {
  avatarChange = null;
  showAvatar($("avatarPreview"), $("avatarFallback"), null);
};
let user;
async function api(method, input) {
  const response = await fetch(
    method === "GET" ? "/api/auth/me" : "/api/account/profile",
    {
      method,
      credentials: "same-origin",
      headers:
        input === undefined ? {} : { "Content-Type": "application/json" },
      body: input === undefined ? undefined : JSON.stringify(input),
    },
  );
  const result = await response.json();
  if (response.status === 401) {
    location.replace("/");
    throw Error("请重新登录");
  }
  if (!response.ok) throw Error(result.error || "请求失败");
  return result;
}
function status(text, error = false) {
  $("profileStatus").textContent = text;
  $("profileStatus").classList.toggle("error", error);
}
$("profileForm").onsubmit = async (event) => {
  event.preventDefault();
  if ($("newPassword").value !== $("confirmPassword").value)
    return status("两次输入的新密码不一致", true);
  if (
    ($("username").value.trim().toLowerCase() !== user.username ||
      $("newPassword").value) &&
    !$("currentPassword").value
  )
    return status("修改账号或密码需要填写当前密码", true);
  $("saveProfile").disabled = true;
  try {
    const result = await api("PATCH", {
      nickname: $("nickname").value,
      username: $("username").value,
      currentPassword: $("currentPassword").value,
      newPassword: $("newPassword").value,
      avatar: avatarChange,
    });
    user = result.user;
    avatarChange = undefined;
    showAvatar($("avatarPreview"), $("avatarFallback"), user.avatar);
    for (const id of ["currentPassword", "newPassword", "confirmPassword"])
      $(id).value = "";
    $("nickname").value = user.nickname;
    $("username").value = user.username;
    if (result.reauthenticate) {
      $("profileForm").hidden = true;
      $("reauthenticate").hidden = false;
      status("修改已保存，旧登录已失效。请用更新后的账号和密码重新登录。");
    } else status("修改已保存");
  } catch (error) {
    status(error.message, true);
  } finally {
    $("saveProfile").disabled = false;
  }
};
api("GET")
  .then((result) => {
    user = result.user;
    window.HoldemTheme?.setAccount(user.id);
    $("avatarFallback").textContent = user.nickname.slice(0, 1);
    showAvatar($("avatarPreview"), $("avatarFallback"), user.avatar);
    $("nickname").value = user.nickname;
    $("username").value = user.username;
    $("profileForm").hidden = false;
    status("");
  })
  .catch((error) => status(error.message, true));
