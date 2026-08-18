// Cloudflare Pages Functions —— 课题组论文投稿进度 API（按 team_id 隔离）
// 路由：/api/papers
//   所有操作都要求"已登录且是该 team_id 的成员"，非本组成员看不到任何数据。
//   GET   列出本组论文（支持 status/owner/mine/q 过滤）
//   POST  新建论文，归属为当前登录用户（需 team_id）
//   PUT   更新；只能改自己归属的论文（课题组 admin 可改全部）
//   DELETE删除；同上

import { getUser, memberRole, json } from "../_lib/auth.js";

export const STATUSES = [
  "草稿", "已投稿", "审稿中", "返修", "接收", "拒稿", "已发表",
];

const SAMPLE = [
  { title: "基于循证的老年糖尿病患者营养干预效果研究", journal: "Journal of Advanced Nursing", impact_factor: 2.6, quartile: "Q1", status: "审稿中", submitted_at: "2026-05-12", note: "外审第二轮，预计 8 月底返回意见" },
  { title: "围手术期心理支持对术后恢复影响的随机对照试验", journal: "International Journal of Nursing Studies", impact_factor: 5.1, quartile: "Q1", status: "返修", submitted_at: "2026-03-08", note: "大修，返修截止 2026-09-01", revision_deadline: "2026-09-01" },
  { title: "社区居家养老服务满意度及其影响因素分析", journal: "BMC Nursing", impact_factor: 2.0, quartile: "Q2", status: "接收", submitted_at: "2026-02-20", note: "已接收，校样中" },
  { title: "护理本科生职业认同的纵向研究", journal: "Nurse Education Today", impact_factor: 3.0, quartile: "Q2", status: "已发表", submitted_at: "2025-11-15", note: "已 online 发表" },
];

function nowISO() { return new Date().toISOString(); }
function newId() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v) { return v === null || v === undefined ? null : String(v); }

export async function onRequest(context) {
  const { request, env } = context;
  const db = env.DB;
  const url = new URL(request.url);
  const method = request.method;

  if (!db) return json({ error: "数据库未绑定，请检查 wrangler.toml 的 d1_databases" }, 500);

  // 所有操作都要求登录
  const user = await getUser(request, env);
  if (!user) return json({ error: "请先登录" }, 401);

  const teamId = url.searchParams.get("team_id") || (await request.json().catch(() => ({}))).team_id;
  if (!teamId) return json({ error: "缺少 team_id" }, 400);

  // 必须是该团队成员
  const role = await memberRole(db, user.id, teamId);
  if (!role) return json({ error: "你不是该课题组成员，无权访问" }, 403);

  try {
    // ---------- 读取 ----------
    if (method === "GET") {
      const status = url.searchParams.get("status");
      const owner = url.searchParams.get("owner");
      const q = url.searchParams.get("q");
      const mine = url.searchParams.get("mine") === "1";

      let sql = "SELECT * FROM papers WHERE team_id = ?";
      const binds = [teamId];
      if (mine) { sql += " AND owner_id = ?"; binds.push(user.id); }
      if (status) { sql += " AND status = ?"; binds.push(status); }
      if (owner && !mine) { sql += " AND owner_name = ?"; binds.push(owner); }
      if (q) { sql += " AND (title LIKE ? OR journal LIKE ?)"; binds.push("%" + q + "%", "%" + q + "%"); }
      sql += " ORDER BY updated_at DESC";
      const { results } = await db.prepare(sql).bind(...binds).all();
      return json({ papers: results || [] });
    }

    // ---------- 新建 ----------
    if (method === "POST") {
      const body = await request.json().catch(() => ({}));

      // 载入示例数据（归属当前用户 + 当前团队）
      if (body.action === "sample") {
        for (const s of SAMPLE) {
          await db.prepare(
            `INSERT OR REPLACE INTO papers
             (id,team_id,title,journal,impact_factor,quartile,status,owner_id,owner_name,submitted_at,revision_deadline,note,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            newId(), teamId, s.title, s.journal || "", numOrNull(s.impact_factor), s.quartile || "待定",
            s.status || "草稿", user.id, user.display_name, s.submitted_at || "",
            strOrNull(s.revision_deadline), s.note || "", nowISO(), nowISO()
          ).run();
        }
        return json({ ok: true, count: SAMPLE.length });
      }

      if (!body.title || !String(body.title).trim()) return json({ error: "论文题目不能为空" }, 400);
      const id = newId();
      const now = nowISO();

      // 归属：默认当前用户；若该组 admin 显式指定了本组成员，则归属该成员（用于"在某人的小框里帮他添加"）
      let ownerId = user.id;
      let ownerName = user.display_name;
      if (role === "admin" && body.owner_id && body.owner_name) {
        const m = await db
          .prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
          .bind(teamId, body.owner_id).first();
        if (m) { ownerId = body.owner_id; ownerName = String(body.owner_name); }
      }

      await db.prepare(
        `INSERT INTO papers
         (id,team_id,title,journal,impact_factor,quartile,status,owner_id,owner_name,submitted_at,revision_deadline,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, teamId, String(body.title).trim(), strOrNull(body.journal), numOrNull(body.impact_factor),
        body.quartile || "待定", body.status || "草稿", ownerId, ownerName,
        strOrNull(body.submitted_at), strOrNull(body.revision_deadline), strOrNull(body.note), now, now
      ).run();
      return json({ ok: true, id }, 201);
    }

    // ---------- 更新 / 删除 ----------
    const id = url.searchParams.get("id") || (await request.json().catch(() => ({}))).id;
    if (!id) return json({ error: "缺少 id" }, 400);

    const existing = await db
      .prepare("SELECT id, owner_id, team_id FROM papers WHERE id = ?")
      .bind(id).first();
    if (!existing) return json({ error: "记录不存在" }, 404);
    if (existing.team_id !== teamId) return json({ error: "无权访问该记录" }, 403);

    const isOwner = existing.owner_id && existing.owner_id === user.id;
    const isAdmin = role === "admin";
    if (!isOwner && !isAdmin) return json({ error: "只能修改自己归属的论文" }, 403);

    if (method === "PUT") {
      const body = await request.json().catch(() => ({}));
      await db.prepare(
        `UPDATE papers SET
           title=?, journal=?, impact_factor=?, quartile=?, status=?,
           submitted_at=?, revision_deadline=?, note=?, updated_at=?
         WHERE id=?`
      ).bind(
        String(body.title).trim(), strOrNull(body.journal), numOrNull(body.impact_factor),
        body.quartile, body.status, strOrNull(body.submitted_at), strOrNull(body.revision_deadline),
        strOrNull(body.note), nowISO(), id
      ).run();
      return json({ ok: true });
    }

    if (method === "DELETE") {
      await db.prepare("DELETE FROM papers WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }

    return json({ error: "方法不支持" }, 405);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
