// 课题组论文投稿进度看板 —— 前端逻辑（原生 JS，无构建步骤）
// 若用户直接双击打开 public/index.html（file:// 协议），自动指向本地预览服务，
// 避免所有 /api 请求都因 file:// 无 origin 而失败。
const API = (typeof location !== "undefined" && location.protocol === "file:")
  ? "http://localhost:4173/api"
  : "/api";

const state = {
  papers: [],          // 本组全部论文（原始）
  members: [],         // 本组成员（课题组管理 / 使用情况用）
  filtered: [],        // 过滤/排序后的论文
  token: localStorage.getItem("pt_token") || "",
  user: null,                // {id, username, display_name}
  teams: [],                 // [{id, name, role}]
  currentTeam: localStorage.getItem("pt_team") || "",
  editing: null,
  mineOnly: false,
  regMode: "create",         // create | join
  filters: {
    status: new Set(),       // 空=全部
    owner: new Set(),        // 空=全部
    quartile: new Set(),     // 空=全部
    deadline: "",            // 空=全部 | overdue | today | week | month
    sort: "updated",         // updated | submitted | deadline | impact | owner
  },
  openFilter: null,          // 当前打开的下拉 id
};

const $ = (id) => document.getElementById(id);

// ---------- 工具 ----------
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

function fmtDate(s) {
  if (!s) return "—";
  return String(s).slice(0, 10);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return null;
  const target = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).getTime();
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - startToday) / 86400000);
}

function relTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return Math.floor(diff / 60) + " 分钟前";
  if (diff < 86400) return Math.floor(diff / 3600) + " 小时前";
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + " 天前";
  return fmtDate(iso);
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (state.token) headers["authorization"] = "Bearer " + state.token;
  try {
    const res = await fetch(API + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (e) {}
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    // 网络错误（服务未启动 / 用 file:// 直接打开页面 / CORS 等）一律转为可提示的错误，
    // 避免 async 处理函数抛出未捕获的 Promise 拒绝而导致界面"毫无反应"。
    const isFile = typeof location !== "undefined" && location.protocol === "file:";
    const hint = isFile
      ? "当前是本地文件打开（file://），请通过 http://localhost:4173 访问："
      : "网络错误，请确认预览服务已启动（node preview-server.cjs）并通过 http://localhost:4173 打开：";
    return {
      ok: false,
      status: 0,
      data: { error: hint + (e && e.message ? e.message : e) },
    };
  }
}

// 当前团队角色
function currentRole() {
  const t = state.teams.find((x) => x.id === state.currentTeam);
  return t ? t.role : null;
}

// ---------- 登录态 ----------
async function boot() {
  if (state.token) {
    const { ok, data } = await api("GET", "/me");
    if (ok && data.user) {
      state.user = data.user;
      state.teams = data.teams || [];
      if (!state.teams.find((t) => t.id === state.currentTeam)) {
        state.currentTeam = state.teams[0] ? state.teams[0].id : "";
        localStorage.setItem("pt_team", state.currentTeam);
      }
    } else {
      state.token = "";
      localStorage.removeItem("pt_token");
    }
  }
  updateAuthUI();
  loadPapers();
}

function updateAuthUI() {
  const u = state.user;
  const hasTeams = !!(u && state.teams.length);
  $("loginBtn").classList.toggle("hidden", !!u);
  $("regBtn").classList.toggle("hidden", !!u);
  $("userMenu").classList.toggle("hidden", !u);
  $("teamSelect").classList.toggle("hidden", !hasTeams);

  if (u) {
    // 显示名只展示姓名本身（中文姓名），角色标识由下拉菜单中的"课题组管理"体现
    $("userBtn").textContent = "👤 " + u.display_name;
  }
  // 写操作按钮：登录且在该组即可
  $("addBtn").classList.toggle("hidden", !hasTeams);
  $("sampleBtn").classList.toggle("hidden", !hasTeams);
  // 课题组管理入口：仅当前团队管理员可见
  document.querySelector('[data-act="team"]').classList.toggle("hidden", currentRole() !== "admin");

  // 填充团队下拉
  const sel = $("teamSelect");
  sel.innerHTML = state.teams
    .map((t) => `<option value="${esc(t.id)}">${esc(t.name)}${t.role === "admin" ? "（管理）" : ""}</option>`)
    .join("");
  sel.value = state.currentTeam;
}

async function doLogin(e) {
  e.preventDefault();
  const username = $("loginUser").value.trim();
  const password = $("loginPass").value;
  if (!username || !password) return toast("请输入用户名和密码");
  const { ok, data } = await api("POST", "/login", { username, password });
  if (!ok) { toast(data.error || "登录失败"); return; }
  onAuthSuccess(data);
  closeLogin();
  toast("登录成功：" + data.user.display_name);
}

function onAuthSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  state.teams = data.teams || [];
  state.currentTeam = (data.createdTeam && data.createdTeam.id) ||
    (state.teams[0] ? state.teams[0].id : "");
  localStorage.setItem("pt_token", data.token);
  localStorage.setItem("pt_team", state.currentTeam);
  updateAuthUI();
  loadPapers();
}

