# 厦大课题组投稿看板 · Web 界面设计规范审查报告

审查对象：`public/index.html` · `public/styles.css` · `public/app.js` · 7 张 SVG 装饰素材
对照基准：WCAG 2.1（AA 级 + 必要的 A 级基线）、响应式设计最佳实践、学术 UI 视觉一致性
审查日期：2026-08-19

> 术语小词典（大白话版）：
> - **焦点环**：用键盘 Tab 切到某个按钮时，屏幕上要有个高亮框告诉"现在选中了谁"。没有它，键盘用户就"瞎了"。
> - **键盘陷阱**：弹窗打开后，用键盘 Tab 键焦点跑到了弹窗背后的页面、且关不掉，就叫陷阱。
> - **对比度**：文字颜色 vs 背景颜色的差值，差太小=看不清。正文要求 ≥4.5:1。
> - **aria-***：给屏幕阅读器（盲人用的读屏软件）看的"说明牌"。

---

## 一、问题汇总

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 关键 | 1 | 会让键盘/读屏用户**完全无法使用**弹窗 |
| 🟡 重要 | 5 | 影响无障碍合规与键盘可达性，建议必修 |
| 🔵 建议 | 7 | 视觉打磨、性能、响应式细节，影响"好看程度" |

---

## 二、逐条问题（file:line 定位）

### 🔴 关键级

**1. 模态弹窗缺少焦点管理 / Esc 关闭 / 焦点陷阱保护**
- 位置：`app.js` `openLogin()`(582)、`openReg()`(193)、`openModal()`(551)、`openPw()`(585)、`openTeam()`(592)、`openOnboard()`(268)；`bind()`(831–931) 中无任何 `keydown`/`focus` 处理
- 规范：WCAG 2.4.3 焦点顺序 / 2.1.2 无键盘陷阱 / 2.4.7 焦点可见
- 现状：弹窗只是 `display` 切换，焦点没有移入对话框，没设 `Esc` 关闭，Tab 键会跑到弹窗背后元素。
- 后果：键盘用户和屏幕阅读器用户打开"登录/添加论文/课题组管理"后，既读不出"这是个对话框"，也关不掉、操作不了。
- 修复：
  1. 给每个 `.modal` 加 `role="dialog" aria-modal="true" aria-labelledby="modalTitle"`
  2. 打开时记录 `lastFocused = document.activeElement`，`modalCard.focus()`
  3. 监听 `keydown`：`Esc` 关闭当前弹窗
  4. 实现 Tab 循环（焦点只在弹窗内元素间移动）

### 🟡 重要级

**2. 全局缺少统一的 `:focus-visible` 焦点环**
- 位置：`styles.css` `.btn`(279)、`.filter-trigger`(232)、`.filter-radio`(270)、`.link-btn`(471)、`.tab`(520)、`.team-select`(109)、`.add-for-btn`(391)
- 规范：WCAG 2.4.7 / 1.4.11（焦点指示与相邻色对比 ≥3:1）
- 现状：只有 `.modal-body input:focus`(502) 有自定义高亮环，其余交互元素靠浏览器默认轮廓（红底上的默认轮廓对比差、且不精致）。
- 修复：增加统一规则
  ```css
  :focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
  /* 深色背景（顶栏）上的元素改用浅色环 */
  .topbar :focus-visible { outline-color: #fff; }
  ```

**3. 下拉菜单（筛选 / 用户菜单）无 Esc 关闭**
- 位置：`app.js` `bind()`(886–896) 仅用 `document.click` 关闭；`toggleDropdown()`(588)
- 规范：WCAG 2.1.1 键盘可操作
- 修复：全局 `document.addEventListener('keydown', e=>{ if(e.key==='Escape'){ closeFilterDropdowns(); closeDropdown(); closeAllModals(); }})`

**4. Toast 提示无 `aria-live`**
- 位置：`app.js` `toast()`(44)、`styles.css` `.toast`(512)
- 规范：WCAG 4.1.3 状态消息
- 现状：登录成功/错误等反馈动态出现，但读屏器读不到。
- 修复：`<div id="toast" class="toast hidden" role="status" aria-live="polite">`

**5. 下拉触发按钮缺少 `aria-expanded` / `aria-haspopup`**
- 位置：`index.html` `.filter-trigger`(75–108)、用户菜单 `userBtn`(47)
- 规范：WCAG 4.1.2 名称/角色/值
- 修复：`toggleFilterDropdown()` 中动态设置 `btn.setAttribute('aria-expanded', willOpen)`

**6. 部分输入控件无 `<label>` 关联**
- 位置：`styles.css` `.invite-gen input`(583)，HTML 中 `inviteMax`(292) 仅靠 `placeholder`，无 label
- 规范：WCAG 1.3.1 / H44
- 修复：用 `<label>` 包裹或加 `aria-label="使用次数上限"`

