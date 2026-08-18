// 自助注册：POST /api/register
//   { mode:'create', teamName, username, displayName, password }  -> 创建课题组，自己当 admin，并生成一条成员邀请码
//   { mode:'join',   code,      username, displayName, password }  -> 凭邀请码加入对应课题组
import { verifyPassword, hashPassword, genSaltHex, startSession, json } from "../_lib/auth.js";

const INVITE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去除易混字符 I O 0 1

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
}

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

export async function onRequestPost({ request, env }) {
  const db = env.DB;
  if (!db) return json({ error: "数据库未绑定" }, 500);

  const body = await request.json().catch(() => ({}));
  const mode = body.mode;
  const username = (body.username || "").trim();
  const displayName = (body.displayName || "").trim();
  const password = body.password || "";

  if (!username || !password) return json({ error: "用户名和密码必填" }, 400);
  if (String(password).length < 6) return json({ error: "密码至少 6 位" }, 400);
  if (!displayName) return json({ error: "请填写显示名（即负责人名）" }, 400);

  const exists = await db.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
  if (exists) return json({ error: "用户名已存在" }, 409);

  const salt = genSaltHex();
  const hash = await hashPassword(password, salt);
  const userId = newId();
  const now = new Date().toISOString();

  // 创建用户
  await db
    .prepare(
      `INSERT INTO users (id, username, display_name, password_hash, password_salt, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(userId, username, displayName, hash, salt, now)
    .run();

  if (mode === "create") {
    const teamName = (body.teamName || "").trim();
    if (!teamName) return json({ error: "请填写课题组名称" }, 400);

    const teamId = newId();
    await db
      .prepare("INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)")
      .bind(teamId, teamName, userId, now)
      .run();
    await db
      .prepare("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, 'admin', ?)")
      .bind(teamId, userId, now)
      .run();
    // 默认生成一条"成员"邀请码，方便立刻发给师姐/师妹/导师
    const code = await genInviteCode(db);
    await db
      .prepare(
        `INSERT INTO invite_codes (id, team_id, code, role, max_uses, used_count, expires_at, active, created_by, created_at)
         VALUES (?, ?, ?, 'member', NULL, 0, NULL, 1, ?, ?)`
      )
      .bind(newId(), teamId, code, userId, now)
      .run();

    const { token, user, teams } = await startSession(env, userId);
    return json({ token, user, teams, createdTeam: { id: teamId, name: teamName, inviteCode: code } });
  }

  if (mode === "join") {
    const code = (body.code || "").trim().toUpperCase();
    if (!code) return json({ error: "请填写邀请码" }, 400);
    const inv = await db.prepare("SELECT * FROM invite_codes WHERE code = ?").bind(code).first();
    if (!inv || !inv.active) return json({ error: "邀请码无效或已作废" }, 400);
    if (inv.expires_at && inv.expires_at < Date.now()) return json({ error: "邀请码已过期" }, 400);
    if (inv.max_uses != null && inv.used_count >= inv.max_uses) return json({ error: "邀请码使用次数已达上限" }, 400);

    await db
      .prepare("INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)")
      .bind(inv.team_id, userId, inv.role || "member", now)
      .run();
    await db.prepare("UPDATE invite_codes SET used_count = used_count + 1 WHERE id = ?").bind(inv.id).run();

    const { token, user, teams } = await startSession(env, userId);
    return json({ token, user, teams });
  }

  return json({ error: "mode 只能是 create 或 join" }, 400);
}
