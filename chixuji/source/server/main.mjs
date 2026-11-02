// 启动入口：node --no-warnings=ExperimentalWarning server/main.mjs
import os from 'node:os';
import { loadConfig } from './lib/config.mjs';
import { createApp } from './app.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`需要 Node.js 22.13 或更新版本（推荐 24），你现在的是 ${process.versions.node}。`);
  process.exit(1);
}

const config = loadConfig();
const app = createApp(config);

app.server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✘ 端口 ${config.port} 已经被占用：很可能已经开着一个迟叙机窗口。`);
    console.error('    请先关掉其他迟叙机的黑色窗口，再重新双击「启动.bat」。');
  } else {
    console.error('\n  ✘ 启动失败：', err);
  }
  process.exit(1);
});

app.server.listen(config.port, config.host, () => {
  console.log('');
  console.log('  迟叙机已启动 ✔');
  console.log(`  本机打开：  http://localhost:${config.port}`);
  if (config.host === '0.0.0.0') {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log(`  同一WiFi的手机打开：http://${n.address}:${config.port}`);
      }
    }
  }
  console.log(`  数据保存在：${config.dataDir}`);
  if (config.mailMode === 'screen') console.log('  ⚠ 现在是测试模式：验证码直接显示在登录页，不会发邮件。');
  if (!config.adminEmail) console.log('  ⚠ 还没设置管理员邮箱（.env 里的 ADMIN_EMAIL），暂时没人能生成邀请码。');
  console.log('  关闭这个窗口 = 停止运行');
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log('正在安全关闭…');
    await app.close();
    process.exit(0);
  });
}
