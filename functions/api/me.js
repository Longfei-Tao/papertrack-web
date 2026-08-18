// 当前用户：GET /api/me -> { user, teams } ; 修改密码：PUT /api/me { oldPassword, newPassword }
import { getUser, verifyPassword, hashPassword, genSaltHex, publicUser, getUserTeams, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const teams = await getUserTeams(env.DB, u.id);
  return json({ user: publicUser(u), teams });
}

export async function onRequestPut({ request, env }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);

  const { oldPassword, newPassword } = await request.json().catch(() => ({}));
  if (!oldPassword || !newPassword) return json({ error: "请输入原密码和新密码" }, 400);
  if (String(newPassword).length < 6) return json({ error: "新密码至少 6 位" }, 400);

  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
  if (!(await verifyPassword(oldPassword, row.password_salt, row.password_hash))) {
    return json({ error: "原密码错误" }, 400);
  }
  const salt = genSaltHex();
  const hash = await hashPassword(newPassword, salt);
  await env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
    .bind(hash, salt, u.id)
    .run();
  return json({ ok: true });
}