### 🔵 建议级（视觉与体验打磨）

**7. 多处文字对比度临界（1.4.3）**
- `.badge.s-草稿` 文字 `#6f6770` 配底 `#efe9e5` ≈ 4.9:1，刚过线；
- `.badge-en`（英文小字）再叠加 `opacity:.72`，实际对比降到约 3.5:1，**低于 4.5:1**；
- `.q-badge` 默认灰底灰字同理临界。
- 修复：提亮文字或加深底色，去掉 badge-en 的 opacity 改用语义化浅色。

**8. 中屏（761–1200px）统计卡仍是 5 列，偏挤**
- 位置：`styles.css` `.stats`(178–182) 仅 ≤760px 降为 2 列
- 修复：补 `@media (min-width:761px) and (max-width:1100px){ .stats{ grid-template-columns: repeat(3,1fr) } }`

**9. 全屏固定背景图性能开销大**
- 位置：`styles.css` `body`(38–51) `background-attachment: fixed` + `xmu-bg.svg` 含 `feTurbulence` 颗粒滤镜
- 移动端已禁用(636)✓；桌面端大图 + 滤镜滚动时掉帧。
- 建议：颗粒滤镜改为静态位图预渲染，或降低模糊半径；固定背景改为 `local`。

**10. 装饰元素泛滥，稀释信息层级（"丑"的主因之一）**
- 全屏 `xmu-bg.svg` + 顶栏 `xmu-header-art.svg` + **每张统计卡** `xmu-stat-bg.svg` + 弹窗 `xmu-modal-banner.svg` + 页脚 `xmu-building.svg` + 空状态 `phoenix-flower.svg` = 6 处大装饰。
- 与"学术、沉稳、克制"的定位相冲突，反而显花哨/廉价。

**11. 中英双语 badge 增加噪点（"丑"的主因之二）**
- `badge()`(437) 同时渲染中文 + `badge-en` 英文小字（`opacity .72`）。12 列表格里每格都双语，视觉噪声高。

**12. 颜色系统过于复杂（"丑"的主因之三）**
- 10 种进度状态色 + 5 种分区色 + 主/好/警/返/坏。表格密布高饱和彩色 badge，信息密度过载。
- 建议：分区改用"灰阶 + 单一强调色"；进度用"语义色 + 图标/形状"区分，而非 10 种高饱和色。

**13. 字体气质可更统一（学术感）**
- `body` 用 sans（PingFang/YaHei/Noto Sans SC），仅 h1/h2/stat-num 用衬线。
- 建议：卡片标题、表头也统一用衬线（Noto Serif SC），强化"学术"统一感。

---

## 三、关于"丑"的诊断结论

不是"厦大方向错了"，而是**装饰用力过猛 + 信息密度过高**：
1. 装饰铺得太满（6 处 SVG），内容区没有呼吸空间；
2. 表格里每张卡片、每个状态都用高饱和彩色 badge + 双语文字，眼睛被"吵"到；
3. 字体混排让"学术感"没立住。

**一句话**：内容是对的，但"包装太花"，需要"做减法"。

---

## 四、关于"应该以厦门大学的标志呈现吗"

**结论：应该，而且你已经做了——方向完全正确，问题在"呈现方式"。**

代码里其实已经有一整套厦大身份系统：
- 校徽圆形 logo（嘉庚建筑 + 「1921」建校年份）— `logo-xmu.svg` / `brand-logo`
- 嘉庚红主色 `#9d2235`（厦大标准红）
- 凤凰花（厦大校花，`phoenix-flower.svg`）
- 嘉庚建筑剪影（建南大会堂三穹顶、群贤楼长廊）— `xmu-building.svg` / `xmu-header-art.svg`
- 英文标准字 `XIAMEN UNIVERSITY`

这说明"厦大标志呈现"的理念已经落地，**不需要推翻**。真正要做的是"克制地呈现"：

| 现在（过满） | 建议（克制） |
|---|---|
| 6 处大装饰全开 | 校徽 + 嘉庚红集中在**顶栏、登录/注册 banner、页脚**三处"主视觉" |
| 每张统计卡角落都塞 `xmu-stat-bg.svg` | 统计卡改为**干净纯色 + 顶部细色条**，去掉角落装饰 |
| 表格双语高饱和 badge | 默认仅中文；英文 hover/详情再显；分区灰度化 |
| 颜色 15+ 种 | 收敛为"主色 + 语义三色（好/警/返）"，靠形状/图标辅助区分 |

这样厦大气质反而更"显贵"——就像真正的好大学官网：**大块留白 + 一抹校色 + 一枚校徽**，比满屏贴图高级得多。
