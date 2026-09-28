// 抓取真实页面存成测试 fixture。
// 用法：node tools/capture-fixtures.mjs [学校ID]
// 为什么需要：测试不该依赖网络。网站改版时，先重抓 fixture，跑测试就能定位是解析坏了还是站点变了。
import fs from 'node:fs';
import path from 'node:path';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 notice-radar-fixture-capture';

const school = process.argv[2] ?? 'uestc';

const targets = {
  uestc: [
    ['jwc-important.html', 'https://www.jwc.uestc.edu.cn/hard/?page=1'],
    ['jwc-student.html', 'https://www.jwc.uestc.edu.cn/list/256/?page=1'],
    ['news-notice.html', 'https://news.uestc.edu.cn/?n=UestcNews.Front.CategoryV2.Page&CatId=68'],
    ['gr-notice.html', 'https://gr.uestc.edu.cn/tongzhi/'],
  ],
};

if (!targets[school]) {
  console.error(`未知学校：${school}。请在 tools/capture-fixtures.mjs 的 targets 里添加它的源。`);
  process.exit(1);
}

const outDir = path.join('tests', 'fixtures', school);
fs.mkdirSync(outDir, { recursive: true });

for (const [file, url] of targets[school]) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    const isChallenge = res.status === 202 || text.length < 4000;
    fs.writeFileSync(path.join(outDir, file), text, 'utf8');
    const note = isChallenge ? '  ⚠ 疑似 WAF 挑战页，请勿用这份做断言' : '';
    console.log(`[${res.status}] ${file}  ${text.length} bytes  ${Date.now() - t0}ms${note}`);
    console.log(`        source: ${url}`);
  } catch (e) {
    console.log(`[ERR] ${file}  ${e.name}: ${e.message}`);
  }
}

console.log(`\n已写入 ${outDir}/。重抓后请跑：npm test`);
