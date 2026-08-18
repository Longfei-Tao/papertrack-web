// 共享鉴权工具（Cloudflare Pages Functions）
// 放在 _lib 目录：以 _ 开头的目录不会被当作路由。

export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export function genSaltHex() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
}

export function genTokenHex() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

// PBKDF2-SHA256，100000 次，256 位输出。与本地 _genseed.mjs 完全一致。
export async function hashPassword(password, saltHex) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: hexToBytes(saltHex), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

export async function verifyPassword(password, saltHex, expectedHex) {
  const h = await hashPassword(password, saltHex);
  if (h.length !== expectedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ expectedHex.charCodeAt(i);
  return diff === 0;
}

// 从 Authorization: Bearer <token> 解析并校验当前用户（检查会话是否过期）
export async function getUser(request, env) {
  const auth = request.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1].trim();
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, Date.now())
    .first();
  return row || null;
}

// 去掉密码相关字段，返回给前端
export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
  };
}

// 用户在某个团队中的角色：'admin' / 'member' / null（非成员）
export async function memberRole(db, userId, teamId) {
  if (!userId || !teamId) return null;
  const row = await db
    .prepare("SELECT role FROM team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .first();
  return row ? row.role : null;
}

// 列出某用户加入的所有团队 [{id, name, role}]
export async function getUserTeams(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT t.id, t.name, m.role
         FROM team_members m JOIN teams t ON t.id = m.team_id
        WHERE m.user_id = ?
        ORDER BY m.joined_at`
    )
    .bind(userId)
    .all();
  return results || [];
}

// 登录成功后：建会话并返回 { token, user, teams }
export async function startSession(env, userId) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first();
  const token = genTokenHex();
  const expires = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 天
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(token, userId, expires)
    .run();
  const teams = await getUserTeams(env.DB, userId);
  return { token, user: publicUser(row), teams };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
    status,
  });
}
