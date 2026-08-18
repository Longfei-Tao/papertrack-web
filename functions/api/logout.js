// 退出登录：POST /api/logout  使当前 token 失效
import { getUser, json } from "../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1].trim()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(m[1].trim()).run();
  }
  return json({ ok: true });
}
