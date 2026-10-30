'use strict';
/* 桌宠 · 舞台渲染：状态机 + 物理 + 气泡 */
(function () {

const api = window.api;
window.__errs = [];
window.addEventListener('error', (e) => window.__errs.push(e.message));
window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));
const petEl = document.getElementById('pet');
const svgEl = document.getElementById('catSvg');
const imgEl = document.getElementById('petImg');
const bubble = document.getElementById('bubble');
const bTag = document.getElementById('bTag');
const bMsg = document.getElementById('bMsg');

const BASE_H = 160;
let PET_W = 150, PET_H = 160;
let imgMode = false, imgRatio = 150 / 160;
const GRAVITY = 1500;

let cfg = { pet: {} };
let snap = null;

let x = Math.round(innerWidth * 0.74);
let y = 0;
let vx = 0, vy = 0;

let dragging = false, moved = false, startCX = 0, startCY = 0;
let offX = 0, offY = 0;
let trkX = 0, trkY = 0, lastSX = 0, lastSY = 0, lastT = 0;

let mode = 'idle';           // idle | walk | sleep
let targetX = null;
let facing = 1;
let lastInteract = Date.now();
let busy = false;

/* ---------------- 影子 ---------------- */
const shadow = document.createElement('div');
shadow.id = 'shadow';
document.getElementById('scene').appendChild(shadow);

/* ---------------- 位置 ---------------- */
function clampPos() {
  const minX = PET_W / 2 + 4;
  const maxX = innerWidth - PET_W / 2 - 4;
  x = Math.max(minX, Math.min(maxX, x));
  y = Math.max(0, Math.min(280, y));
}
function paint() {
  petEl.style.left = Math.round(x - PET_W / 2) + 'px';
  petEl.style.bottom = Math.round(y) + 'px';
  const lean = (mode === 'walk' && !imgMode) ? facing * 1.5 : (mode === 'walk' ? facing * 1.2 : 0);
  petEl.style.transform = imgMode ? `rotate(${lean}deg)` : `scaleX(${facing}) rotate(${lean}deg)`;
  shadow.style.left = Math.round(x) + 'px';
  const k = Math.max(0.35, 1 - y / 420);
  shadow.style.width = (PET_W * 0.66 * k) + 'px';
  shadow.style.opacity = String(k);
  if (bubble.classList.contains('show')) placeBubble();
}

function placeBubble() {
  const w = bubble.offsetWidth || 200;
  const half = w / 2;
  let cx = x;
  cx = Math.max(half + 8, Math.min(innerWidth - half - 8, cx));
  bubble.style.left = cx + 'px';
  bubble.style.bottom = (y + PET_H - 4) + 'px';
}

/* ---------------- 视觉状态 ---------------- */
let squashTimer = null;
function squash() {
  petEl.classList.remove('landing');
  void petEl.offsetWidth;
  petEl.classList.add('landing');
  clearTimeout(squashTimer);
  squashTimer = setTimeout(() => petEl.classList.remove('landing'), 300);
}

function setVisual() {
  let s = 'idle';
  if (dragging || y > 2) s = 'drag';
  else if (mode === 'sleep') s = 'sleep';
  else if (mode === 'walk') s = 'walk';
  else if (busy) s = 'busy';
  petEl.dataset.state = s;
}

/* ---------------- 气泡 ---------------- */
let bubbleTimer = null;
function showBubble(text, kind = 'normal', ms = 7000) {
  if (!text) return;
  bTag.textContent = kind === 'warn' ? '提醒' : kind === 'info' ? '消息' : '桌宠';
  bMsg.textContent = text;
  bubble.className = 'bubble ' + (kind === 'warn' ? 'warn' : kind === 'info' ? 'info' : '');
  placeBubble();
  requestAnimationFrame(() => bubble.classList.add('show'));
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove('show'), ms);
}

