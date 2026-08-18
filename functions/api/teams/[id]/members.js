// 课题组成员管理：
//   GET    /api/teams/:id/members -> 列出成员 [{user_id, display_name, username, role}]（成员可读）
//   PUT    /api/teams/:id/members -> 修改成员角色 {uid, role}（仅 admin，不能改自己）
//   DELETE /api/teams/:id/members?uid=xxx -> 移除成员（仅 admin，不能移除自己）
import { getUser, memberRole, json } from "../../../_lib/auth.js";

export async function onRequestGet({ request, env, params }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const role = await memberRole(env.DB, u.id, params.id);
  if (!role) return json({ error: "你不是该课题组成员" }, 403);

  const { results } = await env.DB.prepare(
    `SELECT m.user_id, u.display_name, u.username, m.role
       FROM team_members m JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ? ORDER BY m.joined_at`
  ).bind(params.id).all();
  return json({ members: results || [] });
}

export async function onRequestPut({ request, env, params }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const role = await memberRole(env.DB, u.id, params.id);
  if (role !== "admin") return json({ error: "需要课题组管理员权限" }, 403);

  const body = await request.json().catch(() => ({}));
  const targetUid = body.uid;
  const newRole = body.role;
  if (!targetUid || (newRole !== "admin" && newRole !== "member")) {
    return json({ error: "参数无效（uid 与 role 必填，role 仅限 admin/member）" }, 400);
  }
  if (targetUid === u.id) return json({ error: "不能修改自己的角色（避免锁死管理员）" }, 400);

  const target = await env.DB.prepare("SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(params.id, targetUid).first();
  if (!target) return json({ error: "该成员不存在于本课题组" }, 404);

  await env.DB.prepare("UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?")
    .bind(newRole, params.id, targetUid).run();
  return json({ ok: true });
}

export async function onRequestDelete({ request, env, params }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const role = await memberRole(env.DB, u.id, params.id);
  if (role !== "admin") return json({ error: "需要课题组管理员权限" }, 403);

  const uid = new URL(request.url).searchParams.get("uid");
  if (!uid) return json({ error: "缺少 uid" }, 400);
  if (uid === u.id) return json({ error: "不能移除你自己" }, 400);

  // 若该成员是论文 owner，将其论文归属置空（保留展示名历史）
  await env.DB.prepare("UPDATE papers SET owner_id = NULL WHERE team_id = ? AND owner_id = ?")
    .bind(params.id, uid).run();
  await env.DB.prepare("DELETE FROM team_members WHERE team_id = ? AND user_id = ?").bind(params.id, uid).run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(uid).run();
  return json({ ok: true });
}
