import { createAdminRooms } from "/admin-rooms.js?v=practice1";
const $ = (id) => document.getElementById(id);
const roomBrowser = createAdminRooms(api);
function selectView(view, focus = false) {
  document.querySelectorAll("[data-view]").forEach((tab) => {
    const selected = tab.dataset.view === view;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    $("view-" + tab.dataset.view).hidden = !selected;
    if (selected && focus) tab.focus();
  });
  if(view==='system')refreshSystem().catch(error=>message(error.message));
}
const navigation = [...document.querySelectorAll("[data-view]")];
navigation.forEach((tab) => {
  tab.onclick = () => selectView(tab.dataset.view);
  tab.onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const index = navigation.indexOf(tab),
      next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? navigation.length - 1
            : (index + (e.key === "ArrowRight" ? 1 : -1) + navigation.length) %
              navigation.length;
    selectView(navigation[next].dataset.view, true);
  };
});
selectView("rooms");
let state;
let me;
let messageTimer;
let roomRefreshTimer,
  roomRefreshBusy = false;
let systemBusy=false;
const healthMessages = {
  latency_sustained: '持续高耗时：连续 3 分钟达到阈值（操作 500 / RTT 300 / 存储 50 / 排队 100 ms）',
  latency_observed: '有足够耗时样本，未发现连续 3 分钟超限',
  latency_insufficient: '耗时数据不足或已过期，暂无法判断',
  disconnect_anomaly: '断连异常信号：连续 2 分钟每分钟至少 5 次异常关闭、心跳超时或慢连接事件（可能重叠）',
  disconnect_observed: '已有断连窗口，未达到持续异常阈值',
  reconnect_insufficient: '断连观测窗口不足或已过期，暂无法判断',
  backup_failed: '最近备份失败，尚无后续成功校验记录',
  backup_unavailable: '备份校验目录不可用，暂无法判断',
  backup_unverified: '没有成功校验的备份记录',
  backup_stale: '最近成功校验的备份已超过时效阈值',
  backup_verified: '最近备份已成功校验且未超过时效阈值',
};
function renderHealth(health) {
  const statuses = { ok: '已观测', warning: '需关注', unknown: '未知' };
  const valid = health && Number.isFinite(Date.parse(health.at)) &&
    Math.abs(Date.now() - Date.parse(health.at)) <= 120000 && statuses[health.status];
  const status = valid ? health.status : 'unknown';
  $('healthStatus').dataset.status = status;
  $('healthStatus').textContent = valid ? '健康状态：' + statuses[status] : '健康数据不可用或已过期，暂无法判断';
  const fields = [['构建版本', valid ? health.buildVersion || '未知（未提供构建元数据）' : '未知'],
    ['最近成功校验备份', valid && health.lastVerifiedBackupAt ? date(health.lastVerifiedBackupAt) : '未知 / 无校验记录'],
    ['备份时效阈值', valid && Number.isFinite(health.backupStaleAfterHours) ? health.backupStaleAfterHours + ' 小时' : '未知']];
  $('healthMetadata').replaceChildren(...fields.map(([label, value]) => {
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = label; dd.textContent = value; row.append(dt, dd); return row;
  }));
  $('healthChecks').replaceChildren(...['latency', 'reconnect', 'backup'].map(key => {
    const check = valid ? health.checks?.[key] : null, li = document.createElement('li');
    li.dataset.status = statuses[check?.status] ? check.status : 'unknown';
    li.textContent = (statuses[li.dataset.status] + ' · ') + (healthMessages[check?.code] || '观测数据不可用，暂无法判断');
    return li;
  }));
}
async function refreshSystem(){
  if(systemBusy)return;systemBusy=true;
  try{
    const [d,b]=await Promise.all([api('/api/admin/diagnostics'),api('/api/admin/backups')]);
    renderHealth(d.health);
    const fields=[['存储',d.storage.mode],['房间',d.rooms.total],['活动牌局',d.rooms.active],['在线连接',d.rooms.onlineConnections],['运行时间',Math.floor(d.uptimeSeconds/60)+' 分钟'],['进程内存',(d.memory.rss/1048576).toFixed(1)+' MB'],['事件循环 P99',d.latency.current.eventLoopP99Ms+' ms'],['本次连接',d.transport.secure?'HTTPS':'HTTP 未加密'],['强制安全认证',d.transport.enforced?'开启':'关闭'],['自动备份',d.backup.intervalSeconds?d.backup.intervalSeconds/3600+' 小时':'关闭'],['保留份数',d.backup.keep]];
    $('systemSummary').replaceChildren(...fields.map(([label,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=String(value);row.append(dt,dd);return row;}));
    const last=d.latency.recent.at(-1)||{};
    $('systemLatency').replaceChildren(...[['actionTotalMs','操作总耗时'],['actionServerMs','服务端处理'],['actionRenderMs','客户端渲染'],['actionTransitMs','传输/排队估算'],['clientRttMs','客户端 RTT'],['saveMs','存储提交'],['snapshotMs','状态构建'],['queueMs','状态发送排队']].map(([key,label])=>{const sample=d.latency.current[key]||last[key],tr=document.createElement('tr');for(const value of [label,sample?.count??0,sample?.mean??'-',sample?.p95??'-',sample?.max??'-'])tr.append(cell(value));return tr;}));
    $('systemBackups').replaceChildren(...b.backups.map(item=>{const tr=document.createElement('tr');for(const value of [date(item.createdAt),item.mode||'-',item.valid?'通过':'异常',item.id])tr.append(cell(value));return tr;}));
    $('systemStatus').textContent='更新于 '+date(d.at)+(d.backup.running?' · 备份进行中':'')+(d.backup.failedAt?' · 最近备份失败':'');
  }catch(error){renderHealth(null);$('systemStatus').textContent='诊断刷新失败；下方历史数据可能已过期';throw error;}finally{systemBusy=false;}
}
$('refreshSystem').onclick=()=>refreshSystem().catch(error=>message(error.message));
$('createBackup').onclick=async()=>{const button=$('createBackup');button.disabled=true;try{await api('/api/admin/backups','POST',{});await refreshSystem();message('备份与恢复校验已完成');}catch(error){message(error.message);}finally{button.disabled=false;}};
const labels = {
  waiting: "等待开局",
  showdown: "本手已结算",
  ended: "本场已结束",
  preflop: "正在打牌",
  flop: "正在打牌",
  turn: "正在打牌",
  river: "正在打牌",
};
const statusText = (room) =>
  `${room.statusLabel || labels[room.phase] || "-"} · ${room.hand} 手`;
const idleText = (room) =>
  room.status === "ending"
    ? "本手结算后"
    : room.idleDeadline
      ? date(room.idleDeadline)
      : room.endReason === "idle"
        ? "无人在线超时"
        : "-";
const date = (value) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
function message(text) {
  $("adminMessage").textContent = text;
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => ($("adminMessage").textContent = ""), 5000);
}
async function api(url, method = "GET", data) {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: data === undefined ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = await response.json();
  if (response.status === 401) {
    location.replace("/?next=admin");
    throw Error("请重新登录");
  }
  if (!response.ok) throw Error(result.error || "请求失败");
  return result;
}
function cell(value, className = "") {
  const td = document.createElement("td");
  td.textContent = value;
  td.className = className;
  return td;
}
function action(label, callback, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.onclick = async () => {
    button.dataset.pending = "true";
    button.disabled = true;
    try {
      await callback();
    } catch (error) {
      message(error.message);
    } finally {
      delete button.dataset.pending;
      button.disabled = disabled;
    }
  };
  return button;
}
function rows(id, list) {
  $(id).replaceChildren(...list);
  if (!list.length) {
    const tr = document.createElement("tr"),
      td = cell("暂无记录", "empty");
    td.colSpan =
      $(id).closest("table")?.querySelectorAll("thead th").length || 5;
    tr.append(td);
    $(id).append(tr);
  }
}
async function refresh() {
  const choices = new Map(
    [...document.querySelectorAll("#roomOwners tr[data-room]")].map((row) => [
      row.dataset.room,
      row.querySelector("select")?.value,
    ]),
  );
  state = await api("/api/admin/state");
  roomBrowser.update(state.rooms);
  $("userCount").textContent = `${state.users.length} 个账号`;
  rows(
    "users",
    state.users.map((user) => {
      const tr = document.createElement("tr"),
        actions = cell("");
      actions.append(
        action("编辑", () => {
          $("editId").value = user.id;
          $("editNickname").value = user.nickname;
          $("editUsername").value = user.username;
          $("editPassword").value = "";
          $("editEnabled").checked = !user.disabled;
          $("editEnabled").disabled = user.role === "admin";
          $("editError").hidden = true;
          $("userDialog").showModal();
        }),
      );
      tr.append(
        cell(user.nickname),
        cell(user.username),
        cell(
          user.disabled ? "已停用" : user.role === "admin" ? "管理员" : "正常",
        ),
        cell(date(user.lastLoginAt)),
        actions,
      );
      return tr;
    }),
  );
  rows(
    "invites",
    state.invites.map((invite) => {
      const tr = document.createElement("tr"),
        actions = cell("");
      const expired = invite.expiresAt && invite.expiresAt <= Date.now();
      const status = !invite.active
        ? "已撤销"
        : expired
          ? "已过期"
          : invite.used >= invite.maxUses
            ? "已用完"
            : "可使用";
      actions.append(
        action("复制", async () => {
          await navigator.clipboard.writeText(invite.code);
          message("邀请码已复制");
        }),
        action(invite.active ? "撤销" : "启用", async () => {
          await api(`/api/admin/invites/${invite.id}`, "PATCH", {
            active: !invite.active,
          });
          await refresh();
        }),
      );
      tr.append(
        cell(invite.code, "code"),
        cell(`${invite.used} / ${invite.maxUses}`),
        cell(invite.expiresAt ? date(invite.expiresAt) : "长期有效"),
        cell(status),
        actions,
      );
      return tr;
    }),
  );
  rows(
    "roomOwners",
    state.rooms.map((room) => {
      const tr = document.createElement("tr"),
        choice = cell(""),
        actions = cell(""),
        select = document.createElement("select");
      tr.dataset.room = room.id;
      select.setAttribute("aria-label", `房间 ${room.id} 的房主账号`);
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "选择账号";
      select.append(placeholder);
      const users = state.users.filter((u) => !u.disabled);
      users.forEach((user) => {
        const option = document.createElement("option");
        option.value = user.id;
        option.textContent = `${user.nickname} (${user.username})`;
        select.append(option);
      });
      if (users.length === 1) select.value = users[0].id;
      if (
        choices.has(room.id) &&
        [...select.options].some((o) => o.value === choices.get(room.id))
      )
        select.value = choices.get(room.id);
      const disabled =
        !room.unclaimedHost ||
        (room.phase === "ended" && room.endReason !== "idle");
      select.disabled = disabled;
      choice.append(select);
      actions.append(
        action(
          "恢复房主",
          async () => {
            if (!select.value) throw Error("请先选择账号");
            await api("/api/admin/recover-host", "POST", {
              room: room.id,
              userId: select.value,
            });
            await refresh();
            message("房主权限已恢复");
          },
          disabled,
        ),
      );
      tr.append(
        cell(room.id),
        cell(`${room.hostName} · ${room.hostAccount || "未关联"}`),
        cell(statusText(room), "room-status"),
        cell(
          `${room.onlineCount || 0} / ${room.playerCount || 0}`,
          "room-online",
        ),
        cell(idleText(room), "room-idle"),
        choice,
        actions,
      );
      return tr;
    }),
  );
  $("legacyCount").textContent = `${state.legacy.length} 个未关联身份`;
  rows(
    "legacy",
    state.legacy.map((player) => {
      const tr = document.createElement("tr"),
        choice = cell(""),
        actions = cell(""),
        select = document.createElement("select");
      tr.dataset.room = player.room;
      select.setAttribute("aria-label", `房间 ${player.room} 的关联账号`);
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "选择账号";
      select.append(placeholder);
      state.users
        .filter((u) => !u.disabled)
        .forEach((user) => {
          const option = document.createElement("option");
          option.value = user.id;
          option.textContent = `${user.nickname} (${user.username})`;
          select.append(option);
        });
      choice.append(select);
      actions.append(
        action("关联", async () => {
          if (!select.value) throw Error("请先选择账号");
          const result = await api("/api/admin/bind", "POST", {
            room: player.room,
            player: player.player,
            userId: select.value,
          });
          await refresh();
          message(result.hostRecovered ? "房主权限已恢复" : "旧玩家已关联");
        }),
      );
      tr.append(
        cell(player.room),
        cell(player.name + (player.host ? " · 房主" : "")),
        cell(
          `${statusText(player)} · 在线 ${player.onlineCount || 0}`,
          "room-status",
        ),
        choice,
        actions,
      );
      return tr;
    }),
  );
  const descriptions = {
    bootstrap_admin: "初始化管理员",
    register: "注册账号",
    create_invite: "生成邀请码",
    update_invite: "修改邀请码",
    update_user: "修改账号",
    bind_legacy: "关联旧玩家",
    recover_host: "恢复旧房主",
  };
  const userName = (id) =>
    state.users.find((u) => u.id === id)?.username || "-";
  rows(
    "audit",
    state.audit.map((entry) => {
      const tr = document.createElement("tr");
      const invite = state.invites.find((i) => i.id === entry.target);
      const label =
        entry.action === "update_user" && entry.details.passwordReset
          ? "重置密码并更新账号"
          : descriptions[entry.action] || entry.action;
      tr.append(
        cell(date(entry.at)),
        cell(userName(entry.actor)),
        cell(label),
        cell(
          invite
            ? "邀请码 " + invite.code.slice(-6)
            : userName(entry.target) +
                (entry.action === "recover_host"
                  ? " · 房间 " + entry.details.room
                  : ""),
        ),
      );
      return tr;
    }),
  );
}
async function refreshRoomStatuses() {
  if (document.hidden || roomRefreshBusy || !me || me.role !== "admin") return;
  if(!$('view-system').hidden){await refreshSystem().catch(error=>message(error.message));return;}
  roomRefreshBusy = true;
  try {
    const fresh = await api("/api/admin/state");
    state.rooms = fresh.rooms;
    roomBrowser.update(fresh.rooms);
    if (
      fresh.rooms.some(
        (room) =>
          !document.querySelector(`#roomOwners tr[data-room="${room.id}"]`),
      )
    ) {
      await refresh();
      return;
    }
    for (const room of fresh.rooms) {
      const row = document.querySelector(
        `#roomOwners tr[data-room="${room.id}"]`,
      );
      if (row) {
        row.querySelector(".room-status").textContent = statusText(room);
        row.querySelector(".room-online").textContent =
          `${room.onlineCount} / ${room.playerCount}`;
        row.querySelector(".room-idle").textContent = idleText(room);
        const disabled =
          !room.unclaimedHost ||
          (room.phase === "ended" && room.endReason !== "idle");
        row.querySelector("select").disabled = disabled;
        row.querySelector("button").disabled =
          disabled || row.querySelector("button").dataset.pending === "true";
      }
      for (const row of document.querySelectorAll(
        `#legacy tr[data-room="${room.id}"]`,
      ))
        row.querySelector(".room-status").textContent =
          `${statusText(room)} · 在线 ${room.onlineCount}`;
    }
  } catch (error) {
    message(error.message);
  } finally {
    roomRefreshBusy = false;
  }
}
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refreshRoomStatuses();
});
window.addEventListener("pagehide", () => clearInterval(roomRefreshTimer));
window.addEventListener("pageshow", (event) => {
  if (event.persisted && me?.role === "admin")
    roomRefreshTimer = setInterval(refreshRoomStatuses, 10000);
});
$("refresh").onclick = () => ($('view-system').hidden?refresh():refreshSystem()).catch((error) => message(error.message));
$("inviteForm").onsubmit = async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/admin/invites", "POST", {
      maxUses: Number($("inviteUses").value),
      days: Number($("inviteDays").value),
    });
    await refresh();
    message("邀请码已生成");
  } catch (error) {
    message(error.message);
  } finally {
    button.disabled = false;
  }
};
$("cancelEdit").onclick = () => $("userDialog").close();
$("userForm").onsubmit = async (event) => {
  event.preventDefault();
  $("saveUser").disabled = true;
  $("editError").hidden = true;
  const id = $("editId").value;
  const data = {
    nickname: $("editNickname").value,
    username: $("editUsername").value,
    disabled: !$("editEnabled").checked,
  };
  if ($("editPassword").value) data.password = $("editPassword").value;
  try {
    await api(`/api/admin/users/${id}`, "PATCH", data);
    $("userDialog").close();
    $("editPassword").value = "";
    await refresh();
    message("账号已更新");
  } catch (error) {
    $("editError").textContent = error.message;
    $("editError").hidden = false;
  } finally {
    $("saveUser").disabled = false;
  }
};
$("adminLogout").onclick = async () => {
  try {
    await api("/api/auth/logout", "POST", {});
    location.replace("/");
  } catch (error) {
    message(error.message);
  }
};
api("/api/auth/me")
  .then(async ({ user }) => {
    me = user;
    if (me.role !== "admin") {
      location.replace("/");
      return;
    }
    await refresh();
    $("adminMain").hidden = false;
    roomRefreshTimer = setInterval(refreshRoomStatuses, 10000);
  })
  .catch((error) => message(error.message));
