// 登录：POST /api/login  { username, password } -> { token, user, teams }
import { verifyPassword, startSession, json } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const { username, password } = await request.json().catch(() => ({}));
  if (!username || !password) return json({ error: "请输入用户名和密码" }, 400);

  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ?")
    .bind(username.trim())
    .first();
  if (!row || !(await verifyPassword(password, row.password_salt, row.password_hash))) {
    return json({ error: "用户名或密码错误" }, 401);
  }

  const { token, user, teams } = await startSession(env, row.id);
  return json({ token, user, teams });
}
