// ============================================================
//  默认「学术通用主题」——不绑定任何学校，可直接开源分发。
//  开源给其他团队时，他们改 brand.js 一行即可换成本校/本机构，
//  或复制本文件新建 brand.myschool.js 自定义。
// ============================================================
window.BRAND_DEFAULT = {
  // 标题与机构名（会注入到 <title>、顶栏、弹窗、页脚）
  title: "课题组投稿进度看板",
  orgName: "我的课题组",          // 顶栏副标题里的机构名
  orgNameEn: "RESEARCH GROUP",    // 弹窗 banner 英文标准字
  shortName: "课题组",            // 页脚等简称

  // 主题色四件套（注入为 CSS 变量 --primary / --primary-d / --primary-l / --primary-subtle）
  colors: {
    primary: "#2b4a6f",      // 墨蓝（主色）
    primaryDark: "#1e3552",  // 深一档（渐变暗端 / hover）
    primaryLight: "#4a7099", // 亮一档（渐变亮端）
    primarySubtle: "#eaf0f6", // 浅底（选中/高亮背景）
  },

  // 标语 / 题字
  motto: "学术长路 · 笃行致远",
  footerText: "学术长路 · 笃行致远 — 课题组投稿进度看板",

  // 图形资源。null = 不显示，退回纯色 / 纯文字（视觉做减法，避免喧宾夺主）
  assets: {
    logo: "./brand-logo.svg",  // 圆形品牌徽
    headerArt: null,           // 顶栏建筑剪影（默认纯渐变）
    modalBanner: null,         // 弹窗顶部横幅（默认纯渐变）
    footerArt: null,           // 页脚建筑剪影（默认纯文字）
    bgPattern: null,           // 全屏背景图（默认纯色，性能更好）
    statBg: null,              // 统计卡角落装饰（默认无）
    phoenixFlower: null,       // 校花点缀（默认无）
  },
};
// 说明：圆形徽上的年份（如厦大 "1921"）已直接画在 logo SVG 内部，
// 品牌配置无需再声明年份；换机构时直接换自己的 logo 文件即可。
