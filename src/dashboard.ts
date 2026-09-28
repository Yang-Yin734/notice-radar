import type { History } from './core/history.ts';
import { countBySource } from './core/history.ts';

/**
 * 把历史归档渲染成一个**移动优先的 Web 应用**（PWA）。
 *
 * 设计要点：
 *   - 手机是主场景：底部标签栏、大点击区、安全区适配、跟随系统的深色模式
 *   - 电脑上是**居中窄栏**（760px）：通知流通常每天一两条，两列会浪费一半宽度、也不利于读长标题
 *   - 数据内嵌进页面（首屏立刻可用、可离线），另可用"刷新"拉 dashboard-data.json 取最新
 *   - 收藏 / 已读只存本机 localStorage，不上传任何数据
 *   - 零依赖：内联 CSS + 原生 JS，不引 CDN；配 manifest + service worker 可"添加到主屏幕"
 */

export interface DashboardOptions {
  title?: string;
  /** 内嵌（首屏用）最多多少条 —— 归档文件里保留更多 */
  maxItems?: number;
  generatedAt?: string;
  repoUrl?: string;
  /** 点"刷新"时拉的数据接口路径 */
  dataPath?: string;
  /** Android 安装包（APK）下载地址 —— 指向滚动 Release，链接固定不变 */
  apkUrl?: string;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (input: string): string => input.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** 内嵌到 <script> 里的 JSON 必须转义 `<`：否则标题里出现 </script> 就能逃出去 */
const escapeJsonForScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

export function renderDashboard(history: History, options: DashboardOptions = {}): string {
  const {
    title = '校园通知雷达',
    maxItems = 800,
    generatedAt = new Date().toISOString(),
    repoUrl = 'https://github.com/Yang-Yin734/notice-radar',
    dataPath = 'dashboard-data.json',
    apkUrl = 'https://github.com/Yang-Yin734/notice-radar/releases/download/android-latest/notice-radar.apk',
  } = options;

  const bootstrap = {
    generatedAt,
    title,
    repoUrl,
    dataPath,
    apkUrl,
    total: history.items.length,
    bySource: countBySource(history),
    items: history.items.slice(0, maxItems),
  };

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${escapeHtml(title)}</title>
<meta name="description" content="高校官网通知的自动归档与检索：notice-radar 定时抓取，手机上可添加到主屏幕当应用用。">
<meta name="theme-color" content="#1f2a3d">
<meta name="color-scheme" content="light dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${escapeHtml(title)}">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-192.png">
<link rel="icon" href="icon-192.png">
<style>
  :root {
    --bg:#eef1f6; --card:#fff; --ink:#1f2a3d; --muted:#868e96; --line:#e9ecf1;
    --accent:#1c7ed6; --bar:#f1f3f5;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#12161f; --card:#1b212c; --ink:#e9ecef; --muted:#909aa6; --line:#2a313d; --accent:#4dabf7; --bar:#2a313d; }
  }
  html.dark { --bg:#12161f; --card:#1b212c; --ink:#e9ecef; --muted:#909aa6; --line:#2a313d; --accent:#4dabf7; --bar:#2a313d; }
  html.light { --bg:#eef1f6; --card:#fff; --ink:#1f2a3d; --muted:#868e96; --line:#e9ecf1; --accent:#1c7ed6; --bar:#f1f3f5; }

  * { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
  html, body { max-width:100%; overflow-x:hidden; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font-family:"Microsoft YaHei","PingFang SC","Segoe UI",system-ui,sans-serif;
    padding-bottom:calc(66px + env(safe-area-inset-bottom)); }

  .topbar { position:sticky; top:0; z-index:20; display:flex; align-items:center; gap:9px;
    padding:calc(10px + env(safe-area-inset-top)) 14px 10px;
    background:var(--card); border-bottom:1px solid var(--line); }
  .brand { font-weight:700; font-size:16px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
  .pill { font-size:11.5px; color:var(--muted); background:var(--bar); padding:3px 9px; border-radius:999px;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .grow { flex:1 1 auto; min-width:0; }
  .iconbtn { border:1px solid var(--line); background:var(--card); color:var(--ink); white-space:nowrap;
    border-radius:10px; padding:7px 11px; font-size:13px; cursor:pointer; }
  .iconbtn:active { transform:scale(.97); }
  /* 窄屏顶栏放不下时收起统计药丸（未读数在标签栏也有），保证品牌与按钮不折行 */
  @media (max-width:440px) { .pill { display:none; } }

  main { max-width:760px; margin:0 auto; padding:12px 12px 20px; }
  .view[hidden] { display:none; }

  /* 安装横幅：只在 Android 上出现，可关掉（选择记在本机） */
  .installbanner { display:flex; align-items:center; gap:10px; margin-bottom:10px; padding:11px 13px;
    border-radius:14px; background:linear-gradient(135deg,#2b3a55,#1f2a3d); color:#fff; }
  .installbanner[hidden] { display:none; }
  .installbanner .ib-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
  .installbanner .ib-text b { font-size:14px; }
  .installbanner .ib-text span { font-size:11.5px; opacity:.72; }
  .ib-close { border:none; background:transparent; color:#fff; opacity:.6; font-size:14px; cursor:pointer; padding:6px; }
  .btn { display:inline-block; text-decoration:none; border:none; cursor:pointer; font-size:13.5px;
    padding:9px 16px; border-radius:10px; white-space:nowrap; }
  .btn.primary { background:#4dabf7; color:#0b2033; font-weight:600; }
  .btn.big { display:block; text-align:center; font-size:15px; padding:14px; margin:12px 0 8px; }

  .controls { display:flex; gap:8px; margin-bottom:10px; min-width:0; }
  /* min-width:0 是关键：flex 子项默认 min-width:auto，输入框的固有宽度会把整页撑出屏幕 */
  #q { flex:1; min-width:0; padding:11px 13px; border:1px solid var(--line); border-radius:12px; font-size:15px;
    background:var(--card); color:var(--ink); }
  #q:focus { outline:2px solid var(--accent); outline-offset:-1px; border-color:var(--accent); }
  .chips { display:flex; gap:7px; overflow-x:auto; padding:2px 0 10px; }
  .chips::-webkit-scrollbar { display:none; }
  .chip { flex:0 0 auto; border:1px solid var(--line); background:var(--card); color:var(--muted);
    border-radius:999px; padding:7px 13px; font-size:13px; cursor:pointer; white-space:nowrap; }
  .chip.active { background:var(--ink); border-color:var(--ink); color:var(--card); }
  .chip b { font-weight:400; opacity:.65; }

  section.group h2 { font-size:13px; margin:16px 2px 8px; color:var(--muted); font-weight:600;
    display:flex; align-items:center; gap:8px; }
  section.group h2 .n { font-size:11px; background:var(--bar); padding:1px 8px; border-radius:999px; }
  .list { display:grid; gap:8px; }

  .item { background:var(--card); border-radius:14px; padding:12px 13px; position:relative; min-width:0;
    box-shadow:0 3px 10px rgba(16,24,40,.05); display:flex; flex-direction:column; gap:6px; }
  .item.unread::before { content:""; position:absolute; left:0; top:12px; bottom:12px; width:3px;
    border-radius:0 3px 3px 0; background:var(--accent); }
  .item.read { opacity:.7; }
  .meta { display:flex; align-items:center; gap:8px; font-size:11.5px; color:var(--muted); padding-right:34px; min-width:0; }
  .meta .from { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .title { color:var(--ink); text-decoration:none; font-size:15px; line-height:1.5; padding-right:34px;
    overflow-wrap:anywhere; }
  .tag { display:inline-block; font-size:11.5px; padding:1px 7px; margin-right:6px; border-radius:5px; color:#fff; background:var(--c); }
  .star { position:absolute; right:6px; bottom:6px; border:none; background:transparent; font-size:19px;
    line-height:1; cursor:pointer; opacity:.3; padding:8px; }
  .star.on { opacity:1; }

  .card { background:var(--card); border-radius:14px; padding:16px; box-shadow:0 3px 10px rgba(16,24,40,.05); }
  .card h3 { margin:0 0 12px; font-size:13px; color:var(--muted); font-weight:600; }
  .card + .card { margin-top:12px; }
  .trend { display:flex; align-items:flex-end; gap:5px; height:80px; }
  .trend .bar { flex:1; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; height:100%; }
  .trend .bar span { width:100%; background:linear-gradient(180deg,#4dabf7,var(--accent)); border-radius:4px 4px 0 0; min-height:2px; }
  .trend .bar em { font-style:normal; font-size:10px; color:var(--muted); margin-top:4px; }
  .src { display:flex; align-items:center; gap:10px; margin:7px 0; font-size:13px; }
  .src-name { flex:0 0 44%; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
  .src-bar { flex:1; background:var(--bar); border-radius:999px; height:9px; overflow:hidden; }
  .src-bar i { display:block; height:100%; background:linear-gradient(90deg,#74c0fc,var(--accent)); }
  .src b { flex:0 0 30px; text-align:right; font-variant-numeric:tabular-nums; }
  .about p { font-size:13.5px; line-height:1.85; color:var(--muted); margin:0 0 10px; }
  .about a { color:var(--accent); }
  .kbd { background:var(--bar); border-radius:6px; padding:1px 7px; font-size:12.5px; color:var(--ink); }
  .empty { text-align:center; color:var(--muted); font-size:13.5px; padding:34px 10px; }

  .tabbar { position:fixed; left:0; right:0; bottom:0; z-index:30; display:flex;
    background:var(--card); border-top:1px solid var(--line); padding-bottom:env(safe-area-inset-bottom); }
  .tabbar button { flex:1; border:none; background:transparent; color:var(--muted); font-size:12px;
    padding:9px 2px 10px; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:3px; }
  .tabbar button .dot { width:5px; height:5px; border-radius:50%; background:transparent; }
  .tabbar button.active { color:var(--accent); }
  .tabbar button.active .dot { background:var(--accent); }
  .tabbar .badge { font-size:10px; background:var(--accent); color:#fff; border-radius:999px; padding:0 5px; }

  .toast { position:fixed; left:50%; transform:translateX(-50%); bottom:calc(80px + env(safe-area-inset-bottom));
    background:var(--ink); color:var(--card); font-size:13px; padding:9px 15px; border-radius:999px;
    opacity:0; pointer-events:none; transition:opacity .25s; z-index:40; }
  .toast.show { opacity:.95; }

  @media (min-width:760px) {
    main { padding:16px 20px 28px; }
  }
  @media (min-width:700px) {
    body { padding-bottom:0; }
    .tabbar { position:static; width:fit-content; margin:10px auto 0; border:1px solid var(--line);
      border-radius:999px; overflow:hidden; }
    .tabbar button { padding:9px 22px; flex-direction:row; gap:8px; }
    .tabbar button .dot { display:none; }
    .toast { bottom:24px; }
  }
</style>
</head>
<body>

<header class="topbar">
  <span class="brand">${escapeHtml(title)}</span>
  <span class="pill" id="pill">…</span>
  <span class="grow"></span>
  <button class="iconbtn" id="theme" title="切换深浅色">◐</button>
  <button class="iconbtn" id="refresh" title="拉取最新数据">刷新</button>
</header>

<main>
  <section class="view" id="view-list">
    <div class="installbanner" id="install-banner" hidden>
      <div class="ib-text"><b>装成手机应用更方便</b><span>下载安装包后不用每次找浏览器</span></div>
      <a class="btn primary" id="apk-download-top" href="${escapeHtml(apkUrl)}">下载 APK</a>
      <button class="ib-close" id="apk-dismiss" aria-label="不再提示">✕</button>
    </div>
    <div class="controls"><input id="q" type="search" placeholder="搜索标题，例如：退课 / 四六级 / 推免" enterkeyhint="search"></div>
    <div class="chips" id="chips"></div>
    <div id="list"></div>
  </section>

  <section class="view card" id="view-stats" hidden>
    <h3>最近 14 天发现量</h3>
    <div class="trend" id="trend"></div>
    <div style="height:18px"></div>
    <h3>按来源统计</h3>
    <div id="sources"></div>
  </section>

  <section class="view card about" id="view-about" hidden>
    <h3>关于这个应用</h3>
    <p>它把学校官网的通知自动抓下来、按关键词过滤、归档成可检索的列表 —— <b>只抓公开页面，不登录、不存储个人信息</b>。</p>
    <a class="btn primary big" href="${escapeHtml(apkUrl)}" id="apk-download-about">⬇ 下载 Android 安装包（APK）</a>
    <p>安装包是把本页套壳成原生应用（TWA），打开的还是同一个网址、内容永远是最新的。
      首次安装需在系统提示时允许"安装未知来源应用"；更新包用同一把密钥签名，可以直接覆盖安装。</p>
    <p><b>不想装 APK 也行：</b>Android 用 Chrome 菜单 → <span class="kbd">安装应用 / 添加到主屏幕</span>；iPhone 用 Safari 点 <span class="kbd">分享</span> → <span class="kbd">添加到主屏幕</span>。装好后离线也能翻已缓存的通知。</p>
    <p><b>收藏与已读只存在你这台设备</b>（localStorage），不会上传；清浏览器数据会一起清掉。</p>
    <p>数据由 <a href="${escapeHtml(repoUrl)}">notice-radar</a> 定时抓取并提交到仓库。站点结构变更可能导致漏抓，<b>请以学校官网原文为准</b>。</p>
    <p id="meta-line"></p>
  </section>
</main>

<nav class="tabbar" id="tabbar">
  <button data-view="list" data-filter="all" class="active"><span class="dot"></span>通知 <span class="badge" id="badge-unread" hidden></span></button>
  <button data-view="list" data-filter="fav"><span class="dot"></span>收藏 <span class="badge" id="badge-fav" hidden></span></button>
  <button data-view="stats"><span class="dot"></span>统计</button>
  <button data-view="about"><span class="dot"></span>关于</button>
</nav>

<div class="toast" id="toast"></div>

<script id="bootstrap" type="application/json">${escapeJsonForScript(bootstrap)}</script>
<script>
(function () {
  var BOOT = JSON.parse(document.getElementById('bootstrap').textContent);
  var KEY_READ = 'notice-radar:read', KEY_FAV = 'notice-radar:fav', KEY_THEME = 'notice-radar:theme';
  var state = {
    items: BOOT.items.slice(), view: 'list', filter: 'all', source: 'all', query: '',
    read: new Set(lsRead(KEY_READ)), fav: new Set(lsRead(KEY_FAV))
  };

  function lsRead(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; } }
  function lsWrite(key, arr) { try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]; }); }
  function host(url) { try { return new URL(url).host; } catch (e) { return ''; } }
  function tagColor(tag) {
    if (!tag) return '#495057';
    if (/考试|补考|缓考/.test(tag)) return '#e8590c';
    if (/教管|教学/.test(tag)) return '#1c7ed6';
    if (/学生事务/.test(tag)) return '#2f9e44';
    if (/实践/.test(tag)) return '#7048e8';
    if (/学术|讲座/.test(tag)) return '#0b7285';
    return '#495057';
  }
  function toast(msg) {
    var el = document.getElementById('toast');
    el.textContent = msg; el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function visible() {
    var q = state.query.trim().toLowerCase();
    return state.items.filter(function (it) {
      if (state.filter === 'fav' && !state.fav.has(it.id)) return false;
      if (state.source !== 'all' && it.sourceId !== state.source) return false;
      if (!q) return true;
      return (it.title + ' ' + (it.tag || '') + ' ' + it.sourceName).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderChips() {
    var counts = {};
    state.items.forEach(function (it) { counts[it.sourceId] = (counts[it.sourceId] || 0) + 1; });
    var rows = [['all', '全部', state.items.length]];
    BOOT.bySource.forEach(function (s) { rows.push([s.sourceId, s.sourceName, counts[s.sourceId] || 0]); });
    document.getElementById('chips').innerHTML = rows.map(function (r) {
      return '<button class="chip' + (state.source === r[0] ? ' active' : '') + '" data-source="' + esc(r[0]) + '">' +
        esc(r[1]) + ' <b>' + r[2] + '</b></button>';
    }).join('');
  }

  function renderList() {
    var items = visible();
    var box = document.getElementById('list');
    if (!items.length) {
      box.innerHTML = '<div class="empty">' + (state.filter === 'fav'
        ? '还没有收藏。点通知卡片右下角的 ☆ 收藏。' : '没有匹配的通知。') + '</div>';
      return;
    }
    var groups = new Map();
    items.forEach(function (it) {
      var day = it.date || '日期未知';
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(it);
    });
    var html = '';
    groups.forEach(function (list, day) {
      html += '<section class="group"><h2>' + esc(day) + '<span class="n">' + list.length + ' 条</span></h2><div class="list">';
      list.forEach(function (it) {
        var isRead = state.read.has(it.id), isFav = state.fav.has(it.id);
        html += '<article class="item ' + (isRead ? 'read' : 'unread') + '">' +
          '<div class="meta"><span class="from">' + esc(it.sourceName) + '</span><span>' + esc(host(it.url)) + '</span></div>' +
          '<a class="title" href="' + esc(it.url) + '" target="_blank" rel="noreferrer" data-open="' + esc(it.id) + '">' +
            (it.tag ? '<span class="tag" style="--c:' + tagColor(it.tag) + '">' + esc(it.tag) + '</span>' : '') + esc(it.title) + '</a>' +
          '<button class="star' + (isFav ? ' on' : '') + '" data-fav="' + esc(it.id) + '" aria-label="收藏">' + (isFav ? '★' : '☆') + '</button>' +
        '</article>';
      });
      html += '</div></section>';
    });
    box.innerHTML = html;
  }

  function renderStats() {
    var trend = BOOT.__trend || [];
    var max = Math.max.apply(null, [1].concat(trend.map(function (t) { return t.count; })));
    document.getElementById('trend').innerHTML = trend.map(function (t) {
      return '<div class="bar" title="' + esc(t.day) + '：' + t.count + ' 条"><span style="height:' +
        Math.round(t.count / max * 100) + '%"></span><em>' + esc(t.day.slice(8)) + '</em></div>';
    }).join('') || '<div class="empty">还没有数据</div>';

    var maxSrc = Math.max.apply(null, [1].concat(BOOT.bySource.map(function (s) { return s.count; })));
    document.getElementById('sources').innerHTML = BOOT.bySource.map(function (s) {
      return '<div class="src"><span class="src-name">' + esc(s.sourceName) + '</span><span class="src-bar"><i style="width:' +
        Math.round(s.count / maxSrc * 100) + '%"></i></span><b>' + s.count + '</b></div>';
    }).join('') || '<div class="empty">还没有数据</div>';
  }

  function renderChrome() {
    var unread = state.items.filter(function (it) { return !state.read.has(it.id); }).length;
    document.getElementById('pill').textContent = '共 ' + state.items.length + ' 条 · 未读 ' + unread;
    var bu = document.getElementById('badge-unread');
    bu.hidden = unread === 0; bu.textContent = unread > 99 ? '99+' : String(unread);
    var bf = document.getElementById('badge-fav');
    bf.hidden = state.fav.size === 0; bf.textContent = String(state.fav.size);
    document.getElementById('meta-line').textContent =
      '数据生成时间：' + BOOT.generatedAt.replace('T', ' ').slice(0, 16) + ' UTC · 归档 ' + BOOT.total + ' 条';
  }

  function showView(view) {
    state.view = view;
    document.getElementById('view-list').hidden = view !== 'list';
    document.getElementById('view-stats').hidden = view !== 'stats';
    document.getElementById('view-about').hidden = view !== 'about';
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar button'), function (b) {
      b.classList.toggle('active', b.dataset.view === view && (view !== 'list' || b.dataset.filter === state.filter));
    });
    if (view === 'stats') renderStats();
  }

  function renderAll() { renderChips(); renderList(); renderChrome(); }

  document.getElementById('q').addEventListener('input', function (e) {
    state.query = e.target.value; renderList();
  });
  document.getElementById('chips').addEventListener('click', function (e) {
    var chip = e.target.closest('.chip'); if (!chip) return;
    state.source = chip.dataset.source;
    if (state.filter === 'fav') state.filter = 'all';
    renderChips(); renderList(); showView('list');
  });
  document.getElementById('list').addEventListener('click', function (e) {
    var fav = e.target.closest('[data-fav]');
    if (fav) {
      var id = fav.dataset.fav;
      if (state.fav.has(id)) state.fav.delete(id); else state.fav.add(id);
      lsWrite(KEY_FAV, Array.from(state.fav));
      renderList(); renderChrome();
      return;
    }
    var open = e.target.closest('[data-open]');
    if (open) {
      state.read.add(open.dataset.open);
      lsWrite(KEY_READ, Array.from(state.read));
      renderList(); renderChrome();
    }
  });
  document.getElementById('tabbar').addEventListener('click', function (e) {
    var btn = e.target.closest('button'); if (!btn) return;
    state.filter = btn.dataset.filter || 'all';
    state.source = 'all';
    renderChips(); renderList(); showView(btn.dataset.view);
  });
  document.getElementById('theme').addEventListener('click', function () {
    var html = document.documentElement;
    var isDark = html.classList.contains('dark') ||
      (!html.classList.contains('light') && matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.remove('dark', 'light');
    html.classList.add(isDark ? 'light' : 'dark');
    lsWrite(KEY_THEME, [isDark ? 'light' : 'dark']);
  });
  document.getElementById('refresh').addEventListener('click', function () {
    fetch(BOOT.dataPath + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (!data.items) throw new Error('数据格式不对');
        state.items = data.items;
        BOOT.total = data.total || data.items.length;
        if (data.bySource) BOOT.bySource = data.bySource;
        if (data.generatedAt) BOOT.generatedAt = data.generatedAt;
        computeTrend();
        renderAll();
        if (state.view === 'stats') renderStats();
        toast('已更新到最新（' + state.items.length + ' 条）');
      })
      .catch(function (err) { toast('刷新失败：' + err.message); });
  });

  function computeTrend() {
    var days = [], now = new Date(BOOT.generatedAt);
    for (var i = 13; i >= 0; i--) {
      days.push({ day: new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10), count: 0 });
    }
    var index = {};
    days.forEach(function (d, i) { index[d.day] = i; });
    state.items.forEach(function (it) {
      var day = String(it.firstSeenAt || '').slice(0, 10);
      if (day in index) days[index[day]].count++;
    });
    BOOT.__trend = days;
  }

  var savedTheme = lsRead(KEY_THEME)[0];
  if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.classList.add(savedTheme);

  computeTrend();
  renderAll();
  showView('list');

  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferredPrompt = e;
    var install = document.createElement('button');
    install.className = 'iconbtn'; install.textContent = '安装';
    install.addEventListener('click', function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt(); deferredPrompt = null; install.remove();
    });
    var refreshBtn = document.getElementById('refresh');
    refreshBtn.parentNode.insertBefore(install, refreshBtn);
  });

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 离线是加分项，失败不影响使用 */ });
  }

  // Android 用户把"下载安装包"顶到最上面（点过 ✕ 就不再打扰）
  (function installBanner() {
    var KEY = 'notice-radar:apk-dismissed';
    var isAndroid = /Android/i.test(navigator.userAgent);
    var banner = document.getElementById('install-banner');
    if (!isAndroid || lsRead(KEY)[0] === '1') return;
    banner.hidden = false;
    document.getElementById('apk-dismiss').addEventListener('click', function () {
      banner.hidden = true;
      lsWrite(KEY, ['1']);
    });
    // 下载按钮带上来源标记，方便在 Release 的下载统计里区分入口
    document.getElementById('apk-download-top').addEventListener('click', function () {
      lsWrite(KEY, ['1']);
    });
  })();
})();
</script>
</body></html>
`;
}
