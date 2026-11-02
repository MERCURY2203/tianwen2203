// 双击「启动.bat / 启动.command」时运行：检查设置文件 → 启动迟叙机 → 自动打开浏览器
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { applyUpdates } from './update.mjs';

// 先装更新，再加载程序的其他部分（这样用到的都是新文件）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 启动日志：窗口里显示的内容同时写进「启动日志.txt」，出问题时方便排查
const logFile = path.join(ROOT, '启动日志.txt');
try { fs.writeFileSync(logFile, `启动时间：${new Date().toLocaleString('zh-CN')}  Node ${process.version}  ${process.platform}\n`); } catch { /* 忽略 */ }
const writeLog = (args) => { try { fs.appendFileSync(logFile, args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ') + '\n'); } catch { /* 忽略 */ } };
for (const k of ['log', 'info', 'error', 'warn']) {
  const orig = console[k].bind(console);
  console[k] = (...args) => { writeLog(args); orig(...args); };
}
process.on('uncaughtException', (err) => {
  console.error('\n  ✘ 程序出错停止了：', err);
  console.error('  请把「小手机」文件夹里的「启动日志.txt」发给开发者。');
  process.exitCode = 1;
});
process.on('unhandledRejection', (err) => { console.error('\n  ✘ 程序出错：', err); });

// 有「更新包.zip」就先装上
applyUpdates(ROOT);

const envFile = path.join(ROOT, '.env');

// 浏览器下载时常把 .env 改成 env、env.txt、.env.txt，这里自动改回来
if (!fs.existsSync(envFile)) {
  for (const name of ['env', 'env.txt', '.env.txt', '_env', 'env.env']) {
    const p = path.join(ROOT, name);
    if (fs.existsSync(p)) {
      fs.renameSync(p, envFile);
      console.log(`  已把设置文件「${name}」改名为「.env」`);
      break;
    }
  }
}

// 还是没有：从模板创建，并询问管理员邮箱
if (!fs.existsSync(envFile)) {
  console.log('');
  console.log('  第一次启动，需要设置管理员邮箱（用它登录不需要邀请码，还能生成邀请码）。');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let email = '';
  while (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) email = (await rl.question('  请输入你的邮箱，然后按回车：')).trim();
  rl.close();
  const tpl = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  fs.writeFileSync(envFile, tpl.replace(/^ADMIN_EMAIL=.*$/m, `ADMIN_EMAIL=${email}`));
  console.log('  已保存到 .env。DeepSeek 密钥也填在这个文件里（用记事本打开）。');
}

const { loadConfig } = await import('./lib/config.mjs');
const config = loadConfig();
if (config.modelProvider === 'deepseek' && !config.deepseek.apiKey) {
  console.log('');
  console.log('  ⚠ .env 里还没有填 DeepSeek 密钥（DEEPSEEK_API_KEY），角色暂时没法回复。');
}

await import('./main.mjs');
// 纯前端版（8081）也一起开着：它的卡密要靠这个窗口里的服务器版来激活
process.env.XSJ_EMBED = '1';
await import('./static-local.mjs');
const openLocal = process.argv.includes('--local');

// 等程序启动后自动打开浏览器
setTimeout(() => {
  const url = openLocal ? `http://localhost:${process.env.LOCAL_PORT || 8081}` : `http://localhost:${config.port}`;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  if (!process.env.NO_BROWSER) exec(cmd, () => {});
}, 1500);
