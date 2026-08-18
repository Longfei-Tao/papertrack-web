// 我加入的课题组：GET /api/teams -> [{id, name, role}]
import { getUser, getUserTeams, json } from "../_lib/auth.js";

export async function onRequestGet({ request, env }) {
  const u = await getUser(request, env);
  if (!u) return json({ error: "未登录" }, 401);
  const teams = await getUserTeams(env.DB, u.id);
  return json({ teams });
}
