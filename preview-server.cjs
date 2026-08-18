// PaperTrack 本地预览服务（仅用于本地看界面，零依赖、零联网）
// 用法：node preview-server.cjs  然后浏览器打开 http://localhost:4173
// 注意：这是预览专用，数据存在内存里，重启即清空；真部署请用 Cloudflare 函数 + D1。
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = 4173;
const PUBLIC = path.join(__dirname, "public");

// ---------------- 内存数据库 ----------------
const db = {
  users: new Map(),    // id -> {id, username, display_name, pw}
  sessions: new Map(), // token -> {user_id, expires_at}
  teams: new Map(),    // id -> {id, name, created_by, created_at}
  members: [],         // {team_id, user_id, role, joined_at}
  invites: new Map(),  // id -> invite
  papers: new Map(),   // id -> paper
};

const nowISO = () => new Date().toISOString();
const uid = (p) => p + "_" + crypto.randomUUID().slice(0, 8);
const genCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

function seed() {
  const t = "t1";
  db.teams.set(t, { id: t, name: "李教授课题组", created_by: "u1", created_at: nowISO() });
  [
    { id: "u1", username: "admin", display_name: "我（组长）", pw: "admin123" },
    { id: "u2", username: "shijie", display_name: "师姐·小王", pw: "shijie123" },
    { id: "u3", username: "shimei", display_name: "师妹·小李", pw: "shimei123" },
  ].forEach((u) => db.users.set(u.id, u));
  db.members.push({ team_id: t, user_id: "u1", role: "admin", joined_at: nowISO() });
  db.members.push({ team_id: t, user_id: "u2", role: "member", joined_at: nowISO() });
  db.members.push({ team_id: t, user_id: "u3", role: "member", joined_at: nowISO() });
  db.invites.set("i1", { id: "i1", team_id: t, code: "LIKEY888", role: "member", max_uses: null, used_count: 0, expires_at: null, active: 1, created_by: "u1", created_at: nowISO() });
  [
    { title: "基于机器学习的某护理干预研究", journal: "Journal of Advanced Nursing", impact_factor: 3.8, quartile: "Q1", status: "审稿中", owner_id: "u1", owner_name: "我（组长）", submitted_at: "2026-05-10", revision_deadline: null },
    { title: "老年跌倒风险评估模型构建", journal: "International Journal of Nursing Studies", impact_factor: 5.2, quartile: "Q1", status: "返修", owner_id: "u2", owner_name: "师姐·小王", submitted_at: "2026-03-01", revision_deadline: "2026-08-10" },
    { title: "营养支持对术后恢复的影响", journal: "Clinical Nutrition", impact_factor: 7.1, quartile: "Q1", status: "接收", owner_id: "u2", owner_name: "师姐·小王", submitted_at: "2025-11-20", revision_deadline: null },
    { title: "某慢病管理综述", journal: "Nursing Outlook", impact_factor: 2.9, quartile: "Q2", status: "已发表", owner_id: "u3", owner_name: "师妹·小李", submitted_at: "2025-06-15", revision_deadline: null },
    { title: "移动健康在高血压管理中的应用", journal: "JMIR mHealth", impact_factor: 4.5, quartile: "Q2", status: "草稿", owner_id: "u1", owner_name: "我（组长）", submitted_at: null, revision_deadline: null },
  ].forEach((p) => {
    const id = uid("p");
    db.papers.set(id, Object.assign({ id, team_id: t, created_at: nowISO(), updated_at: nowISO(), note: "" }, p));
  });
}
seed();

// ---------------- 鉴权辅助 ----------------
const publicUser = (u) => (u ? { id: u.id, username: u.username, display_name: u.display_name } : null);
const getUserTeams = (userId) =>
  db.members.filter((m) => m.user_id === userId).map((m) => ({ id: m.team_id, name: (db.teams.get(m.team_id) || {}).name || "?", role: m.role }));
