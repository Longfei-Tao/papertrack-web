// Cloudflare Pages Functions —— 课题组论文投稿进度 API（按 team_id 隔离）
// 路由：/api/papers
//   所有操作都要求"已登录且是该 team_id 的成员"，非本组成员看不到任何数据。
//   GET   列出本组论文（支持 status/owner/mine/q 过滤）
//   POST  新建论文，归属为当前登录用户（需 team_id）
//   PUT   更新；只能改自己归属的论文（课题组 admin 可改全部）
//   DELETE删除；同上

import { getUser, memberRole, json } from "../_lib/auth.js";

// SCI 英文期刊投稿进度的中文名 + 英文对照（更贴合课题组投英文刊的习惯）
export const STATUSES = [
  "草稿", "已投稿", "编辑处理中", "审稿中", "决定中", "返修", "接收", "拒稿", "已发表",
];
export const STATUS_EN = {
  "草稿": "Draft",
  "已投稿": "Submitted",
  "编辑处理中": "With Editor",
  "审稿中": "Under Review",
  "决定中": "Decision in Process",
  "返修": "Revision",
  "接收": "Accepted",
  "拒稿": "Rejected",
  "已发表": "Published",
};
// 枚举白名单：status / quartile 只接受这些值，其余一律拒绝（防注入任意字符串到前端 class 等位置）
export const QUARTILES = ["Q1", "Q2", "Q3", "Q4", "待定"];

const SAMPLE = [
  { title: "基于循证的老年糖尿病患者营养干预效果研究", journal: "Journal of Advanced Nursing", first_author: "张明", corresponding_author: "李教授", impact_factor: 2.6, quartile: "Q1", status: "审稿中", submitted_at: "2026-05-12", note: "外审第二轮，预计 8 月底返回意见" },
  { title: "围手术期心理支持对术后恢复影响的随机对照试验", journal: "International Journal of Nursing Studies", first_author: "李华", corresponding_author: "王教授", impact_factor: 5.1, quartile: "Q1", status: "返修", submitted_at: "2026-03-08", note: "大修，返修截止 2026-09-01", revision_deadline: "2026-09-01" },
  { title: "社区居家养老服务满意度及其影响因素分析", journal: "BMC Nursing", first_author: "王芳", corresponding_author: "李教授", impact_factor: 2.0, quartile: "Q2", status: "接收", submitted_at: "2026-02-20", note: "已接收，校样中" },
  { title: "护理本科生职业认同的纵向研究", journal: "Nurse Education Today", first_author: "陈静", corresponding_author: "王教授", impact_factor: 3.0, quartile: "Q2", status: "已发表", submitted_at: "2025-11-15", note: "已 online 发表" },
];

function nowISO() { return new Date().toISOString(); }
function newId() { return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2); }
function numOrNull(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v) { return v === null || v === undefined ? null : String(v); }