async function doLogout() {
  if (state.token) await api("POST", "/logout");
  state.token = "";
  state.user = null;
  state.teams = [];
  state.currentTeam = "";
  state.mineOnly = false;
  localStorage.removeItem("pt_token");
  localStorage.removeItem("pt_team");
  closeDropdown();
  updateAuthUI();
  loadPapers();
  toast("已退出登录");
}

// ---------- 注册 / 加入 ----------
function openReg() { resetRegForm(); $("regModal").classList.remove("hidden"); }
function closeReg() { $("regModal").classList.add("hidden"); }

function setRegMode(mode) {
  state.regMode = mode;
  const create = mode === "create";
  $("tabCreate").classList.toggle("active", create);
  $("tabJoin").classList.toggle("active", !create);
  $("regTeamWrap").classList.toggle("hidden", !create);
  $("regCodeWrap").classList.toggle("hidden", create);
  $("regSubmit").textContent = create ? "创建课题组" : "加入课题组";
  $("regTip").textContent = create
    ? "创建后你即为该课题组管理员，并可立即获得一条邀请码发给师姐/师妹/导师。"
    : "输入课题组管理员发给你的邀请码即可加入，自动成为该组成员。";
}

function resetRegForm() {
  $("regForm").reset();
  setRegMode("create");
}

async function submitReg(e) {
  e.preventDefault();
  const username = $("regUsername").value.trim();
  const displayName = $("regName").value.trim();
  const password = $("regPass").value;
  const body = { mode: state.regMode, username, displayName, password };
  if (state.regMode === "create") {
    body.teamName = $("regTeamName").value.trim();
    if (!body.teamName) return toast("请填写课题组名称");
  } else {
    body.code = $("regCode").value.trim().toUpperCase();
    if (!body.code) return toast("请填写邀请码");
  }
  if (!username || !displayName) return toast("请填写用户名和姓名");
  if (!password || password.length < 6) return toast("密码至少 6 位");

  const { ok, data } = await api("POST", "/register", body);
  if (!ok) { toast(data.error || "注册失败"); return; }
  onAuthSuccess(data);
  closeReg();
  if (data.createdTeam) {
    toast("课题组已创建！邀请码：" + data.createdTeam.inviteCode + "（可在课题组管理复制）");
  } else {
    toast("已加入课题组：" + (data.teams[0] ? data.teams[0].name : ""));
  }
}

// ---------- 使用说明引导向导（首次访问自动弹出，分片指导） ----------
const ONBOARD_SLIDES = [
  { title: "欢迎使用 · 课题组投稿进度看板", illu: "./xmu-building.svg",
    text: "这是一块<b>课题组共享</b>的看板：导师与同门在同一块板上，透明追踪每篇论文的投稿状态。本组进度仅本组成员可见。" },
  { title: "第一步：注册 / 加入课题组", illu: "./logo-xmu.svg",
    text: "点右上角「<b>注册 / 加入</b>」。有邀请码选「凭邀请码加入」；要新建课题组选「创建课题组」，创建者即管理员，并自动获得邀请码，可发给师姐、师妹、导师。" },
  { title: "第二步：添加你的论文", illu: "./phoenix-flower.svg",
    text: "登录后点「<b>添加论文</b>」，填写题目、期刊、影响因子、分区与进度。论文会按「负责人」（你的姓名）自动归入你的专属小框。" },
  { title: "第三步：看懂看板", illu: "./xmu-stat-bg.svg",
    text: "每位成员一张卡片，展示其论文；可按<b>进度 / 成员 / 分区</b>筛选、排序、搜索。顶部统计卡显示整体：总数、接收/已发表、审稿中、返修中。" },
  { title: "第四步：课题组管理 & 隐私", illu: "./logo-xmu.svg",
    text: "管理员点「<b>课题组管理</b>」可生成邀请码、调整成员角色、移除成员。同组默认<b>可见彼此论文</b>；想只看自己，点右上角头像 → 「只看我的」。" },
  { title: "开始使用吧", illu: "./phoenix-flower.svg",
    text: "现在就去右上角「注册 / 加入」，创建或加入你的第一个课题组，添加第一篇论文。随时可点右上角「使用说明」重温本向导。" },
];
let onboardIdx = 0;
function onboardRender() {
  const s = ONBOARD_SLIDES[onboardIdx];
  $("onboardStage").innerHTML =
    `<img class="onboard-illu" src="${s.illu}" alt="" />
     <h3 class="onboard-step-title">${esc(s.title)}</h3>
     <p class="onboard-step-text">${s.text}</p>`;
  $("onboardDots").innerHTML = ONBOARD_SLIDES.map((_, i) =>
    `<span class="dot ${i === onboardIdx ? "active" : ""}"></span>`).join("");
  $("onboardPrev").style.visibility = onboardIdx === 0 ? "hidden" : "visible";
  $("onboardNext").textContent = onboardIdx === ONBOARD_SLIDES.length - 1 ? "开始使用" : "下一步";
}
function openOnboard() { onboardIdx = 0; onboardRender(); $("onboardModal").classList.remove("hidden"); }
function closeOnboard(done) {
  $("onboardModal").classList.add("hidden");
  if (done) { try { localStorage.setItem("pt_onboarded", "1"); } catch (e) {} }
}
function onboardNext() {
  if (onboardIdx >= ONBOARD_SLIDES.length - 1) { closeOnboard(true); return; }
  onboardIdx++; onboardRender();
}
function onboardPrev() { if (onboardIdx > 0) { onboardIdx--; onboardRender(); } }