const memberRole = (userId, teamId) => {
  const m = db.members.find((x) => x.team_id === teamId && x.user_id === userId);
  return m ? m.role : null;
};
function getSessionUser(req) {
  const h = req.headers["authorization"] || "";
  const m = h.match(/^Bearer\s+(.+)$/);
  if (!m) return null;
  const s = db.sessions.get(m[1]);
  if (!s || s.expires_at < Date.now()) { if (s) db.sessions.delete(m[1]); return null; }
  return db.users.get(s.user_id) || null;
}
const startSession = (userId) => {
  const token = crypto.randomUUID();
  db.sessions.set(token, { user_id: userId, expires_at: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  return token;
};

// ---------------- 响应辅助 ----------------
const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(obj));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); } });
  });

// ---------------- 静态文件 ----------------
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC, rel)).replace(/\\/g, "/");
  const publicNormalized = PUBLIC.replace(/\\/g, "/");
  if (!filePath.startsWith(publicNormalized)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: unknown path -> index.html (so browser can route via hash/query)
      const indexPath = path.join(PUBLIC, "index.html");
      return fs.readFile(indexPath, (err2, data2) => {
        if (err2) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("404 Not Found: " + pathname); }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(data2);
      });
    }
    res.writeHead(200, { "content-type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

// ---------------- 主路由 ----------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const pathname = u.pathname;
  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  if (!pathname.startsWith("/api/")) return serveStatic(pathname, res);

  // CORS 预检：允许跨域调用（例如用户用 file:// 协议直接打开 public/index.html）
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      "access-control-max-age": "86400",
    });
    return res.end();
  }

  const user = getSessionUser(req);
  try {
    if (req.method === "GET" && pathname === "/api/me") {
      if (!user) return send(res, 401, { error: "未登录" });
      return send(res, 200, { user: publicUser(user), teams: getUserTeams(user.id) });
    }
    if (req.method === "POST" && pathname === "/api/login") {
      const b = await readBody(req);
      const u2 = [...db.users.values()].find((x) => x.username === b.username);
      if (!u2 || u2.pw !== b.password) return send(res, 401, { error: "用户名或密码错误" });
      return send(res, 200, { token: startSession(u2.id), user: publicUser(u2), teams: getUserTeams(u2.id) });
    }
    if (req.method === "POST" && pathname === "/api/logout") {
      const h = req.headers["authorization"] || "";
      const m = h.match(/^Bearer\s+(.+)$/);
      if (m) db.sessions.delete(m[1]);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && pathname === "/api/register") {
      const b = await readBody(req);
      if (!b.username || !b.displayName || !b.password) return send(res, 400, { error: "请填写完整" });
      if ([...db.users.values()].some((x) => x.username === b.username)) return send(res, 400, { error: "用户名已存在" });
      const newId = uid("u");
      db.users.set(newId, { id: newId, username: b.username, display_name: b.displayName, pw: b.password });
      let createdTeam = null, teams = [];
      if (b.mode === "create") {
        const tid = uid("t");
        db.teams.set(tid, { id: tid, name: b.teamName || "未命名课题组", created_by: newId, created_at: nowISO() });
        db.members.push({ team_id: tid, user_id: newId, role: "admin", joined_at: nowISO() });
        const code = genCode();
        db.invites.set(uid("i"), { id: uid("i"), team_id: tid, code, role: "member", max_uses: null, used_count: 0, expires_at: null, active: 1, created_by: newId, created_at: nowISO() });
        createdTeam = { id: tid, name: b.teamName || "未命名课题组", inviteCode: code };
        teams = [{ id: tid, name: b.teamName || "未命名课题组", role: "admin" }];
      } else {
        const inv = [...db.invites.values()].find((x) => x.code === (b.code || "").toUpperCase() && x.active);
        if (!inv) return send(res, 400, { error: "邀请码无效或已失效" });
        if (inv.expires_at && inv.expires_at < Date.now()) return send(res, 400, { error: "邀请码已过期" });
        if (inv.max_uses != null && inv.used_count >= inv.max_uses) return send(res, 400, { error: "邀请码已达使用上限" });
        inv.used_count++;
        db.members.push({ team_id: inv.team_id, user_id: newId, role: inv.role, joined_at: nowISO() });
        teams = [{ id: inv.team_id, name: (db.teams.get(inv.team_id) || {}).name, role: inv.role }];
      }
      return send(res, 200, { token: startSession(newId), user: publicUser(db.users.get(newId)), teams, createdTeam });
    }
    if (req.method === "PUT" && pathname === "/api/me") {
      if (!user) return send(res, 401, { error: "未登录" });
      const b = await readBody(req);
      if (user.pw !== b.oldPassword) return send(res, 400, { error: "原密码错误" });
      if (!b.newPassword || b.newPassword.length < 6) return send(res, 400, { error: "新密码至少6位" });
      user.pw = b.newPassword;
      return send(res, 200, { ok: true });
    }
    // ---- papers ----
    if (pathname === "/api/papers") {
      if (!user) return send(res, 401, { error: "未登录" });
      const teamId = u.searchParams.get("team_id");
      if (!teamId || memberRole(user.id, teamId) == null) return send(res, 403, { error: "无权访问该课题组" });
      if (req.method === "GET") {
        let list = [...db.papers.values()].filter((p) => p.team_id === teamId);
        const status = u.searchParams.get("status");
        const owner = u.searchParams.get("owner");
        const q = u.searchParams.get("q");
        const mine = u.searchParams.get("mine");
        if (status) list = list.filter((p) => p.status === status);
        if (owner) list = list.filter((p) => p.owner_name === owner);
        if (q) { const qq = q.toLowerCase(); list = list.filter((p) => (p.title || "").toLowerCase().includes(qq) || (p.journal || "").toLowerCase().includes(qq)); }
        if (mine === "1") list = list.filter((p) => p.owner_id === user.id);
        list.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
        return send(res, 200, { papers: list });
      }
      if (req.method === "POST") {
        const b = await readBody(req);
        if (b.action === "sample") {
          const samples = [
            { title: "示例论文 A：某干预效果随机对照试验", journal: "Sample Journal A", impact_factor: 4.2, quartile: "Q1", status: "审稿中", revision_deadline: null },
            { title: "示例论文 B：横断面调查研究", journal: "Sample Journal B", impact_factor: 3.1, quartile: "Q2", status: "返修", revision_deadline: "2026-08-15" },
            { title: "示例论文 C：系统综述与荟萃分析", journal: "Sample Journal C", impact_factor: 6.0, quartile: "Q1", status: "接收", revision_deadline: null },
          ];
          let count = 0;
          samples.forEach((s) => { const id = uid("p"); db.papers.set(id, Object.assign({ id, team_id: teamId, owner_id: user.id, owner_name: user.display_name, submitted_at: "2026-04-01", created_at: nowISO(), updated_at: nowISO(), note: "" }, s)); count++; });
          return send(res, 200, { count });
        }
        if (!b.title) return send(res, 400, { error: "题目不能为空" });
        const id = uid("p");
        // 归属：默认当前用户；管理员可指定本组成员
        let ownerId = user.id;
        let ownerName = user.display_name;
        if (memberRole(user.id, teamId) === "admin" && b.owner_id && b.owner_name) {
          if (db.members.some((x) => x.team_id === teamId && x.user_id === b.owner_id)) {
            ownerId = b.owner_id;
            ownerName = b.owner_name;
          }
        }
        db.papers.set(id, {
          id, team_id: teamId, title: b.title, journal: b.journal || "",
          impact_factor: b.impact_factor === "" ? null : (b.impact_factor != null ? Number(b.impact_factor) : null),
          quartile: b.quartile || "待定", status: b.status || "草稿", owner_id: ownerId, owner_name: ownerName,
          submitted_at: b.submitted_at || null, revision_deadline: b.revision_deadline || null, note: b.note || "",
          created_at: nowISO(), updated_at: nowISO(),
        });
        return send(res, 200, { ok: true });
      }
      if (req.method === "PUT") {
        const id = u.searchParams.get("id");
        const p = db.papers.get(id);
        if (!p || p.team_id !== teamId) return send(res, 404, { error: "论文不存在" });
        if (memberRole(user.id, teamId) !== "admin" && p.owner_id !== user.id) return send(res, 403, { error: "只能修改自己的论文" });
        const b = await readBody(req);
        Object.assign(p, {
          title: b.title ?? p.title, journal: b.journal ?? p.journal,
          impact_factor: b.impact_factor === "" ? null : (b.impact_factor != null ? Number(b.impact_factor) : p.impact_factor),
          quartile: b.quartile ?? p.quartile, status: b.status ?? p.status,
          submitted_at: b.submitted_at ?? p.submitted_at, revision_deadline: b.revision_deadline ?? p.revision_deadline,
          note: b.note ?? p.note, updated_at: nowISO(),
        });
        return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        const id = u.searchParams.get("id");
        const p = db.papers.get(id);
        if (!p || p.team_id !== teamId) return send(res, 404, { error: "论文不存在" });
        if (memberRole(user.id, teamId) !== "admin" && p.owner_id !== user.id) return send(res, 403, { error: "只能删除自己的论文" });
        db.papers.delete(id);
        return send(res, 200, { ok: true });
      }
    }
    // ---- team members ----
    let m;
    if ((m = pathname.match(/^\/api\/teams\/([^/]+)\/members$/))) {
      if (!user) return send(res, 401, { error: "未登录" });
      const teamId = decodeURIComponent(m[1]);
      if (memberRole(user.id, teamId) == null) return send(res, 403, { error: "无权访问" });
      if (req.method === "GET") {
        const list = db.members.filter((x) => x.team_id === teamId).map((x) => { const uu = db.users.get(x.user_id); return { user_id: x.user_id, display_name: uu ? uu.display_name : "?", username: uu ? uu.username : "?", role: x.role }; });
        return send(res, 200, { members: list });
      }
      if (req.method === "PUT") {
        if (memberRole(user.id, teamId) !== "admin") return send(res, 403, { error: "仅管理员可修改成员角色" });
        const b = await readBody(req);
        const targetUid = b.uid;
        const newRole = b.role;
        if (!targetUid || (newRole !== "admin" && newRole !== "member")) return send(res, 400, { error: "参数无效" });
        if (targetUid === user.id) return send(res, 400, { error: "不能修改自己的角色" });
        const rec = db.members.find((x) => x.team_id === teamId && x.user_id === targetUid);
        if (!rec) return send(res, 404, { error: "该成员不存在" });
        rec.role = newRole;
        return send(res, 200, { ok: true });
      }
      if (req.method === "DELETE") {
        if (memberRole(user.id, teamId) !== "admin") return send(res, 403, { error: "仅管理员可移除成员" });
        const uidDel = u.searchParams.get("uid");
        if (uidDel === user.id) return send(res, 400, { error: "不能移除自己" });
        const idx = db.members.findIndex((x) => x.team_id === teamId && x.user_id === uidDel);
        if (idx >= 0) db.members.splice(idx, 1);
        [...db.papers.values()].forEach((p) => { if (p.team_id === teamId && p.owner_id === uidDel) { p.owner_id = null; p.owner_name = "(已移除)"; } });
        return send(res, 200, { ok: true });
      }
    }
    // ---- team invites ----
    if ((m = pathname.match(/^\/api\/teams\/([^/]+)\/invites$/))) {
      if (!user) return send(res, 401, { error: "未登录" });
      const teamId = decodeURIComponent(m[1]);
      if (memberRole(user.id, teamId) == null) return send(res, 403, { error: "无权访问" });
      if (req.method === "GET") {
        return send(res, 200, { invites: [...db.invites.values()].filter((x) => x.team_id === teamId) });
      }
      if (req.method === "POST") {
        if (memberRole(user.id, teamId) !== "admin") return send(res, 403, { error: "仅管理员可生成邀请码" });
        const b = await readBody(req);
        const code = genCode();
        const id = uid("i");
        db.invites.set(id, { id, team_id: teamId, code, role: b.role || "member", max_uses: b.maxUses != null ? Number(b.maxUses) : null, used_count: 0, expires_at: null, active: 1, created_by: user.id, created_at: nowISO() });
        return send(res, 200, { code });
      }
    }
    return send(res, 404, { error: "接口不存在" });
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
});

server.listen(PORT, () => console.log("PaperTrack 预览已启动： http://localhost:" + PORT));