/* ---------------- 物理循环 ---------------- */
let prevT = performance.now();
function tick(now) {
  const moving = dragging || y > 0 || vy !== 0 || mode === 'walk';
  const elapsed = (now - prevT) / 1000;
  // 静止时降到 ~30fps，省电
  if (!moving && elapsed < 0.032) { requestAnimationFrame(tick); return; }
  const dt = Math.min(0.05, elapsed);
  prevT = now;

  if (!dragging) {
    // 重力
    if (y > 0 || vy !== 0) {
      vy -= GRAVITY * dt;
      y += vy * dt;
      if (y <= 0) {
        y = 0;
        if (Math.abs(vy) > 90) {
          if (Math.abs(vy) > 300) squash();
          vy = -vy * 0.32;
        } else vy = 0;
      }
      // 空中水平惯性
      if (y > 0) { x += vx * dt; vx *= 0.995; }
      else { vx *= 0.8; if (Math.abs(vx) < 6) vx = 0; }
      clampPos();
    }

    // 散步
    if (mode === 'walk' && targetX != null && y === 0) {
      const d = targetX - x;
      if (Math.abs(d) < 4) {
        targetX = null; mode = 'idle';
      } else {
        const dir = Math.sign(d);
        x += dir * 46 * dt;
        if (dir !== facing) { facing = dir; }
        clampPos();
      }
    }

    // 久不理我就睡
    if (mode !== 'sleep' && Date.now() - lastInteract > 300000) {
      mode = 'sleep'; targetX = null;
      if (!cfg.pet.quiet) showBubble('……zzz', 'normal', 3500);
    }
  }

  setVisual();
  paint();
  requestAnimationFrame(tick);
}

/* ---------------- 自主行为 ---------------- */
let planTimer = null;
function planNext() {
  clearTimeout(planTimer);
  planTimer = setTimeout(() => {
    if (cfg.pet && cfg.pet.autoWalk !== false && mode !== 'sleep' && !dragging && y === 0) {
      if (Math.random() < 0.62) {
        const pad = 90;
        targetX = pad + Math.random() * Math.max(10, innerWidth - pad * 2);
        mode = 'walk';
      }
    }
    planNext();
  }, 9000 + Math.random() * 12000);
}

/* ---------------- 交互 ---------------- */
let ignoring = null;
function setIgnore(v) {
  if (ignoring === v) return;
  ignoring = v;
  api.setIgnore(v);
}
let lastMoveAt = Date.now();

document.addEventListener('mousemove', (e) => {
  lastMoveAt = Date.now();

  if (dragging) {
    // 松开是发生在窗口外面 / 选择窗口抢过焦点时，mouseup 永远收不到，
    // 宠物就会黏在鼠标上、左键怎么点都没反应。用 buttons 兜底。
    if (e.buttons === 0) { endDrag(false); return; }
    if (Math.abs(e.clientX - startCX) > 3 || Math.abs(e.clientY - startCY) > 3) moved = true;
    x = e.clientX - offX;
    y = (innerHeight - e.clientY) - offY;
    clampPos();

    const now = performance.now();
    const dt = Math.max(0.01, (now - lastT) / 1000);
    trkX = (e.screenX - lastSX) / dt;
    trkY = -(e.screenY - lastSY) / dt;
    lastSX = e.screenX; lastSY = e.screenY; lastT = now;
    setVisual(); paint();
    return;
  }

  const el = document.elementFromPoint(e.clientX, e.clientY);
  const hit = !!(el && el.closest && el.closest('.hit'));
  setIgnore(!hit);
  petEl.style.cursor = hit ? 'grab' : 'default';
});

document.addEventListener('mouseleave', (e) => {
  if (dragging && e.buttons === 0) endDrag(false);
  if (!dragging) setIgnore(true);
});
setInterval(() => {
  if (!dragging && Date.now() - lastMoveAt > 1500) setIgnore(true);
}, 700);

// 窗口被遮住 / 失焦 / 被主进程要求重置时，一定要把拖拽状态清掉
window.addEventListener('blur', () => { if (dragging) endDrag(false); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dragging) endDrag(false); });
api.on('stage:reset', (pos) => {
  dragging = false; moved = false;
  lastMoveAt = Date.now();
  let over = false;
  if (pos && pos.cx >= 0) {
    const fromBottom = innerHeight - pos.cy;
    over = pos.cx >= x - PET_W / 2 && pos.cx <= x + PET_W / 2
      && fromBottom >= y && fromBottom <= y + PET_H;
  }
  ignoring = null;
  setIgnore(!over);
  setVisual();
  paint();
});

// 自检探针用
window.__dbg = () => ({ dragging, ignoring, mode, x: Math.round(x), y: Math.round(y) });

petEl.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  dragging = true;
  moved = false;
  startCX = e.clientX; startCY = e.clientY;
  offX = e.clientX - (x - PET_W / 2);
  offY = (innerHeight - e.clientY) - y;
  lastSX = e.screenX; lastSY = e.screenY; lastT = performance.now();
  trkX = 0; trkY = 0; vx = 0; vy = 0;
  targetX = null;
  lastInteract = Date.now();
  setVisual();
});