// ---------- 数据加载 ----------
async function loadPapers() {
  if (!state.user || !state.currentTeam) {
    $("boards").innerHTML = `<div class="board-empty">${
      state.user ? "你还没有加入任何课题组，请用邀请码加入或创建课题组。" : "请先登录 / 注册后查看本组进度（非本组成员不可见）。"
    }</div>`;
    renderStats();
    return;
  }
  const params = new URLSearchParams();
  params.set("team_id", state.currentTeam);
  if (state.mineOnly) params.set("mine", "1");
  try {
    const { ok, data } = await api("GET", "/papers?" + params.toString());
    if (!ok) { toast(data.error || "加载失败"); state.papers = []; }
    else state.papers = data.papers || [];
  } catch (e) {
    state.papers = [];
    toast("加载失败：" + e.message);
  }
  applyFilters();
}

// ---------- 渲染 ----------
function render() { renderStats(); renderFilterBar(); renderBoards(); }

function renderStats() {
  const p = state.filtered;
  const count = (s) => p.filter((x) => x.status === s).length;
  $("statTotal").textContent = p.length;
  $("statAccepted").textContent = count("接收") + count("已发表");
  $("statReview").textContent = count("审稿中");
  $("statRevision").textContent = count("返修");
}

// 多维组合过滤 + 排序（前端本地完成，课题组数据量很小）
function applyFilters() {
  const q = $("searchInput").value.trim().toLowerCase();
  const f = state.filters;

  const out = state.papers.filter((p) => {
    if (q) {
      const hay = [p.title, p.journal, p.note, p.owner_name].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.status.size && !f.status.has(p.status || "")) return false;
    if (f.owner.size && !f.owner.has(p.owner_name || "未分配")) return false;
    if (f.quartile.size && !f.quartile.has(p.quartile || "待定")) return false;
    if (f.deadline) {
      const d = daysUntil(p.revision_deadline);
      if (f.deadline === "overdue" && !(d !== null && d < 0)) return false;
      if (f.deadline === "today" && !(d === 0)) return false;
      if (f.deadline === "week" && !(d !== null && d >= 0 && d <= 7)) return false;
      if (f.deadline === "month" && !(d !== null && d >= 0 && d <= 30)) return false;
    }
    return true;
  });

  const s = f.sort;
  out.sort((a, b) => {
    if (s === "submitted") return String(b.submitted_at || "").localeCompare(String(a.submitted_at || ""));
    if (s === "deadline") {
      const da = a.revision_deadline ? new Date(a.revision_deadline).getTime() : Infinity;
      const db = b.revision_deadline ? new Date(b.revision_deadline).getTime() : Infinity;
      return da - db;
    }
    if (s === "impact") return (Number(b.impact_factor) || 0) - (Number(a.impact_factor) || 0);
    if (s === "owner") return String(a.owner_name || "").localeCompare(String(b.owner_name || ""), "zh");
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  });

  state.filtered = out;
  render();
}

// 已选条件的小标签（显示在触发按钮上）
function summarize(set, allLabel) {
  if (!set.size) return allLabel;
  if (set.size <= 2) return [...set].join("、");
  return [...set].slice(0, 2).join("、") + ` 等 ${set.size} 项`;
}
function deadlineLabel(v) {
  return { overdue: "已逾期", today: "今天到期", week: "7天内", month: "30天内" }[v] || "全部";
}
function sortLabel(v) {
  return { updated: "最近更新", submitted: "投稿时间", deadline: "返修截止", impact: "影响因子", owner: "负责人" }[v] || "最近更新";
}

// 渲染筛选栏（下拉内容 + 触发按钮文案）
function renderFilterBar() {
  const f = state.filters;
  const statuses = [...new Set(state.papers.map((x) => x.status).filter(Boolean))];
  const owners = [...new Set(state.papers.map((x) => x.owner_name || "未分配").filter(Boolean))];
  const quartiles = [...new Set(state.papers.map((x) => x.quartile || "待定").filter(Boolean))];
  const order = ["Q1", "Q2", "Q3", "Q4", "待定"];
  quartiles.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  // 进度
  $("fvStatus").textContent = summarize(f.status, "全部");
  buildChecklist("fdStatus", statuses, f.status, () => { $("fvStatus").textContent = summarize(f.status, "全部"); });

  // 成员
  $("fvOwner").textContent = summarize(f.owner, "全部成员");
  buildChecklist("fdOwner", owners, f.owner, () => { $("fvOwner").textContent = summarize(f.owner, "全部成员"); });

  // 分区
  $("fvQuartile").textContent = summarize(f.quartile, "全部");
  buildChecklist("fdQuartile", quartiles, f.quartile, () => { $("fvQuartile").textContent = summarize(f.quartile, "全部"); });

  // 截止时间（单选）
  $("fvDeadline").textContent = deadlineLabel(f.deadline);
  const deadlineOpts = [
    { v: "", t: "全部" }, { v: "overdue", t: "已逾期" },
    { v: "today", t: "今天到期" }, { v: "week", t: "7天内" }, { v: "month", t: "30天内" },
  ];
  buildRadio("fdDeadline", deadlineOpts, f.deadline, (v) => {
    f.deadline = v; $("fvDeadline").textContent = deadlineLabel(v); applyFilters();
  });

  // 排序（单选）
  $("fvSort").textContent = sortLabel(f.sort);
  const sortOpts = [
    { v: "updated", t: "最近更新" }, { v: "submitted", t: "投稿时间" },
    { v: "deadline", t: "返修截止" }, { v: "impact", t: "影响因子" }, { v: "owner", t: "负责人" },
  ];
  buildRadio("fdSort", sortOpts, f.sort, (v) => {
    f.sort = v; $("fvSort").textContent = sortLabel(v); applyFilters();
  });
}

