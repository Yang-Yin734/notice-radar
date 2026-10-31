// 一次性回填：给历史归档里的「办事型」通知补上截止日。
//
// 为什么需要单独跑一遍：截止日是后来才加进数据模型的，386 条归档里一条都没有。
// 而标题里几乎不写截止日（实测 386 条命中 0 条），真正的日期在正文里 ——
// 所以这里对每条候选的详情页各抓一次。
//
// 用法：
//   node --experimental-strip-types tools/backfill-deadline.mjs --limit=20   # 先看命中率
//   node --experimental-strip-types tools/backfill-deadline.mjs --write      # 全量写回
import { loadHistory, saveHistory } from '../src/core/history.ts';
import { isActionableTitle } from '../src/core/deadline.ts';
import { withDeadlines } from '../src/core/detail.ts';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const limitArg = argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.slice('--limit='.length)) : 0;

const history = loadHistory();
const all = history.items;
const todo = all.filter((n) => !n.deadline && isActionableTitle(n.title));
console.log(`归档 ${all.length} 条；其中办事型且还没有截止日 ${todo.length} 条`);

const batch = LIMIT > 0 ? todo.slice(0, LIMIT) : todo;
if (batch.length === 0) process.exit(0);

const filled = await withDeadlines(batch, { limit: batch.length, concurrency: 3, timeoutMs: 15000 });
const hits = filled.filter((n) => n.deadline);
for (const n of hits) console.log(`✓ ${n.deadline}  ${n.title.slice(0, 42)}`);

const rate = ((hits.length / batch.length) * 100).toFixed(0);
console.log(`命中 ${hits.length}/${batch.length}（${rate}%）`);

if (!WRITE) {
  console.log('（预览模式：加 --write 才写回 data/history.json）');
  process.exit(0);
}

const byId = new Map(hits.map((n) => [n.id, n.deadline]));
history.items = all.map((n) => (byId.has(n.id) ? { ...n, deadline: byId.get(n.id) } : n));
saveHistory(history);
console.log('已写回 data/history.json');