document.addEventListener('mouseup', () => {
  if (!dragging) return;
  endDrag(true);
});

function endDrag(useThrow) {
  dragging = false;
  lastInteract = Date.now();

  if (!moved) {
    onClick();
    return;
  }
  if (!useThrow) { trkX = 0; trkY = 0; }
  vx = Math.max(-1300, Math.min(1300, trkX));
  vy = Math.max(-150, Math.min(1150, trkY));
  mode = 'idle';
  if (y === 0 && vy < 0) vy = 0;
  setVisual();
}

petEl.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.openPanel(window.screenX + x);
});

function onClick() {
  lastInteract = Date.now();
  if (mode === 'sleep') mode = 'idle';
  speakNext(false);
}

function money(n) { return '¥' + (n >= 100 ? n.toFixed(1) : n.toFixed(2)); }

/* ---------------- 播报内容 ---------------- */
// 左键按这个顺序轮：天气 → 余额 → 资讯 → 论文
const TOPICS = ['weather', 'balance', 'news', 'papers'];
let topicIdx = 0;
let newsCursor = 0;
let paperCursor = 0;
let weatherCursor = 0;
let lastNewsSource = '';
let lastSpokeAt = 0;

function cleanTitle(t) {
  return String(t || '')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+\s*\{[^{}]*\}/g, ' ')
    .replace(/[\\{}$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function lineFor(topic) {
  const d = snap;
  if (!d) return null;
  const w = d.weather, b = d.balance, n = d.news, p = d.papers;

  if (topic === 'weather') {
    if (!w) return null;
    const k = weatherCursor++ % 2;
    if (k === 1) {
      const hrs = (w.hourly || []).slice(0, 3).map((x) => `${x.temp}°`).join(' → ');
      if (hrs) return `${w.city} 接下来 ${hrs}，风 ${w.wind}km/h，湿度 ${w.humidity}%。`;
    }
    const rain = w.rain
      ? ` ${w.rain.inMinutes <= 5 ? '马上' : w.rain.inMinutes + ' 分钟后'}有雨，带伞。`
      : '';
    const tip = w.temp >= 33 ? '热得离谱，别乱跑。' : w.temp <= 2 ? '冷，穿厚点。' : '';
    return `${w.city} ${w.temp}°，${w.text}，今天 ${w.min}~${w.max}°。${rain}${tip}`;
  }

  if (topic === 'balance') {
    const ok = (b || []).filter((x) => x.ok);
    if (!ok.length) return null;
    const total = ok.filter((x) => x.currency === 'CNY').reduce((a, x) => a + x.total, 0);
    const name = ok.length > 1 ? 'API 余额' : ok[0].name;
    const now = money(ok.length > 1 ? total : ok[0].total);
    const spent = d.spend && d.spend.total ? `，今天花了 ${money(d.spend.total)}` : '';
    const low = (cfg.thresholds && total < cfg.thresholds.balanceLow) ? '，快见底了' : '';
    return `${name} 还剩 ${now}${spent}${low}。`;
  }

  if (topic === 'news') {
    if (!n) return null;
    const summary = (n.summary || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (summary.length) {
      const line = summary[newsCursor++ % summary.length];
      return `资讯｜${line}`;
    }
    const items = n.items || [];
    if (!items.length) return null;
    // 尽量换源，别连着两条都是「每日 60 秒」
    let idx = newsCursor % items.length;
    for (let k = 0; k < items.length; k++) {
      const j = (newsCursor + k) % items.length;
      if (items[j] && items[j].source !== lastNewsSource) { idx = j; break; }
    }
    newsCursor = idx + 1;
    lastNewsSource = items[idx].source;
    return `资讯｜${items[idx].source}：${clip(cleanTitle(items[idx].title), 48)}`;
  }

  if (topic === 'papers') {
    const items = (p && p.items) || [];
    if (!items.length) return null;
    const it = items[paperCursor++ % items.length];
    const body = it.tldr ? it.tldr : cleanTitle(it.title);
    return `论文｜${clip(body, 46)}`;
  }

  return null;
}

function speakNext(auto) {
  lastSpokeAt = Date.now();
  lastInteract = Date.now();
  if (mode === 'sleep') mode = 'idle';

  for (let i = 0; i < TOPICS.length; i++) {
    const t = TOPICS[topicIdx % TOPICS.length];
    topicIdx = (topicIdx + 1) % TOPICS.length;
    const txt = lineFor(t);
    if (txt) {
      showBubble(txt, 'normal', auto ? 11000 : 8500);
      return t;
    }
  }
  // 一条数据都没有（刚开始或者都没配）
  showBubble('我还没拿到数据。右键点我，看看是不是 Key 或者网络的事。', 'normal', 7000);
  return null;
}

/* ---------------- 数据 ---------------- */
function applyCfg(c) {
  if (!c) return;
  cfg = c;
  layout();
  document.body.classList.toggle('reduce', !!(c.pet && c.pet.reduceMotion));
  const img = c.pet && c.pet.image ? c.pet.image : '';
  const want = img || BUILTIN_CAT;
  if (imgEl.dataset.want !== want) applyImage(img);
}

const BUILTIN_CAT = '../assets/pet/cat.png';

function layout() {
  const k = Math.max(0.6, Math.min(1.8, (cfg.pet && cfg.pet.scale) || 1));
  PET_H = Math.round(BASE_H * k);
  PET_W = Math.round(PET_H * imgRatio);
  petEl.style.width = PET_W + 'px';
  petEl.style.height = PET_H + 'px';
}

function applyImage(p) {
  const src = p ? 'file:///' + String(p).replace(/\\/g, '/') : BUILTIN_CAT;
  imgEl.dataset.want = p || BUILTIN_CAT;
  imgEl.onload = () => {
    imgRatio = (imgEl.naturalWidth || 150) / (imgEl.naturalHeight || 160);
    imgMode = true;
    layout();
    paint();
  };
  imgEl.onerror = () => {
    imgMode = false;
    imgEl.style.display = 'none';
    svgEl.style.display = 'block';
    imgRatio = 150 / 160;
    layout();
  };
  imgEl.src = src;
  imgEl.style.display = 'block';
  svgEl.style.display = 'none';
}

/* ---------------- 自动播报 ---------------- */
let nextReportAt = Date.now() + 40000;   // 起来 40 秒后先报一条
let lastNewsSig = '';
let lastPaperSig = '';

function reportGap() {
  const m = Math.max(1, Math.min(30, (cfg.pet && cfg.pet.reportMinutes) || 5));
  return m * 60e3 * (0.75 + Math.random() * 0.5);
}
function scheduleReport() { nextReportAt = Date.now() + reportGap(); }

/** 抓到新资讯/新论文就早点报，别等满一个周期 */
function bumpReportSoon(delay) {
  if (Date.now() - lastSpokeAt < 90e3) return;   // 一分钟内刚说过，别连着刷
  nextReportAt = Math.min(nextReportAt, Date.now() + delay);
}

setInterval(() => {
  if (!cfg.pet) return;
  if (cfg.pet.quiet) return;
  if (cfg.pet.autoReport === false) return;
  if (dragging) return;
  if (bubble.classList.contains('show')) return;
  if (Date.now() < nextReportAt) return;
  speakNext(true);
  scheduleReport();
}, 15000);

api.on('data:update', (d) => {
  snap = d;
  window.__snap = d;
  applyCfg(d.cfg);
  if (d.system) {
    const wasBusy = busy;
    busy = d.system.cpu >= 85;
    if (busy !== wasBusy) setVisual();
  }

  const n = d.news;
  const ns = n ? (n.items || []).length + ':' + (((n.items || [])[0] || {}).title || '') : '';
  if (ns && ns !== lastNewsSig) { lastNewsSig = ns; bumpReportSoon(15000); }

  const p = d.papers;
  const ps = p ? (p.items || []).length + ':' + (((p.items || [])[0] || {}).title || '') : '';
  if (ps && ps !== lastPaperSig) { lastPaperSig = ps; bumpReportSoon(22000); }
});

api.on('pet:reload', ({ image }) => applyImage(image || ''));

api.on('pet:say', (item) => {
  lastInteract = Date.now();
  if (mode === 'sleep') mode = 'idle';
  showBubble(item.text, item.kind || 'normal', item.kind === 'warn' ? 11000 : 7000);
});

/* ---------------- 启动 ---------------- */
(async () => {
  try {
    const c = await api.getConfig();
    applyCfg(c);
    snap = await api.getData();
    if (snap && snap.system) busy = snap.system.cpu >= 85;
  } catch (e) {
    console.error(e);
  }
  clampPos();
  paint();
  requestAnimationFrame(tick);
  planNext();

  // 起来先说一句正事，别干等着
  setTimeout(() => {
    if (cfg.pet && cfg.pet.quiet) return;
    speakNext(true);
    scheduleReport();
  }, 2600);
})();

})();