// 多选下拉：set 直接被修改，onChange 回调更新按钮文案
function buildChecklist(domId, options, set, onChange) {
  const box = $(domId);
  box.innerHTML = options.map((o) => {
    const checked = set.has(o) ? "checked" : "";
    return `<label class="filter-opt"><input type="checkbox" value="${esc(o)}" ${checked}/>${esc(o)}</label>`;
  }).join("") + `<div class="filter-foot">
    <button type="button" class="filter-mini" data-act="all">全选</button>
    <button type="button" class="filter-mini" data-act="none">清空</button>
  </div>`;
  box.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) set.add(cb.value); else set.delete(cb.value);
      onChange(); applyFilters();
    });
  });
  box.querySelector('[data-act="all"]').addEventListener("click", () => {
    options.forEach((o) => set.add(o)); onChange(); applyFilters(); renderFilterBar();
  });
  box.querySelector('[data-act="none"]').addEventListener("click", () => {
    set.clear(); onChange(); applyFilters(); renderFilterBar();
  });
}

// 单选下拉
function buildRadio(domId, options, current, onPick) {
  const box = $(domId);
  box.innerHTML = options.map((o) => {
    const active = o.v === current ? "active" : "";
    return `<button type="button" class="filter-radio ${active}" data-v="${esc(o.v)}">${esc(o.t)}</button>`;
  }).join("");
  box.querySelectorAll(".filter-radio").forEach((btn) => {
    btn.addEventListener("click", () => {
      onPick(btn.getAttribute("data-v"));
      closeFilterDropdowns();
      renderFilterBar();
    });
  });
}

function closeFilterDropdowns() {
  document.querySelectorAll(".filter-dropdown").forEach((d) => d.classList.add("hidden"));
  state.openFilter = null;
}
function toggleFilterDropdown(id) {
  const box = $(id);
  const willOpen = box.classList.contains("hidden");
  closeFilterDropdowns();
  if (willOpen) { box.classList.remove("hidden"); state.openFilter = id; }
}

function badge(status) {
  const cls = "badge s-" + String(status || "").replace(/\s/g, "");
  return `<span class="${cls}">${esc(status || "—")}</span>`;
}
function qBadge(q) {
  const cls = "q-badge q-" + String(q || "");
  return `<span class="${cls}">${esc(q || "—")}</span>`;
}
function deadlineCell(p) {
  if (!p.revision_deadline) return "—";
  const d = daysUntil(p.revision_deadline);
  if (d === null) return "—";
  if (d < 0) return `<span class="dl overdue">已逾期 ${Math.abs(d)} 天</span>`;
  if (d <= 7) return `<span class="dl urgent">距截止 ${d} 天</span>`;
  return `<span class="dl">距截止 ${d} 天</span>`;
}

function canEdit(p) {
  if (!state.user) return false;
  if (currentRole() === "admin") return true;
  return p.owner_id && p.owner_id === state.user.id;
}

// 按负责人分组渲染：每人一个独立小框
function ownerKey(p) {
  return p.owner_id || ("name:" + (p.owner_name || "未分配"));
}

