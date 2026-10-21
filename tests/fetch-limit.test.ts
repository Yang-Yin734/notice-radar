import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchHtml, FatalFetchError, DEFAULT_MAX_BYTES } from '../src/core/fetch.ts';

/**
 * 响应体上限（评审报告 P2-15）。
 *
 * 背景：站点可能被挂马、塞一个巨大的内联 base64 资源，或者返回一个超大错误页。
 * 原来的 `await res.arrayBuffer()` 没有中间态 —— 要么全读进内存，要么直接 OOM。
 * 在 128MB 的 GitHub runner 或 512MB 的函数实例上，一次就够了。
 *
 * 这里钉死四件事：正常页面照读、超限中断、声明超限时根本不下载、超限不重试。
 */

interface Server {
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}

async function serve(handler: http.RequestListener): Promise<Server> {
  let hits = 0;
  const server = http.createServer((req, res) => {
    hits += 1;
    handler(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    hits: () => hits,
    // 有的用例故意不 end 响应，靠这里强制断开，否则 close() 会一直等连接超时
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

test('fetch：正常大小的页面照常返回', async () => {
  const body = '<html><body>教务处通知</body></html>';
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  try {
    const r = await fetchHtml(s.url);
    assert.equal(r.status, 200);
    assert.match(r.html, /教务处通知/);
    assert.equal(r.bytes, Buffer.byteLength(body));
  } finally {
    await s.close();
  }
});

test('fetch：超出 maxBytes 时抛 FatalFetchError 并中断', async () => {
  // 分块持续写，模拟一个没有尽头的大响应
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    const chunk = 'x'.repeat(64 * 1024);
    let sent = 0;
    const timer = setInterval(() => {
      if (sent > 4 * 1024 * 1024) {
        clearInterval(timer);
        res.end();
        return;
      }
      sent += chunk.length;
      res.write(chunk);
    }, 1);
    res.on('close', () => clearInterval(timer));
  });
  try {
    await assert.rejects(
      () => fetchHtml(s.url, { maxBytes: 256 * 1024, retries: 0 }),
      (e: Error) => {
        assert.ok(e instanceof FatalFetchError, `应是 FatalFetchError，实际 ${e.constructor.name}：${e.message}`);
        assert.match(e.message, /超过上限 262144 字节/);
        return true;
      },
    );
  } finally {
    await s.close();
  }
});

test('fetch：content-length 已超限时不做下载', async () => {
  let wroteBody = false;
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(10 * 1024 * 1024) });
    res.write('<html>');
    wroteBody = true;
  });
  try {
    await assert.rejects(
      () => fetchHtml(s.url, { maxBytes: 1024, retries: 0 }),
      (e: Error) => {
        assert.ok(e instanceof FatalFetchError);
        assert.match(e.message, /声明 10485760 字节，超过上限 1024/);
        return true;
      },
    );
    assert.ok(wroteBody, '预检发生在拿到响应头之后、读完 body 之前');
  } finally {
    await s.close();
  }
});

test('fetch：体积超限不重试（只打一次请求）', async () => {
  const s = await serve((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(10 * 1024 * 1024) });
    res.end();
  });
  try {
    await assert.rejects(() => fetchHtml(s.url, { maxBytes: 1024, retries: 3, retryDelayMs: 1 }));
    assert.equal(s.hits(), 1, `不重试的话只该打 1 次，实际 ${s.hits()} 次`);
  } finally {
    await s.close();
  }
});

test('fetch：默认上限是 8 MiB，足以容纳任何正常列表页', () => {
  assert.equal(DEFAULT_MAX_BYTES, 8 * 1024 * 1024);
});