// 记录一次状态变更到 paper_status_log（新库建表后可用；若表不存在则静默跳过，不影响主流程）
async function logStatus(db, paperId, teamId, fromStatus, toStatus, note, actorId, actorName, at) {
  try {
    await db.prepare(
      `INSERT INTO paper_status_log
       (id, paper_id, team_id, from_status, to_status, note, actor_id, actor_name, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    ).bind(newId(), paperId, teamId, fromStatus == null ? null : String(fromStatus),
      toStatus == null ? null : String(toStatus), strOrNull(note),
      actorId, actorName, at).run();
  } catch (e) {
    // 旧库尚未建 paper_status_log 表时，忽略错误，保证主流程（增改论文）不受影响
  }
}

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
      // 一并返回每篇论文的状态变更时间线（便于前端在卡片中展示）
      const papers = results || [];
      for (const p of papers) {
        const log = await db
          .prepare("SELECT from_status, to_status, note, actor_name, created_at FROM paper_status_log WHERE paper_id = ? ORDER BY created_at ASC")
          .bind(p.id).all();
        p.status_log = (log.results || []).map((r) => ({
          from: r.from_status, to: r.to_status, note: r.note || "",
          actor: r.actor_name, at: r.created_at,
        }));
      }
      return json({ papers });
    }

    // ---------- 新建 ----------
    if (method === "POST") {
      const body = await request.json().catch(() => ({}));

      // 载入示例数据（归属当前用户 + 当前团队）
      if (body.action === "sample") {
        for (const s of SAMPLE) {
          const sid = newId();
          await db.prepare(
            `INSERT OR REPLACE INTO papers
             (id,team_id,title,journal,first_author,corresponding_author,impact_factor,quartile,status,owner_id,owner_name,submitted_at,revision_deadline,note,created_at,updated_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
          ).bind(
            sid, teamId, s.title, s.journal || "", strOrNull(s.first_author), strOrNull(s.corresponding_author), numOrNull(s.impact_factor), s.quartile || "待定",
            s.status || "草稿", user.id, user.display_name, s.submitted_at || "",
            strOrNull(s.revision_deadline), s.note || "", nowISO(), nowISO()
          ).run();
          await logStatus(db, sid, teamId, null, s.status || "草稿", s.note || "", user.id, user.display_name, nowISO());
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

      const status = body.status || "草稿";
      const quartile = body.quartile || "待定";
      if (!STATUSES.includes(status)) return json({ error: "投稿进度不合法" }, 400);
      if (!QUARTILES.includes(quartile)) return json({ error: "JCR分区不合法" }, 400);
      await db.prepare(
        `INSERT INTO papers
         (id,team_id,title,journal,first_author,corresponding_author,impact_factor,quartile,status,owner_id,owner_name,submitted_at,revision_deadline,note,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        id, teamId, String(body.title).trim(), strOrNull(body.journal), strOrNull(body.first_author), strOrNull(body.corresponding_author),
        numOrNull(body.impact_factor),
        quartile, status, ownerId, ownerName,
        strOrNull(body.submitted_at), strOrNull(body.revision_deadline), strOrNull(body.note), now, now
      ).run();
      // 新论文：记录初始状态到时间线
      await logStatus(db, id, teamId, null, status, body.note || "", user.id, user.display_name, now);
      return json({ ok: true, id }, 201);
    }

    // ---------- 更新 / 删除 ----------
    // id 只从 URL 参数读取，避免先消费了 request body 导致后面 PUT 读不到数据
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "缺少 id" }, 400);

    const existing = await db
      .prepare("SELECT * FROM papers WHERE id = ?")
      .bind(id).first();
    if (!existing) return json({ error: "记录不存在" }, 404);
    if (existing.team_id !== teamId) return json({ error: "无权访问该记录" }, 403);

    const isOwner = existing.owner_id && existing.owner_id === user.id;
    const isAdmin = role === "admin";
    if (!isOwner && !isAdmin) return json({ error: "只能修改自己归属的论文" }, 403);

    if (method === "PUT") {
      const body = await request.json().catch(() => ({}));
      // 枚举白名单校验：status / quartile 只接受预定义值（防注入任意字符串）
      if (body.status != null && !STATUSES.includes(body.status)) return json({ error: "投稿进度不合法" }, 400);
      if (body.quartile != null && !QUARTILES.includes(body.quartile)) return json({ error: "JCR分区不合法" }, 400);
      const newStatus = body.status != null ? body.status : existing.status;
      const newQuartile = body.quartile != null ? body.quartile : existing.quartile;
      await db.prepare(
        `UPDATE papers SET
           title=?, journal=?, first_author=?, corresponding_author=?, impact_factor=?, quartile=?, status=?,
           submitted_at=?, revision_deadline=?, note=?, updated_at=?
         WHERE id=?`
      ).bind(
        // 未传的字段回退为原值，避免把数据静默清空 / 改成 "undefined"
        body.title != null ? String(body.title).trim() : existing.title,
        body.journal != null ? strOrNull(body.journal) : existing.journal,
        body.first_author != null ? strOrNull(body.first_author) : existing.first_author,
        body.corresponding_author != null ? strOrNull(body.corresponding_author) : existing.corresponding_author,
        body.impact_factor !== undefined ? numOrNull(body.impact_factor) : existing.impact_factor,
        newQuartile, newStatus,
        body.submitted_at != null ? strOrNull(body.submitted_at) : existing.submitted_at,
        body.revision_deadline != null ? strOrNull(body.revision_deadline) : existing.revision_deadline,
        body.note != null ? strOrNull(body.note) : existing.note,
        nowISO(), id
      ).run();
      // 状态发生变化时，记入时间线（说明优先取本次"状态变更说明"，其次备注）
      if (newStatus !== existing.status) {
        const logNote = (body.status_note && String(body.status_note).trim()) || (body.note && body.note !== existing.note ? body.note : "");
        await logStatus(db, id, teamId, existing.status, newStatus, logNote, user.id, user.display_name, nowISO());
      }
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