function renderBoards() {
  const boards = $("boards");
  if (!state.filtered.length) {
    boards.innerHTML = `<div class="board-empty">暂无数据。登录后点「载入示例数据」或「添加论文」。${
      state.papers.length ? "（当前筛选条件下没有匹配的论文）" : ""
    }</div>`;
    return;
  }
  // 分组
  const map = new Map();
  state.filtered.forEach((p) => {
    const key = ownerKey(p);
    if (!map.has(key)) {
      map.set(key, {
        name: p.owner_name || "未分配",
        ownerId: p.owner_id || null,
        isMe: !!(state.user && p.owner_id && p.owner_id === state.user.id),
        papers: [],
      });
    }
    map.get(key).papers.push(p);
  });
  // 排序：本人优先，其余按名字
  const groups = [...map.values()].sort((a, b) => {
    if (a.isMe !== b.isMe) return a.isMe ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });

  boards.innerHTML = groups
    .map((g) => {
      const rows = g.papers
        .map((p) => {
          const op = canEdit(p)
            ? `<div class="row-op">
                 <button class="link-btn" data-edit="${p.id}">编辑</button>
                 <button class="link-btn del" data-del="${p.id}">删除</button>
               </div>`
            : `<span class="muted-tag">只读</span>`;
          return `<tr>
            <td class="title-cell" data-label="论文题目">${esc(p.title)}</td>
            <td class="journal-cell" data-label="期刊名称">${esc(p.journal || "—")}</td>
            <td class="num" data-label="影响因子">${p.impact_factor != null ? esc(p.impact_factor) : "—"}</td>
            <td data-label="分区">${qBadge(p.quartile)}</td>
            <td data-label="投稿进度">${badge(p.status)}</td>
            <td data-label="投稿时间">${fmtDate(p.submitted_at)}</td>
            <td data-label="返修截止">${deadlineCell(p)}</td>
            <td data-label="最近更新">${relTime(p.updated_at)}</td>
            <td class="op-col" data-label="操作">${op}</td>
          </tr>`;
        })
        .join("");
      // 小框头部"添加论文"：本人可见；管理员对任意成员的小框都可见
      const canAdd = g.ownerId && (currentRole() === "admin" || g.isMe);
      const addBtn = canAdd
        ? `<button class="add-for-btn" data-addid="${esc(g.ownerId)}" data-addname="${esc(g.name)}">+ 添加论文</button>`
        : "";
      return `<div class="owner-card ${g.isMe ? "is-me" : ""}">
        <div class="owner-head">
          <span class="owner-avatar">${esc((g.name || "？").slice(0, 1))}</span>
          <span class="owner-name">${esc(g.name)}</span>
          ${g.isMe ? '<span class="owner-me-tag">我</span>' : ""}
          <span class="owner-count">${g.papers.length} 篇</span>
          ${addBtn}
        </div>
        <div class="owner-table-wrap">
          <table class="paper-table owner-table">
            <thead><tr>
              <th>论文题目</th>
              <th>期刊名称</th>
              <th class="num">影响因子</th>
              <th>分区</th>
              <th>投稿进度</th>
              <th>投稿时间</th>
              <th>返修截止</th>
              <th>最近更新</th>
              <th class="op-col">操作</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

// ---------- 弹窗控制 ----------
// ownerId/ownerName：添加时归属谁（默认为当前用户；管理员可在某人的小框里帮他添加）
function openModal(record, ownerId, ownerName) {
  state.editing = record || null;
  if (record) {
    state.targetOwnerId = record.owner_id;
    state.targetOwnerName = record.owner_name || "";
  } else if (ownerId) {
    state.targetOwnerId = ownerId;
    state.targetOwnerName = ownerName;
  } else {
    state.targetOwnerId = state.user ? state.user.id : null;
    state.targetOwnerName = state.user ? state.user.display_name : "";
  }
  $("modalTitle").textContent = record ? "编辑论文" : "添加论文";
  $("f_id").value = record ? record.id : "";
  $("f_title").value = record ? record.title : "";
  $("f_journal").value = record ? record.journal || "" : "";
  $("f_impact_factor").value = record && record.impact_factor != null ? record.impact_factor : "";
  $("f_quartile").value = record ? record.quartile || "待定" : "待定";
  $("f_status").value = record ? record.status || "草稿" : "草稿";
  $("f_owner").value = state.targetOwnerName || "";
  $("f_submitted_at").value = record ? (record.submitted_at || "").slice(0, 10) : "";
  $("f_revision_deadline").value = record ? (record.revision_deadline || "").slice(0, 10) : "";
  $("f_note").value = record ? record.note || "" : "";
  $("modal").classList.remove("hidden");
  $("f_title").focus();
}
// 在某人的小框里点"+ 添加论文"：直接归属给那个人
function openAddFor(ownerId, ownerName) {
  openModal(null, ownerId, ownerName);
}
function closeModal() { $("modal").classList.add("hidden"); state.editing = null; }

function openLogin() { $("loginModal").classList.remove("hidden"); $("loginUser").focus(); }
function closeLogin() { $("loginModal").classList.add("hidden"); }

function openPw() { $("pwForm").reset(); $("pwModal").classList.remove("hidden"); }
function closePw() { $("pwModal").classList.add("hidden"); }

function toggleDropdown() { $("userDropdown").classList.toggle("hidden"); }
function closeDropdown() { $("userDropdown").classList.add("hidden"); }

// ---------- 课题组管理 ----------
function openTeam() {
  if (!state.currentTeam) return toast("请先选择课题组");
  const t = state.teams.find((x) => x.id === state.currentTeam);
  $("teamModalTitle").textContent = "课题组管理 · " + (t ? t.name : "");
  $("inviteRole").value = "member";
  $("inviteMax").value = "";
  const isAdmin = currentRole() === "admin";
  document.querySelector(".invite-gen").classList.toggle("hidden", !isAdmin);
  loadMembers();
  loadInvites();
  $("teamModal").classList.remove("hidden");
}
function closeTeam() { $("teamModal").classList.add("hidden"); }

async function loadMembers() {
  const { ok, data } = await api("GET", "/teams/" + encodeURIComponent(state.currentTeam) + "/members");
  if (!ok) { toast(data.error || "无法加载成员"); return; }
  state.members = data.members || [];
  const isAdmin = currentRole() === "admin";
  $("teamMemberCount").textContent = data.members.length;
  const list = $("membersList");
  if (!data.members.length) { list.innerHTML = '<p class="empty">还没有成员。</p>'; return; }
  list.innerHTML = data.members.map((m) => {
    const isSelf = m.user_id === state.user.id;
    const canRemove = isAdmin && !isSelf;
    const canRole = isAdmin && !isSelf;
    const roleBtn = canRole
      ? (m.role === "member"
          ? `<button class="link-btn" data-promote="${esc(m.user_id)}">设为管理员</button>`
          : `<button class="link-btn" data-demote="${esc(m.user_id)}">降为成员</button>`)
      : "";
    return `<div class="user-row">
      <span><b>${esc(m.display_name)}</b> <span class="muted-tag">@${esc(m.username)} · ${m.role === "admin" ? "管理员" : "成员"}</span></span>
      <span class="user-row-actions">${roleBtn}${canRemove ? `<button class="link-btn del" data-delmember="${esc(m.user_id)}">移除</button>` : ""}</span>
    </div>`;
  }).join("");
  renderUsage();
}

async function setMemberRole(uid, role) {
  const verb = role === "admin" ? "设为管理员" : "降为普通成员";
  if (!confirm(`确定将该成员${verb}？`)) return;
  const { ok, data } = await api("PUT", "/teams/" + encodeURIComponent(state.currentTeam) + "/members", { uid, role });
  if (!ok) { toast(data.error || "操作失败"); return; }
  toast("已" + verb);
  loadMembers();
}

async function loadInvites() {
  const { ok, data } = await api("GET", "/teams/" + encodeURIComponent(state.currentTeam) + "/invites");
  if (!ok) { toast(data.error || "无法加载邀请码"); return; }
  const list = $("inviteList");
  if (!data.invites.length) { list.innerHTML = '<p class="empty">还没有邀请码，点上方「生成邀请码」创建。</p>'; return; }
  list.innerHTML = data.invites.map((i) => {
    const expired = i.expires_at && i.expires_at < Date.now();
    const full = i.max_uses != null && i.used_count >= i.max_uses;
    const disabled = !i.active || expired || full;
    return `<div class="invite-row">
      <code class="invite-code">${esc(i.code)}</code>
      <span class="muted-tag">${i.role === "admin" ? "管理员" : "成员"}</span>
      <span class="muted-tag">已用 ${i.used_count}${i.max_uses ? "/" + i.max_uses : ""}</span>
      ${disabled ? '<span class="muted-tag">已失效</span>' : `<button class="link-btn" data-copy="${esc(i.code)}">复制</button>`}
    </div>`;
  }).join("");
}

async function genInvite() {
  const role = $("inviteRole").value;
  const maxRaw = $("inviteMax").value;
  const max = maxRaw === "" ? null : Number(maxRaw);
  const { ok, data } = await api("POST", "/teams/" + encodeURIComponent(state.currentTeam) + "/invites", { role, maxUses: max });
  if (!ok) { toast(data.error || "生成失败"); return; }
  toast("已生成邀请码：" + data.code + "（点复制发给大家）");
  loadInvites();
}

async function removeMember(uid) {
  if (!confirm("确定将该成员移出本课题组？其论文归属会置空（仍保留在列表）。")) return;
  const { ok, data } = await api("DELETE", "/teams/" + encodeURIComponent(state.currentTeam) + "/members?uid=" + encodeURIComponent(uid));
  if (!ok) { toast(data.error || "移除失败"); return; }
  toast("已移除成员");
  loadMembers();
  loadPapers();
}

async function copyInvite(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast("已复制邀请码：" + code);
  } catch (e) {
    prompt("复制以下邀请码发给大家：", code);
  }
}

// ---------- 课题组使用情况（投稿全景） ----------
function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (isNaN(d)) return "";
  const diff = Date.now() - d;
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "刚刚";
  if (diff < hr) return Math.floor(diff / min) + " 分钟前";
  if (diff < day) return Math.floor(diff / hr) + " 小时前";
  if (diff < day * 30) return Math.floor(diff / day) + " 天前";
  return Math.floor(diff / (day * 30)) + " 个月前";
}

// 基于本组论文 + 成员，前端聚合展示"谁加了哪些论文、整体进度、最近动态"。
// 无需后端改动：state.papers 已含全部本组论文（owner_id / owner_name / status / updated_at）。
function renderUsage() {
  const members = state.members || [];
  const papers = state.papers || [];
  const statsEl = $("usageStats");
  if (!statsEl) return;

  // 1) 整体统计卡（按状态分布）
  const byStatus = {};
  for (const p of papers) { const s = p.status || "草稿"; byStatus[s] = (byStatus[s] || 0) + 1; }
  const statusOrder = ["草稿", "已投稿", "审稿中", "返修", "接收", "拒稿", "已发表"];
  const chip = (label, num) => `<span class="usage-chip">${label} <b>${num}</b></span>`;
  let chips = chip("论文总数", papers.length);
  for (const s of statusOrder) if (byStatus[s]) chips += chip(s, byStatus[s]);
  statsEl.innerHTML = chips || '<span class="usage-empty">还没有论文数据。</span>';

  // 2) 每位成员论文明细（优先按 owner_id 匹配，兼容仅 owner_name）
  const byMember = {};
  for (const m of members) byMember[m.user_id] = { name: m.display_name, role: m.role, total: 0, recv: 0, review: 0, rev: 0 };
  for (const p of papers) {
    const key = p.owner_id || ("name:" + (p.owner_name || ""));
    if (!byMember[key]) byMember[key] = { name: p.owner_name || "未分配", role: "", total: 0, recv: 0, review: 0, rev: 0 };
    const g = byMember[key];
    g.total++;
    if (p.status === "接收" || p.status === "已发表") g.recv++;
    else if (p.status === "审稿中") g.review++;
    else if (p.status === "返修") g.rev++;
  }
  const membersEl = $("usageMembers");
  const ids = Object.keys(byMember);
  if (!ids.length) {
    membersEl.innerHTML = '<p class="usage-empty">还没有成员。</p>';
  } else {
    membersEl.innerHTML = ids.map((k) => {
      const g = byMember[k];
      const mini = (label, n) => `<span class="u-mini ${n ? "" : "zero"}">${label} ${n}</span>`;
      return `<div class="usage-member">
        <span class="u-avatar">${esc((g.name || "?").slice(0, 1))}</span>
        <span class="u-name">${esc(g.name || "未分配")}</span>
        ${g.role ? `<span class="u-role">${g.role === "admin" ? "管理员" : "成员"}</span>` : ""}
        <span class="u-counts">
          ${mini("共", g.total)}
          ${mini("接收/发表", g.recv)}
          ${mini("审稿", g.review)}
          ${mini("返修", g.rev)}
        </span>
      </div>`;
    }).join("");
  }

  // 3) 最近动态（按 updated_at 倒序取前 8 条）
  const actEl = $("usageActivity");
  const recent = [...papers].sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""))).slice(0, 8);
  if (!recent.length) {
    actEl.innerHTML = '<p class="usage-empty">暂无动态。</p>';
  } else {
    actEl.innerHTML = recent.map((p) => {
      const st = p.status || "";
      return `<div class="activity-row">
        <span class="a-who">${esc(p.owner_name || "未分配")}</span>
        <span class="a-title">《${esc(p.title || "未命名论文")}》</span>
        <span class="badge s-${st}">${esc(st)}</span>
        <span class="a-time">${timeAgo(p.updated_at)}</span>
      </div>`;
    }).join("");
  }
}

// ---------- 修改密码 ----------
async function changePassword(e) {
  e.preventDefault();
  const oldPassword = $("pwOld").value;
  const newPassword = $("pwNew").value;
  if (!oldPassword || !newPassword) return toast("请填写完整");
  const { ok, data } = await api("PUT", "/me", { oldPassword, newPassword });
  if (!ok) { toast(data.error || "修改失败"); return; }
  closePw();
  toast("密码已修改，请重新登录");
  doLogout();
}

// ---------- 写入论文 ----------
async function submitPaper(e) {
  e.preventDefault();
  if (!state.user) return toast("请先登录");
  const body = {
    title: $("f_title").value.trim(),
    journal: $("f_journal").value.trim(),
    impact_factor: $("f_impact_factor").value,
    quartile: $("f_quartile").value,
    status: $("f_status").value,
    submitted_at: $("f_submitted_at").value,
    revision_deadline: $("f_revision_deadline").value,
    note: $("f_note").value.trim(),
  };
  if (!body.title) return toast("论文题目不能为空");

  let res;
  if (state.editing) {
    res = await api("PUT", "/papers?id=" + encodeURIComponent(state.editing.id) + "&team_id=" + encodeURIComponent(state.currentTeam), body);
  } else {
    // 管理员在某人的小框里帮他添加时，指定归属人
    if (currentRole() === "admin" && state.targetOwnerId && state.targetOwnerId !== state.user.id) {
      body.owner_id = state.targetOwnerId;
      body.owner_name = state.targetOwnerName;
    }
    res = await api("POST", "/papers?team_id=" + encodeURIComponent(state.currentTeam), body);
  }
  if (!res.ok) { toast("操作失败：" + (res.data.error || res.status)); return; }
  toast(state.editing ? "已保存" : "已添加");
  closeModal();
  loadPapers();
}

async function deletePaper(id) {
  if (!confirm("确定删除这篇论文记录？")) return;
  const res = await api("DELETE", "/papers?id=" + encodeURIComponent(id) + "&team_id=" + encodeURIComponent(state.currentTeam));
  if (!res.ok) { toast("删除失败：" + (res.data.error || res.status)); return; }
  toast("已删除");
  loadPapers();
}

async function loadSample() {
  if (!state.user) return toast("请先登录");
  const res = await api("POST", "/papers?team_id=" + encodeURIComponent(state.currentTeam), { action: "sample" });
  if (!res.ok) { toast("失败：" + (res.data.error || res.status)); return; }
  toast("已载入 " + res.data.count + " 条示例（归属为你本人）");
  loadPapers();
}

// ---------- 事件绑定 ----------
function bind() {
  // 团队切换
  $("teamSelect").addEventListener("change", (e) => {
    state.currentTeam = e.target.value;
    localStorage.setItem("pt_team", state.currentTeam);
    updateAuthUI();
    loadPapers();
  });

  // 登录区
  $("loginBtn").addEventListener("click", openLogin);
  $("regBtn").addEventListener("click", openReg);
  $("loginForm").addEventListener("submit", doLogin);
  $("toRegister").addEventListener("click", (e) => { e.preventDefault(); closeLogin(); openReg(); });
  $("userBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleDropdown(); });
  document.addEventListener("click", () => closeDropdown());
  $("userDropdown").addEventListener("click", (e) => {
    const act = e.target.getAttribute("data-act");
    if (!act) return;
    if (act === "mine") { state.mineOnly = !state.mineOnly; closeDropdown(); loadPapers(); }
    else if (act === "password") { closeDropdown(); openPw(); }
    else if (act === "team") { closeDropdown(); openTeam(); }
    else if (act === "logout") { doLogout(); }
  });

  // 注册弹窗
  $("tabCreate").addEventListener("click", () => setRegMode("create"));
  $("tabJoin").addEventListener("click", () => setRegMode("join"));
  $("regForm").addEventListener("submit", submitReg);
  document.querySelectorAll("[data-close-reg]").forEach((el) => el.addEventListener("click", closeReg));

  // 登录弹窗关闭
  document.querySelectorAll("[data-close-login]").forEach((el) => el.addEventListener("click", closeLogin));
  // 改密弹窗
  $("pwForm").addEventListener("submit", changePassword);
  document.querySelectorAll("[data-close-pw]").forEach((el) => el.addEventListener("click", closePw));
  // 课题组管理弹窗
  $("genInviteBtn").addEventListener("click", genInvite);
  document.querySelectorAll("[data-close-team]").forEach((el) => el.addEventListener("click", closeTeam));
  $("membersList").addEventListener("click", (e) => {
    const uid = e.target.getAttribute("data-delmember");
    const promote = e.target.getAttribute("data-promote");
    const demote = e.target.getAttribute("data-demote");
    if (uid) removeMember(uid);
    else if (promote) setMemberRole(promote, "admin");
    else if (demote) setMemberRole(demote, "member");
  });
  $("inviteList").addEventListener("click", (e) => {
    const code = e.target.getAttribute("data-copy");
    if (code) copyInvite(code);
  });

  // 表格筛选
  $("refreshBtn").addEventListener("click", loadPapers);
  // 下拉触发按钮
  document.querySelectorAll(".filter-trigger").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFilterDropdown(btn.getAttribute("data-target"));
    });
  });
  // 点击下拉内部不关闭；点击外部关闭
  document.querySelectorAll(".filter-dropdown").forEach((box) => {
    box.addEventListener("click", (e) => e.stopPropagation());
  });
  document.addEventListener("click", closeFilterDropdowns);
  $("searchInput").addEventListener("input", debounce(applyFilters, 300));

  // 添加 / 示例
  $("addBtn").addEventListener("click", () => openModal(null));
  $("sampleBtn").addEventListener("click", loadSample);

  // 表格内编辑/删除 + 小框"添加论文"（事件委托）
  $("boards").addEventListener("click", (e) => {
    const ed = e.target.getAttribute("data-edit");
    const del = e.target.getAttribute("data-del");
    const addId = e.target.getAttribute("data-addid");
    const addName = e.target.getAttribute("data-addname");
    if (addId) { openAddFor(addId, addName); return; }
    if (ed) { const rec = state.papers.find((x) => x.id === ed); if (rec) openModal(rec); }
    if (del) deletePaper(del);
  });

  // 添加/编辑弹窗关闭
  document.querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", closeModal));
  $("paperForm").addEventListener("submit", submitPaper);

  // 使用说明向导
  $("helpBtn").addEventListener("click", openOnboard);
  $("onboardNext").addEventListener("click", onboardNext);
  $("onboardPrev").addEventListener("click", onboardPrev);
  $("onboardSkip").addEventListener("click", () => closeOnboard(true));
  document.querySelectorAll("[data-close-onboard]").forEach((el) => el.addEventListener("click", () => closeOnboard(false)));
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------- 启动 ----------
// 兜底：任何未被捕获的 Promise 拒绝都给出可见提示，避免"点了没反应"却无任何反馈。
window.addEventListener("unhandledrejection", (e) => {
  console.error("未捕获的异步错误：", e.reason);
  toast("出错了：" + ((e.reason && e.reason.message) || e.reason || "未知错误"));
});

bind();

// 启动时若发现是直接双击 HTML 文件打开（file:// 协议），立即给出明确提示，
// 避免后续所有 API 请求都报“Failed to fetch”却不知原因。
if (typeof location !== "undefined" && location.protocol === "file:") {
  toast("请通过 http://localhost:4173 访问本页面，不要直接双击打开 HTML 文件");
}

boot();

// 首次访问自动弹出使用说明向导（之后不再打扰，可用右上角「使用说明」重看）
try {
  if (!localStorage.getItem("pt_onboarded")) setTimeout(openOnboard, 400);
} catch (e) {}
