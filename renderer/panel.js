'use strict';
/* 桌宠 · 卡片坞 */
(function () {

const api = window.api;
const $ = (id) => document.getElementById(id);
let cfg = null;
let snap = null;

/* ---------------- 工具 ---------------- */
const money = (n, cur = 'CNY') => (cur === 'USD' ? '$' : '¥') + (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2));
const cnySum = (list) => list.filter((b) => b.ok && b.currency === 'CNY').reduce((s, b) => s + b.total, 0);

function bytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n.toFixed(0) + ' B/s';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB/s';
  return (n / 1048576).toFixed(1) + ' MB/s';
}
function hhmm(t) {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function stamp(meta) {
  if (!meta) return '';
  if (meta.err && !meta.at) return '取不到';
  const t = hhmm(meta.at);
  return meta.err ? `${t} · 上次成功` : t;
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ---------------- 天气 ---------------- */
function renderWeather() {
  const w = snap && snap.weather;
  const m = snap && snap.meta && snap.meta.weather;
  $('wStamp').textContent = stamp(m);
  if (!w) {
    $('wTemp').textContent = '--';
    $('wCity').textContent = m && m.err ? '拿不到天气：' + m.err : '正在取…';
    return;
  }
  $('wTemp').textContent = w.temp;
  $('wIcon').textContent = w.icon;
  $('wCity').textContent = w.city;
  $('wText').textContent = w.text + (w.isDay ? '' : ' · 夜里');
  $('wRange').textContent = `${w.min} ~ ${w.max}°C`;
  $('wFeels').textContent = `体感 ${w.feels}°`;
  $('wWind').textContent = `风 ${w.wind} km/h`;
  $('wHum').textContent = `湿度 ${w.humidity}%`;

  const r = $('wRain');
  if (w.rain) {
    const t = w.rain.inMinutes <= 5 ? '马上' : `${w.rain.inMinutes} 分钟后`;
    r.hidden = false;
    r.textContent = `${t}有${w.rain.text}，概率 ${w.rain.prob}%。出门带伞。`;
  } else {
    r.hidden = true;
  }

  const hs = (w.hourly || []).slice(0, 8);
  $('wHours').innerHTML = hs.map((h) => `
    <div class="hrs">
      <div class="h">${hhmm(h.t)}</div>
      <div class="t">${h.temp}°</div>
      <div class="p">${h.prob >= 30 ? h.prob + '%' : ''}</div>
    </div>`).join('');
}

/* ---------------- 余额 ---------------- */
function isOffpeak() {
  if (!cfg || !cfg.offpeak || !cfg.offpeak.enabled) return false;
  const [sh, sm] = cfg.offpeak.start.split(':').map(Number);
  const [eh, em] = cfg.offpeak.end.split(':').map(Number);
  const d = new Date();
  const m = d.getHours() * 60 + d.getMinutes();
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (m >= s && m < e) : (m >= s || m < e);
}

function renderBalance() {
  const b = snap && snap.balance;
  const m = snap && snap.meta && snap.meta.balance;
  $('bStamp').textContent = stamp(m);

  const peak = $('bPeak');
  peak.textContent = isOffpeak() ? '优惠时段' : '标准时段';
  peak.className = 'tag2' + (isOffpeak() ? '' : ' peak');

  if (!b || !b.length) {
    $('bTotal').textContent = '--';
    $('bSpend').textContent = '还没填 Key。设置 → API Key 里贴上 DeepSeek 的 sk- 就行。';
    $('bList').innerHTML = '';
    $('bSpark').innerHTML = '';
    return;
  }

  const ok = b.filter((x) => x.ok);
  const total = cnySum(b);
  $('bTotal').textContent = ok.length ? money(total) : '--';

  const sp = snap.spend;
  if (sp && sp.fresh) $('bSpend').textContent = '今天开始记账了，明天就有对比';
  else if (sp && sp.total > 0) $('bSpend').textContent = `今天已用 ${money(sp.total)}`;
  else $('bSpend').textContent = '今天还没花钱';

  $('bList').innerHTML = b.map((x) => x.ok
    ? `<div class="brow"><span class="nm">${esc(x.name)}</span>
         ${x.granted > 0 ? `<span class="pill">赠 ${money(x.granted, x.currency)}</span>` : ''}
         <span class="vl">${money(x.total, x.currency)}</span></div>`
    : `<div class="brow"><span class="nm">${esc(x.name)}</span><span class="er">${esc(x.error || '查询失败')}</span></div>`
  ).join('');

  drawSpark(snap.history);
}

function drawSpark(points) {
  const el = $('bSpark');
  if (!points || points.length < 2) { el.innerHTML = ''; return; }
  const vals = points.map((p) => Object.values(p.v || {}).reduce((a, b) => a + b, 0));
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = Math.max(0.01, max - min);
  const W = 360, H = 38;
  const step = W / (vals.length - 1);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(H - 3 - ((v - min) / span) * (H - 8)).toFixed(1)}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <path d="${d}" fill="none" stroke="#b4432e" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" opacity=".65"/>
  </svg>`;
}

/* ---------------- 系统 ---------------- */
function renderSystem() {
  const s = snap && snap.system;
  const m = snap && snap.meta && snap.meta.system;
  $('sStamp').textContent = stamp(m);
  if (!s) return;

  const set = (barId, txtId, pct, label) => {
    const bar = $(barId);
    bar.style.width = Math.min(100, pct) + '%';
    bar.className = pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : '';
    $(txtId).textContent = label != null ? label : pct + '%';
  };
  set('barCpu', 'cpuTxt', s.cpu);
  set('barMem', 'memTxt', s.memPct);
  if (s.disk) set('barDisk', 'diskTxt', s.disk.pct, s.disk.pct + '%');
  else { $('barDisk').style.width = '0'; $('diskTxt').textContent = '—'; }

  const g = s.gpu;
  if (g && g.ok) {
    set('barGpu', 'gpuTxt', g.util);
    $('gpuVendor').textContent = g.vendor === 'nvidia' ? 'NVIDIA' : 'GPU · ' + (g.engine || 'engine');
    const bits = [];
    if (g.memTotal) bits.push(`${g.memUsed} / ${g.memTotal} MB`);
    if (g.temp != null) bits.push(g.temp + '°C');
    $('gpuExtra').textContent = bits.join(' · ');
  } else {
    $('barGpu').style.width = '0';
    $('barGpu').className = '';
    $('gpuTxt').textContent = '—';
    $('gpuVendor').textContent = (g && g.error) || 'GPU 不可用';
    $('gpuExtra').textContent = '';
  }

  $('netDown').textContent = bytes(s.down);
  $('netUp').textContent = bytes(s.up);
  $('memGB').textContent = `${s.memUsedGB} / ${s.memTotalGB} GB`;
}

/* ---------------- 资讯 ---------------- */
function renderNews() {
  const n = snap && snap.news;
  const m = snap && snap.meta && snap.meta.news;
  $('nStamp').textContent = stamp(m);
  if (!n) { $('nSummary').textContent = m && m.err ? '拿不到资讯：' + m.err : '正在取…'; return; }

  $('nSummary').textContent = n.summary || '';
  const items = (n.items || []).slice(0, 14);
  $('nList').innerHTML = items.map((i) => `
    <li data-url="${esc(i.link || '')}">
      <span class="src">${esc(i.source || '')}</span>
      <span>${esc(i.title || '')}</span>
    </li>`).join('');

  $('nList').querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => { const u = li.dataset.url; if (u) api.openLink(u); });
  });
}

function renderGithub() {
  const g = snap && snap.github;
  const show = !!(cfg && cfg.cards && cfg.cards.github);
  $('cardGh').style.display = show ? '' : 'none';
  if (!show) return;
  $('gStamp').textContent = g ? stamp(snap.meta.github) : '';
  if (!g) { $('gList').innerHTML = '<li><span>还没配 GitHub 用户名</span></li>'; return; }
  $('gList').innerHTML = (g.items || []).map((i) => `
    <li data-url="${esc(i.link || '')}">
      <span class="src">${esc(i.repo || '')}</span>
      <span>${esc(i.title || i.type || '')}</span>
    </li>`).join('');
}

/* ---------------- 论文 ---------------- */
let lastPapers = null;
function renderPapers() {
  const p = snap && snap.papers;
  const m = snap && snap.meta && snap.meta.papers;
  $('pStamp').textContent = stamp(m);
  if (!p) {
    $('pMeta').textContent = m && m.err ? '抓取失败：' + m.err : '正在抓 arXiv…';
    $('pList').innerHTML = '';
    lastPapers = null;
    return;
  }
  if (p === lastPapers) return;
  lastPapers = p;

  if (p.empty) {
    $('pMeta').textContent = '还没设置话题';
    $('pList').innerHTML = `<li class="paper"><p class="p-tldr">先在下面「订阅话题」里点一个模板，或者自己填关键词 —— 填完这里就有论文了。</p></li>`;
    return;
  }
  if (!p.items.length) {
    $('pMeta').textContent = `扫了 ${p.poolSize} 篇，没有命中`;
    $('pList').innerHTML = `<li class="paper"><p class="p-tldr">话题太窄了。把关键词放宽一点，或者加一个同义词试试。</p></li>`;
    return;
  }

  const tldrOn = !!(cfg && cfg.papers && cfg.papers.tldr);
  const hasTldr = p.items.some((x) => x.tldr);
  $('pMeta').textContent = `扫了 ${p.poolSize} 篇，留下 ${p.items.length} 篇`
    + (hasTldr ? ' · 含中文摘要' : (tldrOn ? ' · 填了 DeepSeek Key 就会有中文摘要' : ''));
  $('pList').innerHTML = p.items.map((it, i) => `
    <li class="paper" data-i="${i}">
      <div class="p-top">
        <span class="p-topic">${esc(it.topic || '')}</span>
        <span>${esc((it.published || '').slice(0, 10))}</span>
        <span>·</span>
        <span>${esc(it.src || 'arXiv')}</span>
        <span style="margin-left:auto">${it.cites ? '引用 ' + it.cites + ' · ' : ''}${it.score}</span>
      </div>
      <p class="p-title" data-act="open">${esc(it.title)}</p>
      ${it.tldr ? `<p class="p-tldr">${esc(it.tldr)}</p>` : ''}
      <p class="p-meta">${esc((it.authors || []).slice(0, 3).join(', '))}${(it.authors || []).length > 3 ? ' 等' : ''} · 命中 ${esc((it.hits || []).join(' / '))}</p>
      <div class="p-acts">
        <button data-act="open">打开</button>
        <button data-act="pdf">PDF</button>
        <button data-act="save">存进文献库</button>
      </div>
    </li>`).join('');
}

$('pList').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const li = btn.closest('li');
  const it = snap && snap.papers && snap.papers.items[+li.dataset.i];
  if (!it) return;
  const act = btn.dataset.act;
  if (act === 'open') api.openLink(it.id);
  else if (act === 'pdf') api.openLink(it.pdf);
  else if (act === 'save') {
    const r = await api.libAdd(it);
    if (r && r.ok) { btn.textContent = '已存 ' + r.count; btn.classList.add('done'); }
  }
});

let topicSig = '';
function renderTopics() {
  if (!cfg || !cfg.papers) return;
  const topics = cfg.papers.topics || [];
  const sig = JSON.stringify(topics);
  if (sig === topicSig) return;
  topicSig = sig;

  if (!topics.length) {
    $('topicBox').innerHTML = '<div class="hint" style="margin:0 0 6px">还没有话题。点上面的模板一键加，或者「自己填」。</div>';
    return;
  }

  $('topicBox').innerHTML = topics.map((t) => `
    <div class="topic" data-id="${esc(t.id)}">
      <div class="topic-h">
        <b>${esc(t.name)}</b>
        <input type="checkbox" data-on ${t.on !== false ? 'checked' : ''}>
        <button class="tdel" data-del title="删掉这个话题">×</button>
      </div>
      <textarea class="inp ta" data-kw rows="3">${esc((t.keywords || []).join(', '))}</textarea>
      <div class="sub">排除：<input class="inp" data-ex value="${esc((t.exclude || []).join(', '))}" style="height:24px;margin-top:4px"></div>
    </div>`).join('');
  $('topicBox').querySelectorAll('textarea').forEach((ta) => { ta.scrollTop = 0; });
}

/* 话题模板：给新用户一个能立刻跑起来的起点 */
const TEMPLATES = {
  ai: {
    name: 'AI / 大模型',
    keywords: ['large language model', 'LLM', 'reasoning', 'agent', 'multimodal'],
    exclude: ['survey'], cats: ['cs.CL', 'cs.AI']
  },
  materials: {
    name: '材料 / 物理',
    keywords: ['perovskite', 'thin film', 'dielectric', 'nanomaterial', 'crystal growth'],
    exclude: ['survey'], cats: ['cond-mat.mtrl-sci', 'physics.app-ph']
  },
  bio: {
    name: '生物 / 医学',
    keywords: ['protein structure', 'single-cell', 'CRISPR', 'biomarker', 'drug delivery'],
    exclude: ['survey'], cats: ['q-bio.BM', 'q-bio.QM']
  },
  econ: {
    name: '经济 / 金融',
    keywords: ['causal inference', 'panel data', 'asset pricing', 'market microstructure'],
    exclude: ['survey'], cats: ['econ.EM', 'q-fin.TR']
  },
  blank: { name: '新话题', keywords: [], exclude: [], cats: [] }
};

$('topicTpl').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-tpl]');
  if (!btn) return;
  const tpl = TEMPLATES[btn.dataset.tpl];
  if (!tpl) return;
  const topics = (cfg.papers.topics || []).slice();
  const id = 't' + Date.now().toString(36);
  topics.push({ ...tpl, id, on: true, max: 60 });
  cfg = await api.patchConfig({ papers: { topics } });
  topicSig = '';
  renderTopics();
  lastPapers = null;
  $('pMeta').textContent = '正在抓 arXiv…';
  $('pList').innerHTML = '';
  api.refresh('papers');
});

async function saveTopic(id, patch) {
  const topics = (cfg.papers.topics || []).map((t) => (t.id === id ? { ...t, ...patch } : t));
  cfg = await api.patchConfig({ papers: { topics } });
  topicSig = '';
  renderTopics();
}

$('topicBox').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-del]');
  if (!btn) return;
  const row = btn.closest('.topic');
  if (!row) return;
  const id = row.dataset.id;
  const topics = (cfg.papers.topics || []).filter((t) => t.id !== id);
  cfg = await api.patchConfig({ papers: { topics } });
  topicSig = '';
  renderTopics();
  lastPapers = null;
});

$('topicBox').addEventListener('change', (e) => {
  const row = e.target.closest('.topic');
  if (!row) return;
  const id = row.dataset.id;
  if (e.target.dataset.on !== undefined) saveTopic(id, { on: e.target.checked });
  else if (e.target.dataset.kw !== undefined) {
    saveTopic(id, { keywords: e.target.value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean) });
  } else if (e.target.dataset.ex !== undefined) {
    saveTopic(id, { exclude: e.target.value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean) });
  }
});

$('btnPaperNow').addEventListener('click', async () => {
  $('btnPaperNow').textContent = '抓取中…';
  await api.refresh('papers');
  lastPapers = null;
  renderPapers();
  $('btnPaperNow').textContent = '立刻抓一次';
});

function renderLibrary() {
  const lib = (snap && snap.library) || [];
  $('libCount').textContent = lib.length;
  $('libList').innerHTML = lib.length
    ? lib.map((x) => `<li data-url="${esc(x.id || '')}"><span class="src">${esc((x.published || '').slice(0, 7))}</span><span>${esc(x.title)}</span></li>`).join('')
    : '<li><span>还没有。看到想引的，点上面的「存进文献库」。</span></li>';
  $('libList').querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => { const u = li.dataset.url; if (u) api.openLink(u); });
  });
}

$('btnBibAll').addEventListener('click', async () => {
  const r = await api.libCopy('');
  $('btnBibAll').textContent = r && r.ok ? `已复制 ${r.count} 条` : '还没有文献';
  setTimeout(() => { $('btnBibAll').textContent = '复制全部 BibTeX'; }, 2200);
});

$('btnBibFile').addEventListener('click', async () => {
  const r = await api.libExport();
  if (r && r.ok) {
    $('btnBibFile').textContent = `已导出 ${r.count} 条`;
    setTimeout(() => { $('btnBibFile').textContent = '导出 .bib'; }, 2200);
  }
});

/* ---------------- 渲染总入口 ---------------- */
function render() {
  if (!snap) return;
  renderWeather();
  renderBalance();
  renderSystem();
  renderPapers();
  renderTopics();
  renderLibrary();
  renderNews();
  renderGithub();
  renderPets();
}

/* ---------------- 设置 ---------------- */
function fillSettings() {
  if (!cfg) return;
  $('petName').textContent = (cfg.pet && cfg.pet.name) || '桌宠';
  $('petNameInp').value = (cfg.pet && cfg.pet.name) || '桌宠';
  $('cityHint').textContent = `当前：${cfg.city.name}（${cfg.city.lat.toFixed(2)}, ${cfg.city.lon.toFixed(2)}）`;

  $('rngBal').value = cfg.thresholds.balanceLow;
  $('lblBal').textContent = '¥' + cfg.thresholds.balanceLow;
  $('rngSit').value = cfg.thresholds.sitMinutes;
  $('lblSit').textContent = cfg.thresholds.sitMinutes;
  $('rngNight').value = cfg.thresholds.nightHour;
  $('lblNight').textContent = fmtNight(cfg.thresholds.nightHour);

  $('rngScale').value = cfg.pet.scale;
  $('lblScale').textContent = Number(cfg.pet.scale).toFixed(1) + '×';
  $('swQuiet').checked = !!cfg.pet.quiet;
  $('swReport').checked = cfg.pet.autoReport !== false;
  $('rngReport').value = cfg.pet.reportMinutes || 5;
  $('lblReport').textContent = cfg.pet.reportMinutes || 5;
  $('swReduce').checked = !!cfg.pet.reduceMotion;
  $('swWalk').checked = cfg.pet.autoWalk !== false;

  $('swSys').checked = !!cfg.cards.system;
  $('swGh').checked = !!cfg.cards.github;

  $('ghUser').value = (cfg.github && cfg.github.user) || '';
  $('keyHint').textContent = cfg.hasKey && cfg.hasKey.deepseek
    ? '已保存（DPAPI 加密，只在这台机器能解开）'
    : '还没有填。填了才会显示余额和今日消耗。';
}

function fmtNight(h) {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/* ---------------- 事件 ---------------- */
$('btnClose').addEventListener('click', () => api.closePanel());
$('btnRefresh').addEventListener('click', async () => {
  $('btnRefresh').textContent = '…';
  await api.refresh(null);
  $('btnRefresh').textContent = '↻';
});

document.querySelectorAll('.tb').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('.tb').forEach((x) => x.classList.remove('on'));
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    $('tab-' + b.dataset.tab).classList.add('on');
    $('body').scrollTop = 0;
  });
});

/* 城市搜索 */
$('btnCity').addEventListener('click', async () => {
  const q = $('cityInput').value.trim();
  if (!q) return;
  $('cityHint').textContent = '搜索中…';
  try {
    const c = await api.searchCity(q);
    $('cityHint').textContent = `找到 ${c.admin ? c.admin + ' · ' : ''}${c.name}`;
    $('cityList').innerHTML = `<button>${esc(c.name)}${c.admin ? ' · ' + esc(c.admin) : ''}${c.country ? ' · ' + esc(c.country) : ''}</button>`;
    $('cityList').querySelector('button').addEventListener('click', async () => {
      cfg = await api.patchConfig({ city: { name: c.name, lat: c.lat, lon: c.lon } });
      $('cityList').innerHTML = '';
      fillSettings();
    });
  } catch (e) {
    $('cityHint').textContent = '找不到：' + e.message;
  }
});

/* Key */
$('btnKey').addEventListener('click', async () => {
  const v = $('keyDeepseek').value.trim();
  if (!v) return;
  const r = await api.setSecret('deepseek', v);
  cfg = r.cfg;
  $('keyDeepseek').value = '';
  fillSettings();
  $('keyHint').textContent = r.ok ? '已保存，正在查余额…' : '保存失败，看下控制台';
});
$('btnKeyMore').addEventListener('click', async () => {
  for (const id of ['moonshot', 'siliconflow', 'openrouter']) {
    const el = $('key' + id[0].toUpperCase() + id.slice(1));
    if (el && el.value.trim()) await api.setSecret(id, el.value.trim());
    if (el) el.value = '';
  }
  await api.refresh('balance');
  $('keyHint').textContent = '其他平台已保存';
});

/* 阈值 */
$('rngBal').addEventListener('input', (e) => { $('lblBal').textContent = '¥' + e.target.value; });
$('rngBal').addEventListener('change', async (e) => { cfg = await api.patchConfig({ thresholds: { balanceLow: +e.target.value } }); });

$('rngSit').addEventListener('input', (e) => { $('lblSit').textContent = e.target.value; });
$('rngSit').addEventListener('change', async (e) => { cfg = await api.patchConfig({ thresholds: { sitMinutes: +e.target.value } }); });

$('rngNight').addEventListener('input', (e) => { $('lblNight').textContent = fmtNight(+e.target.value); });
$('rngNight').addEventListener('change', async (e) => { cfg = await api.patchConfig({ thresholds: { nightHour: +e.target.value } }); });

/* 宠物 */
$('rngScale').addEventListener('input', (e) => { $('lblScale').textContent = (+e.target.value).toFixed(1) + '×'; });
$('rngScale').addEventListener('change', async (e) => { cfg = await api.patchConfig({ pet: { scale: +e.target.value } }); });

$('swQuiet').addEventListener('change', async (e) => { cfg = await api.patchConfig({ pet: { quiet: e.target.checked } }); });
$('swReport').addEventListener('change', async (e) => { cfg = await api.patchConfig({ pet: { autoReport: e.target.checked } }); });
$('rngReport').addEventListener('input', (e) => { $('lblReport').textContent = e.target.value; });
$('rngReport').addEventListener('change', async (e) => { cfg = await api.patchConfig({ pet: { reportMinutes: +e.target.value } }); });
$('swReduce').addEventListener('change', async (e) => { cfg = await api.patchConfig({ pet: { reduceMotion: e.target.checked } }); });
$('swWalk').addEventListener('change', async (e) => { cfg = await api.patchConfig({ pet: { autoWalk: e.target.checked } }); });

$('swSys').addEventListener('change', async (e) => { cfg = await api.patchConfig({ cards: { system: e.target.checked } }); });
$('swGh').addEventListener('change', async (e) => {
  cfg = await api.patchConfig({ cards: { github: e.target.checked } });
  if (e.target.checked) await api.refresh('github');
});

$('ghUser').addEventListener('change', async (e) => {
  cfg = await api.patchConfig({ github: { user: e.target.value.trim() } });
  await api.refresh('github');
});

/* 形象 */
let petSig = '';
async function renderPets() {
  let r = null;
  try { r = await api.petList(); } catch (e) { return; }
  if (!r) return;
  const sig = r.active + '|' + r.items.map((i) => i.path).join(',');
  if (sig === petSig) return;
  petSig = sig;
  $('petGrid').innerHTML = r.items.map((p) => {
    const url = p.thumb || ('file:///' + String(p.path).replace(/\\/g, '/'));
    const on = p.path === r.active ? ' on' : '';
    return `<div class="cell${on}" data-path="${esc(p.path)}" title="${esc(p.name)}">
      <img src="${url}" alt=""><span class="lab">${esc(p.name)}</span></div>`;
  }).join('') || '<div class="hint" style="grid-column:1/-1">素材文件夹是空的</div>';
}

$('petGrid').addEventListener('click', async (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !cell.dataset.path) return;
  await api.petSelect(cell.dataset.path);
  petSig = '';
  renderPets();
});

$('btnPickImg').addEventListener('click', async () => {
  const p = await api.pickImage();
  if (p) {
    cfg = await api.getConfig();
    petSig = '';
    renderPets();
  }
});

$('btnOpenPetDir').addEventListener('click', () => api.openPetDir());

$('petNameInp').addEventListener('change', async (e) => {
  const name = (e.target.value || '').trim().slice(0, 12) || '桌宠';
  cfg = await api.patchConfig({ pet: { name } });
  e.target.value = name;
  $('petName').textContent = name;
});

$('btnConfDir').addEventListener('click', () => api.openConfigDir());
$('btnPetDir').addEventListener('click', () => api.openPetDir());

/* ---------------- 时钟 ---------------- */
function tickClock() {
  const d = new Date();
  $('clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* ---------------- 启动 ---------------- */
api.on('data:update', (d) => {
  snap = d;
  cfg = d.cfg;
  fillSettings();
  render();
});

(async () => {
  tickClock();
  setInterval(tickClock, 10000);
  document.querySelectorAll('input').forEach((i) => { i.autocomplete = 'off'; i.spellcheck = false; });
  $('cityInput').value = '';
  try {
    cfg = await api.getConfig();
    snap = await api.getData();
    fillSettings();
    render();
  } catch (e) {
    console.error(e);
  }
})();

})();
