// PaperTrack 端到端自动化测试
// 用法：node tests/e2e.cjs
// 覆盖：注册 -> 登录 -> 添加/编辑/删除论文 -> 成员/邀请码管理 -> 退出
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

let server;
let pass = 0;
let fail = 0;
const errors = [];

function log(msg) { console.log(`[TEST] ${msg}`); }

async function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(__dirname, "..", "preview-server.cjs")], {
      cwd: path.join(__dirname, ".."),
      stdio: "pipe",
    });
    server.on("error", reject);
    server.stderr.on("data", (d) => console.error("[SERVER] " + d.toString().trim()));

    const check = () => {
      fetch(`${BASE}/`).then((r) => {
        if (r.status === 200) return resolve();
        setTimeout(check, 200);
      }).catch(() => setTimeout(check, 200));
    };
    setTimeout(check, 300);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    server.on("close", resolve);
    server.kill();
    setTimeout(() => { try { server.kill("SIGKILL"); } catch (e) {} }, 2000);
  });
}

async function assert(name, fn) {
  try {
    await fn();
    pass++;
    log(`✅ ${name}`);
  } catch (e) {
    fail++;
    errors.push({ name, error: e.message });
    log(`❌ ${name}: ${e.message}`);
  }
}

// ===================== API 层测试 =====================
let apiToken = "";
let teamId = "";
let paperId = "";
let inviteCode = "";

async function apiRegister() {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "create",
      teamName: "测试课题组",
      username: "testadmin",
      displayName: "测试管理员",
      password: "123456",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `status ${res.status}`);
  if (!data.token || !data.createdTeam?.inviteCode) throw new Error("返回字段不完整");
  apiToken = data.token;
  teamId = data.teams[0].id;
  inviteCode = data.createdTeam.inviteCode;
}

