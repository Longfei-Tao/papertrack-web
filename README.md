# 课题组论文投稿进度看板 · PaperTrack Web

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Built with Cloudflare](https://img.shields.io/badge/Built%20with-Cloudflare-f38020.svg)](https://workers.cloudflare.com/)
[![Node](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

> 一个**免费、零配置、面向课题组**的论文投稿进度看板。支持**多课题组数据隔离**与**邀请码自助注册**，适合导师 / 学生团队跟踪「投稿 → 审稿 → 返修 → 接收」全流程。

## 📖 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [本地预览](#本地预览)
- [部署上线](#部署上线)
- [首次配置](#首次配置)
- [使用说明](#使用说明)
- [配置说明](#配置说明)
- [项目结构](#项目结构)
- [成本](#成本)
- [路线图](#路线图)
- [贡献](#贡献)
- [许可证](#许可证)

## ✨ 功能特性

- **多课题组隔离**：一个数据库可承载多个课题组，数据按 `team_id` 严格隔离、互不可见；可轻松推广给其他导师团队。
- **邀请码自助注册**：创建课题组后自动生成邀请码，成员凭码自助加入，无需管理员手动建账号。
- **成员可见性**：未登录看不到任何数据；仅本课题组成员可见 / 可操作本组进度。
- **按归属权限**：普通成员仅能增删改**自己名下**的论文；课题组管理员可查看 / 修改全部、生成邀请码、管理成员。
- **实用功能**：顶部统计、进度 / 成员筛选、搜索、手机自适应（电脑表格 / 手机卡片）、**返修截止倒计时**（正确显示「距截止 N 天 / 已逾期 N 天」）。

### 角色说明

| 角色 | 能做什么 |
|------|----------|
| 访客（未登录） | 看不到任何数据，必须先注册 / 登录并加入某个课题组 |
| member（普通成员） | 看本组全部进度；增删改**自己名下**的论文；修改自己密码 |
| admin（课题组管理员） | 看 / 改本组全部论文；生成 / 管理邀请码；移除成员；修改自己密码 |

> 第一个创建课题组的人自动成为该组 admin。之后可在「课题组管理」中将他人提升为 admin。

### 论文字段

| 字段 | 含义 |
|------|------|
| 论文题目 | 论文标题 |
| 期刊名称 | 投稿期刊 |
| 影响因子 | 期刊 IF（数值，留空为未知） |
| 分区 | Q1 / Q2 / Q3 / Q4 / 待定 |
| 投稿进度 | 草稿 / 已投稿 / 审稿中 / 返修 / 接收 / 拒稿 / 已发表 |
| 负责人 | 自动填为当前登录账号的显示名 |
| 投稿时间 | 投稿日期 |
| 返修截止 | 返修截止日期；到期显示倒计时 / 逾期提示 |
| 备注 | 审稿意见、返修要求、校样等 |

## 🧰 技术栈

- **前端**：原生 HTML / CSS / JavaScript（无构建步骤、零依赖）
- **后端**：Cloudflare Pages Functions
- **数据库**：Cloudflare D1（SQLite）
- **部署**：Cloudflare Pages（静态托管 + Functions）
- 全部运行在 Cloudflare 免费额度内，**无需绑定信用卡**，适合学生低频使用。

## 🚀 本地预览

需要本机安装 Node.js（建议 18+）。

### 方式一：零依赖预览（最简单，推荐）

项目自带内存版预览服务，无需安装 wrangler、无需数据库：

```bash
cd papertrack-web
node start.cjs
```

自动启动并打开 `http://localhost:4173`。**请使用该地址访问**，不要直接双击 `public/index.html`。Windows 用户也可双击 `start.bat`。

> 内存版数据重启即清空，仅用于本地查看效果与试流程。

### 方式二：wrangler 本地模拟（接近线上环境）

```bash
npm install -g wrangler
cd papertrack-web
wrangler pages dev public
```

打开终端给出的地址（通常 `http://localhost:8788`）。首次需本地建表：

```bash
wrangler d1 execute papertrack --local --file=./schema.sql
```

> 本地 D1 数据存于本机，不会上传，纯属预览。要真正分享给他人需走下方部署。

更详细的图文步骤见 **[docs/部署教程.md](docs/部署教程.md)**。

## 🌐 部署上线

完整步骤见 **[docs/部署教程.md](docs/部署教程.md)**，概要如下：

1. `wrangler login` 登录 Cloudflare（没有账号先免费注册）。
2. `wrangler d1 create papertrack` 创建数据库，复制返回的 `database_id`。
3. 将 `database_id` 填入 `wrangler.toml`（替换掉示例值）。数据库 id 只是标识符、非密钥，但部署你自己的实例请务必换成自己的。
4. `wrangler d1 execute papertrack --file=./schema.sql` 建表。
5. `wrangler pages deploy public` 部署，获得 `*.pages.dev` 公网地址。

## ⚙️ 首次配置

1. 打开 `*.pages.dev` 地址 → 右上角「注册 / 加入」→ 选「创建课题组」→ 填组名 + 账号密码。你即为该组 **admin**，并自动获得一条邀请码。
2. 将 **网站地址 + 邀请码** 发给课题组成员。
3. 成员打开地址 → 「注册 / 加入」→ 选「凭邀请码加入」→ 填信息 → 自动进组。
4. （可选）要让某人成为管理员：在「课题组管理」生成「管理员」角色邀请码发给他。

> **没有默认密码 / 全局管理员**。每个课题组由创建者自己担任 admin，互不影响——这是可推广给其他团队的关键。

## 📝 使用说明

- **管理员**：登录后查看 / 修改全部；在「课题组管理」生成邀请码、查看 / 移除成员；顶部可切换加入的多个课题组。
- **普通成员**：用自己账号登录，仅能添加 / 编辑 / 删除**自己**的论文；也可切换到加入的其他组。
- 改数据后点「刷新」即可看到最新内容（数据存于云端 D1，全组实时一致）。

## 🔧 配置说明

| 配置项 | 位置 | 说明 |
|--------|------|------|
| `database_id` | `wrangler.toml` | D1 数据库 ID（仅标识符、非密钥）；部署自己的实例用 `wrangler d1 create` 生成后替换 |
| 数据库结构 | `schema.sql` | 建表语句（users / sessions / teams / team_members / invite_codes / papers / paper_status_log） |
| 本地预览端口 | `start.cjs` | 默认 `4173`；`preview-server.cjs` 提供另一种预览方式 |

> 扩展字段（如 DOI、基金号）：在 `schema.sql` 给 `papers` 加列 + 改 `functions/api/papers.js` 读写 + 改 `public/index.html` 表单与 `public/app.js` 渲染即可。

## 📂 项目结构

```
papertrack-web/
├── wrangler.toml                       # 部署配置（D1 绑定）
├── schema.sql                          # 建表语句
├── functions/
│   ├── _lib/
│   │   └── auth.js                     # 共享鉴权（密码哈希 / 会话 / 团队归属校验）
│   └── api/
│       ├── register.js                 # 自助注册：创建课题组 / 凭邀请码加入
│       ├── login.js                    # 登录（返回 token + 团队列表）
│       ├── logout.js                   # 退出
│       ├── me.js                       # 当前用户 + 团队 / 改密码
│       ├── teams.js                    # 我加入的团队列表
│       ├── teams/[id]/invites.js       # 邀请码：列出 / 生成（仅 admin）
│       ├── teams/[id]/members.js       # 成员：列出 / 移除（仅 admin）
│       └── papers.js                   # 论文：按 team_id 隔离，成员可见，归属校验
└── public/
    ├── index.html                      # 页面结构（注册 / 登录 / 课题组管理 / 改密弹窗）
    ├── styles.css                      # 响应式样式
    └── app.js                          # 前端逻辑（团队切换、注册、权限、倒计时）
```

## 💰 成本

Cloudflare 免费额度（学生完全够用）：

- Pages 静态托管 + Functions：每日 10 万次请求免费
- D1 数据库：每天 500 万次读、10 万次写免费，存储 5 GB 免费
- 一个课题组几十篇论文、数人查看几乎不可能触顶；多团队共用同一额度。

## 🗺️ 路线图

- [ ] 直接改角色（无需重新邀请即可升级 / 降级成员）
- [ ] 密码找回（目前需管理员移除后重新邀请）
- [ ] 邮件 / 站内通知（返修截止提醒）
- [ ] 导出 CSV / 生成投稿统计报表

## 🤝 贡献

欢迎 Issue 与 Pull Request！提交重大改动前，请先开 Issue 讨论。详见 **[CONTRIBUTING.md](CONTRIBUTING.md)**。

## 📄 许可证

[MIT](LICENSE) © 2026 PaperTrack Web 贡献者
