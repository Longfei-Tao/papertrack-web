// ============================================================
//  厦门大学预设主题（示例）。
//  开源后其他团队可仿照本文件，新建 brand.myschool.js 替换为自己的机构，
//  并在 brand.js 里把 window.BRAND 指向它即可。
// ============================================================
window.BRAND_XMU = {
  title: "厦门大学 · 课题组论文投稿进度看板",
  orgName: "厦门大学",
  orgNameEn: "XIAMEN UNIVERSITY",
  shortName: "厦大",

  colors: {
    primary: "#9d2235",      // 嘉庚红
    primaryDark: "#7c1a29",
    primaryLight: "#b0334a",
    primarySubtle: "#fbeef0",
  },

  motto: "学术长路 · 嘉庚为灯",
  footerText: "学术长路 · 嘉庚为灯 — 厦门大学课题组投稿进度看板",

  // 厦大主题：保留全部原有视觉资产（校徽 / 嘉庚建筑 / 凤凰花 / 1921）
  assets: {
    logo: "./logo-xmu.svg",
    headerArt: "./xmu-header-art.svg",
    modalBanner: "./xmu-modal-banner.svg",
    footerArt: "./xmu-building.svg",
    bgPattern: "./xmu-bg.svg",
    statBg: "./xmu-stat-bg.svg",
    phoenixFlower: "./phoenix-flower.svg",
  },
};
// 说明：圆形徽上的年份（厦大 "1921"）已直接画在 logo-xmu.svg 内部，
// 品牌配置无需再声明年份。