async function apiMe() {
  const res = await fetch(`${BASE}/api/me`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  if (data.user.username !== "testadmin") throw new Error("用户不匹配");
}

async function apiAddPaper() {
  const res = await fetch(`${BASE}/api/papers?team_id=${teamId}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({
      title: "测试论文题目",
      journal: "Test Journal",
      impact_factor: "5.0",
      quartile: "Q1",
      status: "审稿中",
      submitted_at: "2026-08-01",
      revision_deadline: "2026-09-01",
      note: "测试备注",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
}

async function apiListPapers() {
  const res = await fetch(`${BASE}/api/papers?team_id=${teamId}`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  if (!data.papers || data.papers.length !== 1) throw new Error(`论文数量不对: ${data.papers?.length}`);
  paperId = data.papers[0].id;
}

async function apiUpdatePaper() {
  const res = await fetch(`${BASE}/api/papers?id=${paperId}&team_id=${teamId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ title: "修改后的论文题目", status: "接收" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
}

async function apiDeletePaper() {
  const res = await fetch(`${BASE}/api/papers?id=${paperId}&team_id=${teamId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
}

async function apiMembers() {
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(teamId)}/members`, {
    headers: { authorization: `Bearer ${apiToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  if (data.members.length !== 1 || data.members[0].role !== "admin") throw new Error("成员信息不对");
}

async function apiInvite() {
  const res = await fetch(`${BASE}/api/teams/${encodeURIComponent(teamId)}/invites`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiToken}` },
    body: JSON.stringify({ role: "member" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  if (!data.code || data.code.length !== 8) throw new Error("邀请码格式不对");
}

async function apiJoinByInvite() {
  const res = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "join",
      code: inviteCode,
      username: "testmember",
      displayName: "测试成员",
      password: "123456",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `status ${res.status}`);
  if (!data.token || data.teams.length !== 1) throw new Error("加入后返回字段不完整");
}

async function apiLogout() {
  const res = await fetch(`${BASE}/api/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${apiToken}` },
  });
  if (!res.ok) throw new Error("退出失败");
}

// ===================== UI 层测试（jsdom） =====================
async function uiTest() {
  const { JSDOM } = require("jsdom");
  let html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  // 去掉原 <script src="./app.js"></script>，测试里手动 eval，避免 jsdom 外部脚本加载不稳定
  html = html.replace(/<script[^>]*src=["']\.\/app\.js["'][^>]*><\/script>/, "");

  const storage = {};
  const dom = new JSDOM(html, {
    url: `${BASE}/`,
    contentType: "text/html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      // jsdom 里 Node 原生 fetch 不会用 window.location 解析相对路径，
      // 这里把 /api/xxx 统一补全为 http://localhost:4173/api/xxx
      window.fetch = (input, init) => {
        if (typeof input === "string" && input.startsWith("/")) {
          input = `${BASE}${input}`;
        }
        return fetch(input, init);
      };
      window.localStorage = {
        getItem(k) { return storage[k] ?? null; },
        setItem(k, v) { storage[k] = String(v); },
        removeItem(k) { delete storage[k]; },
      };
      window.confirm = () => true;
      window.alert = () => {};
    },
  });

  const win = dom.window;
  const doc = win.document;

  // 手动加载并执行 app.js
  const appCode = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  win.eval(appCode);

  // 等待 boot 里的异步请求结束
  await new Promise((r) => setTimeout(r, 600));

  // 确认 app.js 已执行
  if (typeof win.openReg !== "function") {
    throw new Error("app.js 未加载完成");
  }

  // 辅助函数
  const $ = (id) => doc.getElementById(id);
  const click = (id) => {
    const el = $(id);
    if (!el) throw new Error(`元素 #${id} 不存在`);
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  };
  const fill = (id, val) => {
    const el = $(id);
    if (!el) throw new Error(`输入框 #${id} 不存在`);
    el.value = val;
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  };
  const submit = (id) => {
    const el = $(id);
    if (!el) throw new Error(`表单 #${id} 不存在`);
    const ev = new win.Event("submit", { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  };

  // 1. 打开注册弹窗
  click("regBtn");
  if ($("regModal").classList.contains("hidden")) throw new Error("注册弹窗未打开");

  // 2. 填写并提交注册（直接调用处理函数，避免 jsdom 里 form submit 默认行为干扰）
  fill("regTeamName", "UI测试组");
  fill("regUsername", "uiadmin");
  fill("regName", "UI管理员");
  fill("regPass", "123456");
  if (typeof win.submitReg !== "function") throw new Error("submitReg 未绑定");
  win.submitReg({ preventDefault() {} });

  // 等待异步注册完成
  await new Promise((r) => setTimeout(r, 800));

  if ($("regModal").classList.contains("hidden") === false) {
    // 打印调试信息
    console.error("DEBUG regModal classes:", $("regModal").className);
    console.error("DEBUG userMenu hidden:", $("userMenu").classList.contains("hidden"));
    console.error("DEBUG toast:", $("toast")?.textContent);
    throw new Error("注册成功后弹窗未关闭");
  }
  if ($("userMenu").classList.contains("hidden")) throw new Error("登录后未显示用户菜单");
  if ($("userBtn").textContent.indexOf("UI管理员") === -1) throw new Error("右上角未显示姓名");

  // 3. 添加论文
  click("addBtn");
  if ($("modal").classList.contains("hidden")) throw new Error("添加论文弹窗未打开");
  fill("f_title", "UI测试论文");
  fill("f_journal", "UI Journal");
  fill("f_impact_factor", "4.5");
  fill("f_status", "审稿中");
  submit("paperForm");

  await new Promise((r) => setTimeout(r, 600));
  if ($("modal").classList.contains("hidden") === false) throw new Error("添加论文后弹窗未关闭");

  const boards = $("boards");
  if (!boards.textContent.includes("UI测试论文")) throw new Error("论文未出现在看板中");

  // 4. 点击编辑
  const editBtn = boards.querySelector('[data-edit]');
  if (!editBtn) throw new Error("找不到编辑按钮");
  editBtn.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  if ($("modal").classList.contains("hidden")) throw new Error("编辑弹窗未打开");
  fill("f_title", "UI测试论文-已修改");
  fill("f_status", "接收");
  submit("paperForm");
  await new Promise((r) => setTimeout(r, 600));
  if (!boards.textContent.includes("UI测试论文-已修改")) throw new Error("修改后的论文未显示");

  // 5. 删除论文
  const delBtn = boards.querySelector('[data-del]');
  if (!delBtn) throw new Error("找不到删除按钮");
  // 用 confirm 的替代：直接调用 deletePaper（jsdom 里 confirm 默认返回 false）
  const paperIdToDelete = delBtn.getAttribute("data-del");
  await win.deletePaper(paperIdToDelete);
  await new Promise((r) => setTimeout(r, 600));
  if (boards.textContent.includes("UI测试论文-已修改")) throw new Error("删除后论文仍在看板中");

  // 6. 打开课题组管理
  click("userBtn");
  const teamAction = doc.querySelector('[data-act="team"]');
  if (!teamAction || teamAction.classList.contains("hidden")) throw new Error("课题组管理入口未显示");
  teamAction.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  if ($("teamModal").classList.contains("hidden")) throw new Error("课题组管理弹窗未打开");
  if (!$("teamMemberCount").textContent.includes("1")) throw new Error("成员数不对");

  // 7. 生成邀请码
  click("genInviteBtn");
  await new Promise((r) => setTimeout(r, 500));
  const inviteCodeEl = $("inviteList").querySelector(".invite-code");
  if (!inviteCodeEl || inviteCodeEl.textContent.length !== 8) throw new Error("邀请码未生成");

  // 关闭弹窗
  doc.querySelector('[data-close-team]').dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  // 8. 退出登录
  click("userBtn");
  const logoutAction = doc.querySelector('[data-act="logout"]');
  if (!logoutAction) throw new Error("找不到退出按钮");
  logoutAction.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 400));
  if ($("loginBtn").classList.contains("hidden")) throw new Error("退出后未回到登录按钮状态");

  dom.window.close();
}

// ===================== 主流程 =====================
async function main() {
  log("启动预览服务...");
  await startServer();
  log(`预览服务已就绪：${BASE}`);

  // API 测试
  await assert("API: 创建课题组并注册", apiRegister);
  await assert("API: 获取当前用户", apiMe);
  await assert("API: 添加论文", apiAddPaper);
  await assert("API: 列出论文", apiListPapers);
  await assert("API: 修改论文", apiUpdatePaper);
  await assert("API: 删除论文", apiDeletePaper);
  await assert("API: 查看成员", apiMembers);
  await assert("API: 生成邀请码", apiInvite);
  await assert("API: 凭邀请码加入", apiJoinByInvite);
  await assert("API: 退出登录", apiLogout);

  // UI 测试
  await assert("UI: 完整流程（注册/增删改论文/课题组管理/退出）", uiTest);

  log("\n测试结束");
  log(`通过：${pass}，失败：${fail}`);
  if (errors.length) {
    console.error("\n失败明细：");
    errors.forEach((e) => console.error(`  - ${e.name}: ${e.error}`));
  }

  await stopServer();
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("测试异常：", e);
  stopServer().finally(() => process.exit(1));
});