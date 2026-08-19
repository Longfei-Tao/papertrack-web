// 邀请码管理（按团队）：
//   GET  /api/teams/:id/invites  -> 列出本组邀请码（仅 admin；普通成员不可见，防其拿到管理员邀请码自行升级）
//   POST /api/teams/:id/invites  -> 新建邀请码（仅 admin）
//        body: { role?:'member'|'admin', maxUses?:number|null, expiresInDays?:number|null }
import { getUser, memberRole, genSaltHex, json } from "../../../_lib/auth.js";

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}
const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
async function genInviteCode(db) {
  for (let i = 0; i < 8; i++) {
    let code = "";
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    for (let j = 0; j < 8; j++) code += INVITE_CHARS[bytes[j] % INVITE_CHARS.length];
    const exists = await db.prepare("SELECT id FROM invite_codes WHERE code = ?").bind(code).first();
    if (!exists) return code;
  }
  return "CODE" + Date.now().toString(36).toUpperCase();
}

export async function onRequestGet({ request, env, params }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const role = await memberRole(env.DB, u.id, params.id);
  if (role !== "admin") return json({ error: "需要课题组管理员权限" }, 403);

  const { results } = await env.DB.prepare(
    `SELECT id, code, role, max_uses, used_count, expires_at, active, created_at
       FROM invite_codes WHERE team_id = ? ORDER BY created_at DESC`
  ).bind(params.id).all();
  return json({ invites: results || [] });
}

export async function onRequestPost({ request, env, params }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const role = await memberRole(env.DB, u.id, params.id);
  if (role !== "admin") return json({ error: "需要课题组管理员权限" }, 403);

  const { role: newRole, maxUses, expiresInDays } = await request.json().catch(() => ({}));
  const inviteRole = newRole === "admin" ? "admin" : "member";
  const max = maxUses === null || maxUses === undefined || maxUses === "" ? null : Number(maxUses);
  if (max != null && (!Number.isFinite(max) || max < 1)) return json({ error: "使用次数不合法" }, 400);
  const expires = expiresInDays && Number(expiresInDays) > 0
    ? Date.now() + Number(expiresInDays) * 86400000
    : null;

  const code = await genInviteCode(env.DB);
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO invite_codes (id, team_id, code, role, max_uses, used_count, expires_at, active, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`
  ).bind(newId(), params.id, code, inviteRole, max, expires, u.id, now).run();

  return json({ ok: true, code, role: inviteRole });
}
