-- PaperTrack Web 数据库结构（Cloudflare D1 / SQLite）
-- 多团队 + 邀请码 + 自助注册。部署后执行：wrangler d1 execute papertrack --file=./schema.sql
-- 说明：不再内置全局管理员种子。第一个使用者通过「创建课题组」自动成为该组 admin。

-- ============ 用户表（全局，角色按团队在 team_members 中记录） ============
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,        -- 登录用户名
  display_name  TEXT NOT NULL,               -- 显示名（即论文里的"负责人"）
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- ============ 登录会话表 ============
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at INTEGER NOT NULL               -- 毫秒时间戳
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ============ 课题组表 ============
CREATE TABLE IF NOT EXISTS teams (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,                 -- 课题组名称，如"李教授课题组"
  created_by TEXT,                          -- 创建者用户 id
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);

-- ============ 课题组成员表（角色按团队记录） ============
CREATE TABLE IF NOT EXISTS team_members (
  team_id   TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  role      TEXT NOT NULL DEFAULT 'member', -- admin / member
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id);
CREATE INDEX IF NOT EXISTS idx_tm_team ON team_members(team_id);

-- ============ 邀请码表 ============
CREATE TABLE IF NOT EXISTS invite_codes (
  id         TEXT PRIMARY KEY,
  team_id    TEXT NOT NULL,
  code       TEXT NOT NULL UNIQUE,          -- 邀请码（发给他人自助注册用）
  role       TEXT NOT NULL DEFAULT 'member',-- 凭此码注册后获得的角色
  max_uses   INTEGER,                       -- 最多使用次数；NULL = 不限
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,                       -- 过期时间（毫秒）；NULL = 不过期
  active     INTEGER NOT NULL DEFAULT 1,    -- 0 = 已作废
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_code ON invite_codes(code);

-- ============ 论文表（归属到具体课题组 team_id） ============
-- 注：impact_factor / submitted_at / revision_deadline 仍保留在库中（旧数据不删），
--     前端已不再展示与采集，仅 first_author 为新增列。
CREATE TABLE IF NOT EXISTS papers (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL,          -- 所属课题组
  title             TEXT NOT NULL,          -- 论文题目
  journal           TEXT,                   -- 期刊名称
  first_author      TEXT,                   -- 第一作者（2026-08 新增）
  corresponding_author TEXT,                -- 通讯作者（2026-08 新增）
  impact_factor     REAL,                   -- 影响因子 IF（界面已隐藏，数据保留）
  quartile          TEXT,                   -- 分区：Q1 / Q2 / Q3 / Q4 / 待定
  status            TEXT,                   -- 投稿进度（SCI 流程：草稿/已投稿/编辑处理中/审稿中/决定中/返修/接收/拒稿/已发表）
  owner_id          TEXT,                   -- 归属用户 id（谁的文章）
  owner_name        TEXT,                   -- 归属用户显示名（冗余，便于展示）
  submitted_at      TEXT,                   -- 投稿时间 (YYYY-MM-DD)（界面已隐藏，数据保留）
  revision_deadline TEXT,                   -- 返修截止日期 (YYYY-MM-DD)，可选（界面已隐藏，数据保留）
  note              TEXT,                   -- 备注
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_papers_team    ON papers(team_id);
CREATE INDEX IF NOT EXISTS idx_papers_status  ON papers(status);
CREATE INDEX IF NOT EXISTS idx_papers_owner   ON papers(owner_id);
CREATE INDEX IF NOT EXISTS idx_papers_updated ON papers(updated_at DESC);

-- ============ 论文状态变更时间线（记录每次状态/备注变更，便于追溯） ============
CREATE TABLE IF NOT EXISTS paper_status_log (
  id         TEXT PRIMARY KEY,
  paper_id   TEXT NOT NULL,                 -- 对应 papers.id
  team_id    TEXT NOT NULL,                 -- 冗余，便于按组查询
  from_status TEXT,                         -- 变更前状态（新建时为空）
  to_status   TEXT,                         -- 变更后状态
  note       TEXT,                          -- 本次备注/变更说明
  actor_id   TEXT,                          -- 操作人用户 id
  actor_name TEXT,                          -- 操作人显示名（冗余）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_psl_paper ON paper_status_log(paper_id);
CREATE INDEX IF NOT EXISTS idx_psl_team  ON paper_status_log(team_id);

-- ============ 旧库升级迁移（已上线环境执行，不会破坏旧数据） ============
-- 仅在数据库已存在、尚未含新列/新表时执行以下命令（重复执行安全）：
-- ALTER TABLE papers ADD COLUMN first_author TEXT;
-- ALTER TABLE papers ADD COLUMN corresponding_author TEXT;
-- CREATE TABLE IF NOT EXISTS paper_status_log (
--   id TEXT PRIMARY KEY, paper_id TEXT NOT NULL, team_id TEXT NOT NULL,
--   from_status TEXT, to_status TEXT, note TEXT, actor_id TEXT, actor_name TEXT, created_at TEXT NOT NULL
-- );
-- CREATE INDEX IF NOT EXISTS idx_psl_paper ON paper_status_log(paper_id);
-- CREATE INDEX IF NOT EXISTS idx_psl_team ON paper_status_log(team_id);
-- 注意：impact_factor / submitted_at / revision_deadline 三列保留不删，仅前端不再展示。
