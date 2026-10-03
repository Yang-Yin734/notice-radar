// 看一眼某个 URL 现在到底返回什么（状态、体积、前 300 字符），排查"解析 0 条"是站点在挡还是选择器不对。
// 用法：node tools/peek-url.mjs <URL> [userAgent]
const url = process.argv[2];
if (!url) throw new Error('用法：node tools/peek-url.mjs <URL> [userAgent]');
const ua =
  process.argv[3] ??
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 notice-radar/0.0.1';

const r = await fetch(url, { headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,*/*' }, redirect: 'follow' });
const buf = Buffer.from(await r.arrayBuffer());
console.log(`HTTP ${r.status} | ${buf.length} 字节 | content-type: ${r.headers.get('content-type')} | 最终地址: ${r.url}`);
console.log('--- 前 400 字节 ---');
console.log(buf.toString('utf8').slice(0, 400));
