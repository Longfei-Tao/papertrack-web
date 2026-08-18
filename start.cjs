// PaperTrack 一键启动器
// 用法：node start.cjs
// 作用：启动本地预览服务，并自动打开浏览器访问 http://localhost:4173
const { spawn } = require("child_process");
const http = require("http");

const PORT = 4173;
const URL = `http://localhost:${PORT}`;

function openBrowser(url) {
  const platform = process.platform;
  const cmd = platform === "win32" ? "start" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["", url] : [url]; // win32 start 需要空标题参数
  spawn(cmd, args, { shell: true, detached: true, stdio: "ignore" }).unref();
}

function waitForServer() {
  return new Promise((resolve) => {
    const tryConnect = () => {
      http.get(URL, (res) => {
        if (res.statusCode === 200) return resolve();
        setTimeout(tryConnect, 200);
      }).on("error", () => setTimeout(tryConnect, 200));
    };
    tryConnect();
  });
}

const server = spawn(process.execPath, ["preview-server.cjs"], {
  cwd: __dirname,
  stdio: "inherit",
});

server.on("error", (err) => {
  console.error("启动预览服务失败：", err.message);
  process.exit(1);
});

waitForServer().then(() => {
  console.log("\n正在打开浏览器...");
  openBrowser(URL);
});

process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});
