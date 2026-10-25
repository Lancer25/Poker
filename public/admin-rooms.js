const $ = (id) => document.getElementById(id);
const date = (value) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-";
const modes = {
  friends: "好友淘汰局",
  cash: "普通好友局",
  standard: "标准淘汰赛",
  turbo: "快速淘汰赛",
};
const cell = (text, cls = "") => {
  const td = document.createElement("td");
  td.textContent = text ?? "-";
  td.className = cls;
  return td;
};
export function createAdminRooms(api) {
  let rooms = [],
    scope = "active",
    page = 1,
    detail = null,
    detailId = null,
    sequence = 0,
    trigger = null,
    handPage = 1,
    firstUpdate = true;
  function activity(r) {
    return (
      Number(r.lastActivityAt) ||
      Date.parse(r.finishedAt) ||
      Date.parse(r.createdAt) ||
      0
    );
  }
  function render() {
    const query = $("roomSearch").value.trim().toLowerCase(),
      status = $("roomStatus").value;
    const matches = rooms
      .map((r, index) => ({ ...r, index }))
      .filter(
        (r) =>
          (scope === "all" ||
            (scope === "ended" ? r.phase === "ended" : r.phase !== "ended")) &&
          (status === "all" || r.status === status) &&
          [r.id, r.hostName, r.hostAccount, ...(r.playerNames || [])].some(
            (v) =>
              String(v || "")
                .toLowerCase()
                .includes(query),
          ),
      );
    const direction = $("roomOrder").value === "oldest" ? 1 : -1;
    matches.sort(
      (a, b) => direction * (activity(a) - activity(b) || a.index - b.index),
    );
    const pages = Math.max(1, Math.ceil(matches.length / 10));
    page = Math.min(page, pages);
    $("roomList").replaceChildren(
      ...matches.slice((page - 1) * 10, page * 10).map((r) => {
        const tr = document.createElement("tr");
        tr.dataset.room = r.id;
        const title = cell(""),
          code = document.createElement("strong"),
          mode = document.createElement("small");
        code.textContent = r.id;
        mode.textContent = (r.testRound?'测试 · ':'')+(modes[r.gameMode] || modes.cash);
        title.append(code, mode);
        const badge = cell(r.statusLabel, "status-" + r.status),
          actions = cell("");
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "查看记录";
        b.onclick = () => open(r.id, b);
        actions.append(b);
        tr.append(
          title,
          cell(r.hostName),
          badge,
          cell(`${r.onlineCount} / ${r.playerCount}`),
          cell(`第 ${r.roundNumber || 1} 场 · ${r.hand} 手`),
          cell(date(activity(r))),
          actions,
        );
        return tr;
      }),
    );
    if (!matches.length) {
      const tr = document.createElement("tr"),
        td = cell(
          query
            ? "没有匹配的房间"
            : scope === "active"
              ? "暂无当前房间"
              : "暂无历史房间",
          "empty",
        );
      td.colSpan = 7;
      tr.append(td);
      $("roomList").append(tr);
    }
    $("roomPageInfo").textContent = matches.length
      ? `${matches.length} 个房间 · ${(page - 1) * 10 + 1}–${Math.min(page * 10, matches.length)}`
      : "0 个房间";
    $("roomPageNumber").textContent = `${page} / ${pages}`;
    $("roomPrev").disabled = page === 1;
    $("roomNext").disabled = page === pages;
    const ended = rooms.filter((r) => r.phase === "ended").length;
    $("roomSummary").textContent =
      `${rooms.length - ended} 个当前房间 · ${ended} 个历史房间`;
  }
  const scopes = [...document.querySelectorAll("[data-scope]")];
  function selectScope(button, focus = false) {
    scope = button.dataset.scope;
    const incompatible =
      (scope === "ended" &&
        !["all", "ended"].includes($("roomStatus").value)) ||
      (scope === "active" && $("roomStatus").value === "ended");
    if (incompatible) $("roomStatus").value = "all";
    for (const option of $("roomStatus").options)
      option.disabled =
        (scope === "ended" && !["all", "ended"].includes(option.value)) ||
        (scope === "active" && option.value === "ended");
    page = 1;
    scopes.forEach((e) => {
      e.setAttribute("aria-selected", String(e === button));
      e.tabIndex = e === button ? 0 : -1;
    });
    render();
    if (focus) button.focus();
  }
  scopes.forEach((b, i) => {
    b.tabIndex = i === 0 ? 0 : -1;
    b.onclick = () => selectScope(b);
    b.onkeydown = (e) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
      e.preventDefault();
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? scopes.length - 1
            : (i + (e.key === "ArrowRight" ? 1 : -1) + scopes.length) %
              scopes.length;
      selectScope(scopes[next], true);
    };
  });
  for (const id of ["roomSearch", "roomStatus", "roomOrder"])
    $(id).addEventListener(id === "roomSearch" ? "input" : "change", () => {
      page = 1;
      render();
    });
  $("roomPrev").onclick = () => {
    page--;
    render();
  };
  $("roomNext").onclick = () => {
    page++;
    render();
  };
  function selectedRound() {
    return detail?.rounds.find(
      (r) => String(r.number) === $("adminRoundSelect").value,
    );
  }
  function renderRound() {
    const round = selectedRound();
    if (!round) return;
    handPage = 1;
    $("adminHandSearch").value = "";
    $("roundMetadata").textContent =
      `${modes[round.gameMode] || modes.cash} · ${round.hand} 手 · 盲注 ${round.small || "-"}/${round.big || "-"} · ${round.chipMode === "carry" ? "保留筹码" : "重置筹码"}`;
    $("roundNotice").textContent = !round.ended
      ? "本场尚未结束 · 当前筹码及输赢未结算"
      : `${round.endReason === "idle" ? "无人在线自动结束" : round.endReason === "completed" ? "比赛完成" : "本场已结束"} · ${date(round.finishedAt)}`;
    if(round.testRound)$("roundNotice").textContent='测试场 · '+$("roundNotice").textContent;
    $("historyResults").replaceChildren(
      ...round.results.map((p) => {
        const tr = document.createElement("tr");
        tr.append(
          cell(p.name),
          cell(p.buyin, "numeric"),
          cell(p.stack, "numeric"),
          cell(
            `${p.net > 0 ? "+" : ""}${p.net}`,
            p.net > 0
              ? "positive numeric"
              : p.net < 0
                ? "negative numeric"
                : "numeric",
          ),
        );
        return tr;
      }),
    );
    if (!round.results.length) {
      const tr = document.createElement("tr"),
        td = cell("暂无战绩", "empty");
      td.colSpan = 4;
      tr.append(td);
      $("historyResults").append(tr);
    }
    const champion =
      round.tournament?.championId &&
      round.results.find((p) => p.id === round.tournament.championId);
    $("historyTournament").textContent = champion
      ? `冠军 · ${champion.name}`
      : round.tournament?.cancelled
        ? "比赛已取消"
        : "";
    renderHands();
  }
  function renderHands() {
    const round = selectedRound();
    if (!round) return;
    const query = $("adminHandSearch").value.trim().toLowerCase();
    const list = round.history
      .slice()
      .reverse()
      .filter((h) =>
        [h.hand, ...h.pots.flatMap((p) => p.winners)].some((v) =>
          String(v).toLowerCase().includes(query),
        ),
      );
    const pages = Math.max(1, Math.ceil(list.length / 50));
    handPage = Math.min(handPage, pages);
    $("adminHands").replaceChildren(
      ...list.slice((handPage - 1) * 50, handPage * 50).map((h) => {
        const d = document.createElement("details");
        d.className = "admin-hand";
        const s = document.createElement("summary");
        s.textContent =
          `第 ${h.hand} 手 · ` +
          (h.pots
            .map(
              (p) =>
                `${p.winners.join("、")} ${p.refund ? "退回" : "赢得"} ${p.amount}`,
            )
            .join(" · ") || "无结算记录");
        d.append(s);
        const note = document.createElement("p");
        note.className = "muted";
        note.textContent = !Array.isArray(h.board)
          ? "旧记录未保存公共牌"
          : h.board.length
            ? `公共牌 · ${h.board.length} 张`
            : "未发公共牌：本手在翻牌前结束";
        d.append(note);
        if (h.board?.length) {
          const board = document.createElement("div");
          board.className = "admin-board";
          board.setAttribute("aria-label", "公共牌");
          for (const value of h.board) {
            const c = document.createElement("div");
            c.className =
              "admin-card" + (["h", "d"].includes(value[1]) ? " red" : "");
            const a = document.createElement("span"),
              b = document.createElement("span");
            a.textContent = value[0] === "T" ? "10" : value[0];
            b.textContent = { s: "♠", h: "♥", c: "♣", d: "♦" }[value[1]] || "";
            c.append(a, b);
            board.append(c);
          }
          d.append(board);
        }
        for (const p of h.results) {
          const line = document.createElement("div");
          line.className = "hand-result";
          line.textContent = `${p.name} · 买入 ${p.buyin} · 筹码 ${p.stack} · 净输赢 ${p.net > 0 ? "+" : ""}${p.net}`;
          d.append(line);
        }
        return d;
      }),
    );
    if (!list.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = query ? "没有匹配的手牌记录" : "本场未完成任何手牌";
      $("adminHands").append(p);
    }
    $("handPageInfo").textContent =
      `${list.length} 手 · ${handPage} / ${pages}`;
    $("handPrev").disabled = handPage === 1;
    $("handNext").disabled = handPage === pages;
  }
  async function load() {
    const request = ++sequence,
      id = detailId;
    $("roomDetail").hidden = true;
    $("retryRoomHistory").hidden = true;
    $("roomDetailStatus").textContent = "正在加载记录";
    try {
      const data = await api(
        `/api/admin/rooms/${encodeURIComponent(id)}/history`,
      );
      if (request !== sequence || !$("roomDialog").open) return;
      detail = data;
      $("roomDialogMeta").textContent =
        `${modes[data.room.gameMode] || modes.cash} · 房主 ${data.room.hostName} · ${data.presence.statusLabel}`;
      $("adminRoundSelect").replaceChildren(
        ...data.rounds.map(
          (r) =>
            new Option(
              `第 ${r.number} 场 · ${r.ended ? "已结束" : "当前"}`,
              String(r.number),
            ),
        ),
      );
      $("roomDetailStatus").textContent = "";
      $("roomDetail").hidden = false;
      renderRound();
    } catch (error) {
      if (request !== sequence || !$("roomDialog").open) return;
      $("roomDetailStatus").textContent = "记录加载失败：" + error.message;
      $("retryRoomHistory").hidden = false;
    }
  }
  function open(id, button) {
    detailId = id;
    trigger = button;
    $("roomDialogTitle").textContent = `房间 ${id} · 历史记录`;
    $("roomDialogMeta").textContent = "";
    $("roomDialog").showModal();
    load();
  }
  $("closeRoomDialog").onclick = () => $("roomDialog").close();
  $("retryRoomHistory").onclick = load;
  $("roomDialog").addEventListener("close", () => {
    sequence++;
    detailId = null;
    detail = null;
    $("roomDetail").hidden = true;
    $("adminHands").replaceChildren();
    (trigger?.isConnected ? trigger : $("roomSearch")).focus();
  });
  $("adminRoundSelect").onchange = renderRound;
  $("adminHandSearch").oninput = () => {
    handPage = 1;
    renderHands();
  };
  $("handPrev").onclick = () => {
    handPage--;
    renderHands();
  };
  $("handNext").onclick = () => {
    handPage++;
    renderHands();
  };
  return {
    update(list) {
      rooms = list;
      if (
        firstUpdate &&
        rooms.length &&
        rooms.every((r) => r.phase === "ended")
      )
        selectScope(scopes.find((b) => b.dataset.scope === "ended"));
      firstUpdate = false;
      render();
      $("roomUpdated").textContent =
        "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
    },
  };
}
