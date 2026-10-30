'use strict';
/**
 * 桌宠 · 主进程
 * stage 窗口 = 屏幕底部一条透明「舞台」：宠物在里面走、被抛、睡觉，全屏点击穿透
 * panel 窗口 = 点宠物后弹出的卡片坞
 */

// 用 .bat 的 start 启动时没有控制台，stdout 是断管，console.log 会抛 EPIPE 把主进程带走。
// 先把管道错误吞掉，再兜一个 uncaughtException，别弹那个吓人的 Error 框。
process.stdout.on('error', () => { });
process.stderr.on('error', () => { });
process.on('uncaughtException', (err) => {
  try { console.error('[未捕获]', err && err.message); } catch (_) { }
});

const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, safeStorage, dialog, nativeImage, shell, clipboard, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const store = require('./lib/store');
const P = require('./lib/providers');

const IS_DEV = process.argv.includes('--dev');
const SHOT = process.argv.includes('--shot');
const STAGE_H = 420;

// 自检模式用独立 profile，避免和正在运行的实例抢单例锁
if (SHOT || process.argv.includes('--probe')) {
  try {
    const p = path.join(__dirname, '.workbuddy', process.argv.includes('--probe') ? 'probe-profile' : 'shot-profile');
    fs.mkdirSync(p, { recursive: true });
    app.setPath('userData', p);
  } catch (e) { console.error('设置 profile 失败', e.message); }
}

// 默认硬件加速（透明窗口 + 动画都靠它）。
// 远程桌面 / 虚拟机里 GPU 进程可能起不来，加 --soft 走软件渲染。
if (process.argv.includes('--soft')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
} else {
  // GPU 进程的沙箱在受限环境（远程桌面、虚拟显卡、受限令牌）里会直接
  // FATAL 掉整个应用。关掉 GPU 沙箱、保留渲染进程沙箱，兼容性最好。
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}
// 逃生口：CHACHONG_SWITCHES="in-process-gpu,disable-gpu" npm start
(process.env.CHACHONG_SWITCHES || '').split(',').map((s) => s.trim()).filter(Boolean)
  .forEach((s) => app.commandLine.appendSwitch(s));

let stage = null;
let panel = null;
let tray = null;
let hiddenByBoss = false;

const state = {
  weather: null, balance: null, news: null, github: null, arxiv: null, system: null,
  papers: null,
  library: [],        // 待引文献库 [{id,title,authors,published,abs,pdf,addedAt}]
  meta: {},           // {card: {at, err}}
  spendBase: null,    // {date, v:{}}
  history: [],        // [{t, v:{deepseek: 100}}]
  lastRemind: {},     // {key: timestamp}
  reminders: []       // {id, text, at, kind}
};

/* ------------------------------------------------------------ 文献库 */
function libraryFile() { return path.join(store.dir(), 'library.json'); }
function loadLibrary() {
  try {
    if (fs.existsSync(libraryFile())) {
      const d = JSON.parse(fs.readFileSync(libraryFile(), 'utf8'));
      state.library = Array.isArray(d.items) ? d.items : [];
    }
  } catch (e) { /* 忽略 */ }
}
function saveLibrary() {
  try { fs.writeFileSync(libraryFile(), JSON.stringify({ items: state.library }, null, 2), 'utf8'); }
  catch (e) { console.error('[library] 保存失败', e.message); }
}

/* ------------------------------------------------------------ 老配置迁移 */
function migrateOldProfile() {
  try {
    const oldDir = path.join(app.getPath('appData'), 'chachong');
    const newDir = app.getPath('userData');
    if (path.resolve(oldDir) === path.resolve(newDir)) return;
    const oldCfg = path.join(oldDir, 'config.json');
    const newCfg = path.join(newDir, 'config.json');
    if (fs.existsSync(oldCfg) && !fs.existsSync(newCfg)) {
      fs.mkdirSync(newDir, { recursive: true });
      fs.copyFileSync(oldCfg, newCfg);
      for (const f of ['history.json', 'library.json']) {
        const a = path.join(oldDir, f), b = path.join(newDir, f);
        if (fs.existsSync(a) && !fs.existsSync(b)) fs.copyFileSync(a, b);
      }
      console.log('[迁移] 旧配置已搬到', newDir);
    }
  } catch (e) { console.error('[迁移] 失败', e.message); }
}

/* ------------------------------------------------------------ 历史 */
function historyFile() { return path.join(store.dir(), 'history.json'); }
function loadHistory() {
  try {
    if (fs.existsSync(historyFile())) {
      const d = JSON.parse(fs.readFileSync(historyFile(), 'utf8'));
      state.history = (d.points || []).slice(-400);
      state.spendBase = d.spendBase || null;
    }
  } catch (e) { /* 忽略 */ }
}
function saveHistory() {
  try {
    fs.writeFileSync(historyFile(), JSON.stringify({ points: state.history.slice(-400), spendBase: state.spendBase }), 'utf8');
  } catch (e) { /* 忽略 */ }
}

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ------------------------------------------------------------ 窗口 */
function workArea() {
  return screen.getPrimaryDisplay().workArea;
}

function wireLogs(w, tag) {
  w.webContents.on('console-message', (_e, level, message) => {
    if (IS_DEV || level >= 2) console.log(`[${tag}]`, message);
  });
  w.webContents.on('did-fail-load', (_e, code, desc) => console.error(`[${tag}] 加载失败`, code, desc));
  w.webContents.on('render-process-gone', (_e, d) => console.error(`[${tag}] 渲染进程退出`, d.reason));
}

function createStage() {
  const wa = workArea();
  stage = new BrowserWindow({
    x: wa.x, y: wa.y + wa.height - STAGE_H,
    width: wa.width, height: STAGE_H,
    transparent: true, frame: false, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    focusable: false, fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
    }
  });
  stage.setAlwaysOnTop(true, 'screen-saver');
  stage.setIgnoreMouseEvents(true, { forward: true });
  stage.loadFile(path.join(__dirname, 'renderer', 'stage.html'));
  wireLogs(stage, 'stage');
  stage.on('closed', () => { stage = null; });
  if (process.argv.includes('--devtools')) stage.webContents.openDevTools({ mode: 'detach' });
}

function createPanel(petScreenX) {
  if (panel && !panel.isDestroyed()) {
    positionPanel(petScreenX);
    panel.show();
    panel.focus();
    return;
  }
  const W = 408, H = 620;
  panel = new BrowserWindow({
    width: W, height: H, show: false,
    transparent: true, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  panel.setAlwaysOnTop(true, 'pop-up-menu');
  panel.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  wireLogs(panel, 'panel');
  panel.once('ready-to-show', () => { positionPanel(petScreenX); panel.show(); });
  panel.on('blur', () => { if (panel && !panel.isDestroyed()) panel.hide(); });
  panel.on('closed', () => { panel = null; });
}

function positionPanel(petScreenX) {
  if (!panel || panel.isDestroyed()) return;
  const wa = workArea();
  const [w, h] = panel.getSize();
  let x = Math.round((petScreenX != null ? petScreenX : wa.x + wa.width / 2) - w / 2);
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  const y = Math.max(wa.y + 8, wa.y + wa.height - h - 96);
  panel.setPosition(x, y, false);
}

/* ------------------------------------------------------------ 广播 */
function snapshot() {
  return {
    cfg: store.publicView(),
    weather: state.weather, balance: state.balance, news: state.news,
    github: state.github, arxiv: state.arxiv, system: state.system,
    papers: state.papers,
    library: state.library.slice(),
    meta: state.meta,
    spend: todaySpend(),
    history: state.history.slice(-40),
    reminders: state.reminders.slice(-5),
    now: Date.now()
  };
}
function broadcast(channel, payload) {
  for (const w of [stage, panel]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
  }
}

/* ------------------------------------------------------------ 消耗统计 */
function todaySpend() {
  if (!state.balance || !state.balance.length) return { date: todayKey(), items: {}, total: 0 };
  const date = todayKey();
  if (!state.spendBase || state.spendBase.date !== date) {
    const v = {};
    state.balance.forEach((b) => { if (b.ok) v[b.id] = b.total; });
    state.spendBase = { date, v };
    saveHistory();
    return { date, items: {}, total: 0, fresh: true };
  }
  const items = {};
  let total = 0;
  state.balance.forEach((b) => {
    if (!b.ok) return;
    const base = state.spendBase.v[b.id];
    if (base == null) { state.spendBase.v[b.id] = b.total; return; }
    const used = Math.max(0, base - b.total);
    items[b.id] = +used.toFixed(2);
    if (b.currency === 'CNY') total += used;
  });
  return { date, items, total: +total.toFixed(2) };
}

function isOffpeak() {
  const o = store.get().offpeak;
  if (!o || !o.enabled) return false;
  const [sh, sm] = o.start.split(':').map(Number);
  const [eh, em] = o.end.split(':').map(Number);
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const s = sh * 60 + sm, e = eh * 60 + em;
  return s <= e ? (m >= s && m < e) : (m >= s || m < e);
}

/* ------------------------------------------------------------ 提醒 */
function remind(key, text, opts = {}) {
  const now = Date.now();
  const per = opts.per || 'day';
  const last = state.lastRemind[key] || 0;
  if (per === 'day') {
    const d1 = new Date(last), d2 = new Date(now);
    if (d1.toDateString() === d2.toDateString()) return false;
  } else if (per === 'hour' && now - last < 3600e3) return false;
  else if (per === 'min' && now - last < (opts.minutes || 30) * 60e3) return false;

  state.lastRemind[key] = now;
  const item = { id: key, text, at: now, kind: opts.kind || 'normal' };
  state.reminders.push(item);
  if (state.reminders.length > 20) state.reminders.shift();
  broadcast('pet:say', item);
  return true;
}

/* ------------------------------------------------------------ 刷新 */
async function refresh(card) {
  const cfg = store.get();
  const secrets = {
    deepseek: store.getSecret('deepseek'),
    moonshot: store.getSecret('moonshot'),
    siliconflow: store.getSecret('siliconflow'),
    openrouter: store.getSecret('openrouter'),
    github_token: store.getSecret('github_token')
  };

  const run = async (name, fn) => {
    try {
      state[name] = await fn();
      state.meta[name] = { at: Date.now(), err: null };
    } catch (e) {
      state.meta[name] = { at: (state.meta[name] && state.meta[name].at) || Date.now(), err: e.message || String(e), stale: !!state[name] };
      console.error(`[${name}]`, e.message);
    }
    // 每张卡各自到货就推一次，别让慢的拖住快的
    broadcast('data:update', snapshot());
  };

  const jobs = [];
  if (!card || card === 'weather') jobs.push(run('weather', () => P.weather(cfg)));
  if (!card || card === 'balance') jobs.push(run('balance', () => P.balance(cfg, secrets)));
  if (!card || card === 'system') jobs.push(run('system', () => P.system()));
  if (!card || card === 'news') jobs.push(run('news', () => P.news(cfg, secrets)));
  if (card === 'github' || (!card && cfg.cards.github)) jobs.push(run('github', () => P.github(cfg, secrets)));
  if (card === 'papers' || (!card && cfg.papers && cfg.papers.enabled)) jobs.push(run('papers', () => P.papers(cfg, secrets)));
  await Promise.all(jobs);

  if (!card || card === 'balance') afterBalance();
  if (!card || card === 'weather') afterWeather();
  broadcast('data:update', snapshot());
  rebuildTray();
}

function afterBalance() {
  if (!state.balance) return;
  const cfg = store.get();
  const total = state.balance.filter((b) => b.ok && b.currency === 'CNY').reduce((s, b) => s + b.total, 0);
  if (state.balance.some((b) => b.ok)) {
    const v = {};
    state.balance.forEach((b) => { if (b.ok) v[b.id] = b.total; });
    state.history.push({ t: Date.now(), v });
    if (state.history.length > 400) state.history.shift();
    saveHistory();
  }
  if (total > 0 && total < cfg.thresholds.balanceLow) {
    remind('balance_low', `只剩 ¥${total.toFixed(2)} 了。按今天的速度，撑不了几天——要不要先充点？`, { kind: 'warn' });
  }
}

function afterWeather() {
  const w = state.weather;
  if (!w) return;
  if (w.rain && w.rain.inMinutes <= 120) {
    const t = w.rain.inMinutes <= 5 ? '马上' : `${w.rain.inMinutes} 分钟后`;
    remind('rain', `${t}要下雨（${w.rain.text}，概率 ${w.rain.prob}%）。伞。`, { kind: 'warn', per: 'hour', minutes: 90 });
  }
  if (w.temp >= 35) remind('hot', `${w.temp}°C，别出门了，真的。`, { kind: 'warn' });
  if (w.temp <= 0) remind('cold', `${w.temp}°C，穿厚点。`, { kind: 'warn' });
}

/* ------------------------------------------------------------ 定时器 */
let timers = [];
function startSchedulers() {
  timers.forEach(clearInterval); timers = [];
  timers.push(setInterval(() => refresh('system'), 4000));
  timers.push(setInterval(() => refresh('weather'), 15 * 60e3));
  timers.push(setInterval(() => refresh('balance'), 5 * 60e3));
  timers.push(setInterval(() => refresh('news'), 45 * 60e3));
  timers.push(setInterval(() => { const c = store.get(); if (c.cards.github) refresh('github'); }, 30 * 60e3));
  timers.push(setInterval(() => { const c = store.get(); if (c.papers && c.papers.enabled) refresh('papers'); }, 3 * 3600e3));
  timers.push(setInterval(reminderTick, 60e3));
  timers.push(setInterval(newsAtEight, 60e3));
  timers.push(setInterval(papersPush, 60e3));
}

let paperDay = '';
function papersPush() {
  const cfg = store.get();
  if (!cfg.papers || !cfg.papers.enabled) return;
  const at = (cfg.papers.pushAt || '09:00').split(':').map(Number);
  const d = new Date();
  const k = todayKey();
  if (d.getHours() !== at[0] || paperDay === k) return;
  if (d.getMinutes() < (at[1] || 0)) return;
  paperDay = k;
  refresh('papers').then(() => {
    const p = state.papers;
    if (!p || !p.items || !p.items.length) return;
    const first = p.items[0];
    remind('papers', `今天 ${p.items.length} 篇值得看。第一篇：${first.title.slice(0, 46)}…`, { kind: 'info' });
  });
}

let newsDay = '';
function newsAtEight() {
  const d = new Date();
  const k = todayKey();
  if (d.getHours() === 8 && newsDay !== k) {
    newsDay = k;
    refresh('news').then(() => {
      const n = state.news;
      if (!n) return;
      const first = (n.summary || '').split('\n').filter(Boolean)[0] || (n.items && n.items[0] && n.items[0].title) || '';
      if (first) remind('morning', '早报：' + first, { kind: 'info' });
    });
  }
}

let activeMinutes = 0;
function reminderTick() {
  const cfg = store.get();
  // 久坐：只看"人真的在电脑前"的时间
  let idle = 0;
  try { idle = require('electron').powerMonitor.getSystemIdleTime(); } catch (e) { idle = 0; }
  if (idle < 60) {
    activeMinutes += 1;
    if (activeMinutes >= cfg.thresholds.sitMinutes) {
      activeMinutes = 0;
      remind('sit', `你已经连续坐了 ${cfg.thresholds.sitMinutes} 分钟。站起来走两步，我数着。`, { per: 'min', minutes: cfg.thresholds.sitMinutes });
    }
  } else if (idle > 300) {
    activeMinutes = 0;
  }

  // 熬夜
  const d = new Date();
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= cfg.thresholds.nightHour || h < 4) {
    remind('night', '我先困了。你也别撑了，明天再写。', { kind: 'info' });
  }
}

/* ------------------------------------------------------------ 托盘 */
function trayIcon() {
  const p = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(p)) return nativeImage.createFromPath(p).resize({ width: 16, height: 16 });
  return nativeImage.createEmpty();
}

function rebuildTray() {
  if (!tray) {
    tray = new Tray(trayIcon());
    tray.setToolTip('桌宠');
  }
  const cfg = store.publicView();
  const total = state.balance ? state.balance.filter((b) => b.ok && b.currency === 'CNY').reduce((s, b) => s + b.total, 0) : null;
  const menu = Menu.buildFromTemplate([
    { label: total != null ? `余额 ¥${total.toFixed(2)}` : '余额 未配置', enabled: false },
    { type: 'separator' },
    { label: hiddenByBoss ? '叫它出来  Ctrl+Shift+H' : '藏起来  Ctrl+Shift+H', click: toggleBoss },
    { label: '卡片坞', click: () => { const wa = workArea(); createPanel(wa.x + wa.width / 2); } },
    { label: '刷新全部', click: () => refresh() },
    { label: '框选截图 + 识别  Ctrl+Shift+A', click: () => captureRegion() },
    { label: '截图到剪贴板  Ctrl+Shift+S', click: () => shotToClipboard() },
    { type: 'separator' },
    { label: '安静模式', type: 'checkbox', checked: cfg.pet.quiet, click: (i) => store.patch({ pet: { quiet: i.checked } }) },
    { label: '减少动态', type: 'checkbox', checked: cfg.pet.reduceMotion, click: (i) => store.patch({ pet: { reduceMotion: i.checked } }) },
    { type: 'separator' },
    { label: '打开配置文件夹', click: () => shell.openPath(store.dir()) },
    { label: '打开宠物素材文件夹', click: openPetFolder },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
}

function openPetFolder() {
  const d = path.join(store.dir(), 'pet');
  fs.mkdirSync(d, { recursive: true });
  shell.openPath(d);
}

function toggleBoss() {
  hiddenByBoss = !hiddenByBoss;
  for (const w of [stage, panel]) {
    if (!w || w.isDestroyed()) continue;
    hiddenByBoss ? w.hide() : w.showInactive();
  }
  if (!hiddenByBoss) rearmStage();
  rebuildTray();
}

/* ------------------------------------------------------------ IPC */
ipcMain.handle('config:get', () => store.publicView());
ipcMain.handle('config:patch', async (_e, p) => {
  const before = store.get();
  const out = store.patch(p);
  startSchedulers();
  if (p.city) refresh('weather');
  if (p.rss || p.github) refresh('news');
  if (p.papers) refresh('papers');
  rebuildTray();
  broadcast('data:update', snapshot());
  return out;
});
ipcMain.handle('secret:set', (_e, { name, value }) => {
  const ok = store.setSecret(name, value);
  if (name === 'deepseek') refresh('balance');
  if (name === 'github_token') refresh('github');
  return { ok, cfg: store.publicView() };
});
ipcMain.handle('data:get', () => snapshot());
ipcMain.handle('data:refresh', async (_e, card) => { await refresh(card); return snapshot(); });
ipcMain.handle('city:search', (_e, q) => P.geocode(q));
ipcMain.handle('panel:show', (_e, x) => { createPanel(x); return true; });
ipcMain.handle('panel:hide', () => { if (panel && !panel.isDestroyed()) panel.hide(); return true; });
ipcMain.handle('stage:ignore', (_e, ignore) => {
  if (stage && !stage.isDestroyed()) stage.setIgnoreMouseEvents(!!ignore, { forward: true });
  return true;
});
ipcMain.handle('pet:say', (_e, text) => { remind('manual_' + Date.now(), text, { per: 'min', minutes: 0 }); return true; });
ipcMain.handle('app:quit', () => app.quit());
ipcMain.handle('app:openConfigDir', () => shell.openPath(store.dir()));
ipcMain.handle('app:openPetDir', () => { openPetFolder(); return true; });

/* ------------------------------------------------------------ 桌宠素材 */
const PET_EXT = /\.(png|jpe?g|webp|gif)$/i;

function petDirs() {
  return [
    path.join(store.dir(), 'pet'),                 // 用户自己的
    path.join(__dirname, 'assets', 'pet')          // 内置
  ];
}

const thumbCache = new Map();

/** 素材动辄 1700px，直接塞进面板会把内存吃光，这里出小图 */
function thumbOf(p) {
  let key = p;
  try { key = p + ':' + fs.statSync(p).mtimeMs; } catch (e) { }
  if (thumbCache.has(key)) return thumbCache.get(key);
  let url = '';
  try {
    const im = nativeImage.createFromPath(p);
    if (!im.isEmpty()) url = im.resize({ height: 140 }).toDataURL();
  } catch (e) { /* 读不了就留空 */ }
  if (thumbCache.size > 80) thumbCache.clear();
  thumbCache.set(key, url);
  return url;
}

function listPets() {
  const items = [];
  const seen = new Set();
  for (const dir of petDirs()) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { continue; }
    for (const f of files.sort()) {
      if (!PET_EXT.test(f)) continue;
      const full = path.join(dir, f);
      if (seen.has(full)) continue;
      seen.add(full);
      items.push({ name: path.basename(f, path.extname(f)), path: full, thumb: thumbOf(full) });
    }
  }
  const cfg = store.get();
  const cur = (cfg.pet && cfg.pet.image) || '';
  const fallback = path.join(__dirname, 'assets', 'pet', 'cat.png');
  return { items, active: cur || fallback };
}

ipcMain.handle('pet:list', () => listPets());

ipcMain.handle('pet:select', (_e, p) => {
  const image = p && fs.existsSync(p) ? p : '';
  store.patch({ pet: { image } });
  broadcast('pet:reload', { image });
  broadcast('data:update', snapshot());
  return image;
});

ipcMain.handle('pet:pickImage', async () => {
  const r = await dialog.showOpenDialog({
    title: '选一张桌宠图片（PNG 透明底最好）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
  });
  if (r.canceled || !r.filePaths.length) return null;

  const dir = path.join(store.dir(), 'pet');
  fs.mkdirSync(dir, { recursive: true });

  let first = null;
  for (const src of r.filePaths) {
    const ext = path.extname(src).toLowerCase();
    const base = (path.basename(src, ext) || 'pet').replace(/[\\/:*?"<>|]/g, '_').slice(0, 40);
    let dst = path.join(dir, base + ext);
    let i = 2;
    while (fs.existsSync(dst)) { dst = path.join(dir, `${base}-${i}${ext}`); i++; }
    try {
      fs.copyFileSync(src, dst);
      if (!first) first = dst;
    } catch (e) {
      console.error('[pet] 复制失败', e.message);
    }
  }
  if (first) {
    store.patch({ pet: { image: first } });
    broadcast('pet:reload', { image: first });
    broadcast('data:update', snapshot());
  }
  return first;
});

ipcMain.handle('pet:clearImage', () => {
  store.patch({ pet: { image: '' } });
  broadcast('pet:reload', { image: '' });
  broadcast('data:update', snapshot());
  return true;
});

ipcMain.handle('sheet:open', (_e, url) => { if (url) shell.openExternal(url); return true; });

/* ------------------------------------------------------------ 文献库 */
ipcMain.handle('lib:add', (_e, item) => {
  if (!item || !item.id) return { ok: false };
  if (!state.library.some((x) => x.id === item.id)) {
    state.library.push({
      id: item.id, title: item.title, authors: item.authors || [],
      published: item.published, abs: item.abs, pdf: item.pdf,
      topic: item.topic, addedAt: Date.now()
    });
    saveLibrary();
    broadcast('data:update', snapshot());
  }
  return { ok: true, count: state.library.length };
});

ipcMain.handle('lib:remove', (_e, id) => {
  state.library = state.library.filter((x) => x.id !== id);
  saveLibrary();
  broadcast('data:update', snapshot());
  return { ok: true, count: state.library.length };
});

ipcMain.handle('lib:copy', (_e, id) => {
  const list = id ? state.library.filter((x) => x.id === id) : state.library;
  if (!list.length) return { ok: false, count: 0 };
  const text = list.map((x) => P.bibtex(x)).join('\n\n');
  clipboard.writeText(text);
  return { ok: true, count: list.length };
});

ipcMain.handle('lib:export', async () => {
  if (!state.library.length) return { ok: false, count: 0 };
  const r = await dialog.showSaveDialog({
    title: '导出 BibTeX',
    defaultPath: path.join(app.getPath('documents'), 'references.bib'),
    filters: [{ name: 'BibTeX', extensions: ['bib'] }]
  });
  if (r.canceled || !r.filePath) return { ok: false, count: 0 };
  fs.writeFileSync(r.filePath, state.library.map((x) => P.bibtex(x)).join('\n\n'), 'utf8');
  return { ok: true, count: state.library.length, file: r.filePath };
});

/* ------------------------------------------------------------ 框选截图 + OCR */
const { execFile } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let selectorWin = null;
let selectorResolve = null;

function openSelector(imgPath) {
  return new Promise((resolve) => {
    const wa = screen.getPrimaryDisplay().workArea;
    selectorResolve = resolve;
    selectorWin = new BrowserWindow({
      x: wa.x, y: wa.y, width: wa.width, height: wa.height, show: false,
      transparent: true, frame: false, resizable: false, movable: false,
      alwaysOnTop: true, skipTaskbar: true, hasShadow: false, fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false
      }
    });
    selectorWin.setAlwaysOnTop(true, 'screen-saver');
    selectorWin.loadFile(path.join(__dirname, 'renderer', 'selector.html'));
    selectorWin.webContents.once('did-finish-load', () => {
      if (selectorWin && !selectorWin.isDestroyed()) {
        selectorWin.webContents.send('shot:image', 'file:///' + imgPath.replace(/\\/g, '/'));
        selectorWin.focus();
      }
    });
    // 图没加载出来也别把用户卡在黑屏里
    setTimeout(() => {
      if (selectorWin && !selectorWin.isDestroyed() && !selectorWin.isVisible()) {
        selectorWin.show();
        selectorWin.focus();
      }
    }, 2500);
    selectorWin.on('closed', () => {
      selectorWin = null;
      if (selectorResolve) { const r = selectorResolve; selectorResolve = null; r(null); }
    });
  });
}

function closeSelector() {
  if (selectorWin && !selectorWin.isDestroyed()) selectorWin.close();
}

/**
 * 截完图回到舞台时，把输入状态重新上一次：
 * 选择窗口会抢焦点，舞台是 focusable:false 的，回来以后可能收不到 mouseup，
 * 表现就是宠物黏在鼠标上、左键点不动（右键 contextmenu 还能用）。
 */
function rearmStage() {
  if (!stage || stage.isDestroyed()) return;
  let cx = -1, cy = -1;
  try {
    const b = stage.getBounds();
    const p = screen.getCursorScreenPoint();
    cx = p.x - b.x; cy = p.y - b.y;
  } catch (e) { /* 拿不到光标就按未命中处理 */ }
  stage.setIgnoreMouseEvents(true, { forward: true });
  if (!stage.isVisible()) stage.showInactive();
  // 光标本来就停在宠物身上的话，直接把穿透关掉，免得"回来第一下点不动"
  stage.webContents.send('stage:reset', { cx, cy });
}

ipcMain.handle('shot:confirm', (_e, rect) => {
  const r = selectorResolve; selectorResolve = null;
  closeSelector();
  if (r) r(rect);
  return true;
});
ipcMain.handle('shot:cancel', () => {
  const r = selectorResolve; selectorResolve = null;
  closeSelector();
  if (r) r(null);
  return true;
});
ipcMain.handle('shot:ready', () => {
  if (selectorWin && !selectorWin.isDestroyed()) {
    selectorWin.show();
    selectorWin.focus();
  }
  return true;
});

function tidyOcr(text) {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/([\u4e00-\u9fa5]) (?=[\u4e00-\u9fa5])/g, '$1')
    .replace(/([\u4e00-\u9fa5]) (?=[，。、；：！？）》」』])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function runOcr(pngPath) {
  return new Promise((resolve) => {
    const ps = path.join(__dirname, 'tools', 'ocr.ps1');
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps, '-Path', pngPath],
      { windowsHide: true, timeout: 40000, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return resolve({ ok: false, text: '', error: err.message });
        resolve({ ok: true, text: (stdout || '').trim() });
      });
  });
}

async function explainOcr(text) {
  const key = store.getSecret('deepseek');
  if (!key) return null;
  try {
    const r = await P.getJSON('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你在帮一个研究压电材料与压电器件的学生读论文。用户截了屏幕一块区域，下面是 OCR 出来的文字。请：1) 修正 OCR 错误，输出通顺的原文；2) 再给一句中文解释，说清这段在讲什么（不超过 45 字）。格式严格为：原文，然后空一行，然后「解释：…」。不要客套话。'
          },
          { role: 'user', content: text }
        ],
        temperature: 0.2, max_tokens: 800
      })
    }, 30000);
    return ((r.choices && r.choices[0] && r.choices[0].message.content) || '').trim();
  } catch (e) {
    console.error('[ocr] AI 整理失败:', e.message);
    return null;
  }
}

async function captureRegion() {
  try {
    if (stage && !stage.isDestroyed()) stage.hide();
    if (panel && !panel.isDestroyed()) panel.hide();
    await sleep(260);

    const d = screen.getPrimaryDisplay();
    const wa = d.workArea;
    const srcs = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(d.bounds.width * (d.scaleFactor || 1)),
        height: Math.round(d.bounds.height * (d.scaleFactor || 1))
      }
    });
    if (!srcs.length) throw new Error('拿不到屏幕');
    const full = srcs.find((s) => String(s.display_id) === String(d.id)) || srcs[0];
    const img = full.thumbnail;
    const isz = img.getSize();

    // 抓回来的是整块显示器，先裁到工作区，保证和选择窗口 1:1
    const kx = isz.width / d.bounds.width;
    const ky = isz.height / d.bounds.height;
    const waImg = img.crop({
      x: Math.round((wa.x - d.bounds.x) * kx),
      y: Math.round((wa.y - d.bounds.y) * ky),
      width: Math.min(isz.width, Math.round(wa.width * kx)),
      height: Math.min(isz.height, Math.round(wa.height * ky))
    });

    // 截图过大不适合走 IPC，落成临时文件让选择窗口直接引用
    const tmp = path.join(app.getPath('temp'), 'zc-screen.jpg');
    fs.writeFileSync(tmp, waImg.toJPEG(88));

    if (stage && !stage.isDestroyed()) stage.showInactive();
    const rect = await openSelector(tmp);
    rearmStage();
    if (!rect) { try { fs.unlinkSync(tmp); } catch (e) { } return false; }

    const wsz = waImg.getSize();
    const sx = wsz.width / wa.width;
    const sy = wsz.height / wa.height;
    const cropped = waImg.crop({
      x: Math.round(rect.x * sx),
      y: Math.round(rect.y * sy),
      width: Math.max(1, Math.round(rect.width * sx)),
      height: Math.max(1, Math.round(rect.height * sy))
    });

    // 先把图放剪贴板：后面 OCR 挂了你也不亏
    clipboard.writeImage(cropped);

    const dir = path.join(app.getPath('pictures'), '桌宠截图');
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const file = path.join(dir, `shot-${ts}.png`);
    fs.writeFileSync(file, cropped.toPNG());
    try { fs.unlinkSync(tmp); } catch (e) { }

    const ocr = await runOcr(file);
    const text = tidyOcr(ocr.text);

    if (text.length >= 6) {
      const ai = await explainOcr(text);
      const final = ai || text;
      clipboard.writeText(final);
      const head = final.replace(/\n+/g, ' ').slice(0, 46);
      remind('shot_text', (ai ? '已整理并复制：' : `识别到 ${text.length} 字，已复制：`) + head,
        { per: 'min', minutes: 0, kind: 'info' });
    } else {
      remind('shot_img', '图已复制到剪贴板（这块没识别到文字）', { per: 'min', minutes: 0 });
    }
    return true;
  } catch (e) {
    if (stage && !stage.isDestroyed()) stage.showInactive();
    remind('shot_err', '框选截图失败：' + e.message, { per: 'min', minutes: 0, kind: 'warn' });
    return false;
  }
}
ipcMain.handle('shot:region', () => captureRegion());

/* ------------------------------------------------------------ 截图到剪贴板 */
async function shotToClipboard() {
  try {
    if (stage && !stage.isDestroyed()) stage.hide();
    if (panel && !panel.isDestroyed()) panel.hide();
    await new Promise((r) => setTimeout(r, 220));
    const d = screen.getPrimaryDisplay();
    const sf = d.scaleFactor || 1;
    const srcs = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(d.size.width * sf), height: Math.round(d.size.height * sf) }
    });
    if (!srcs.length) throw new Error('拿不到屏幕');
    clipboard.writeImage(srcs[0].thumbnail);
    if (stage && !stage.isDestroyed()) stage.showInactive();
    remind('shot', '截好了，已经在剪贴板里。', { per: 'min', minutes: 0 });
    return true;
  } catch (e) {
    if (stage && !stage.isDestroyed()) stage.showInactive();
    remind('shot_err', '截图失败：' + e.message, { per: 'min', minutes: 0, kind: 'warn' });
    return false;
  }
}
ipcMain.handle('shot:screen', () => shotToClipboard());

/* ------------------------------------------------------------ 截图自检（--shot） */
async function runShots() {
  try {
    const wa = workArea();
    createPanel(wa.x + wa.width * 0.74);
    await new Promise((r) => setTimeout(r, 2500));
    const dir = path.join(__dirname, '.workbuddy');
    fs.mkdirSync(dir, { recursive: true });
    for (const [w, name] of [[stage, 'shot-stage'], [panel, 'shot-panel']]) {
      if (!w || w.isDestroyed()) continue;
      await w.webContents.insertCSS('html,body{background:#efe9de !important}');
      await new Promise((r) => setTimeout(r, 350));
      const img = await w.webContents.capturePage();
      fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
      console.log('已保存', name, w.getSize());
    }
  } catch (e) {
    console.error('截图失败', e);
  }
  setTimeout(() => app.quit(), 400);
}

/* ------------------------------------------------------------ 兼容模式自愈 */
const hasFlag = (f) => process.argv.includes(f);
const inCompat = () => hasFlag('--soft') || hasFlag('--no-sandbox');

function relaunchCompat(why) {
  if (inCompat() || SHOT) return;
  console.warn('[启动] ' + why + '，用兼容模式重开');
  app.relaunch({ args: process.argv.slice(1).concat(['--soft', '--no-sandbox']) });
  app.exit(0);
}

let gpuCrashes = 0;
app.on('child-process-gone', (_e, d) => {
  if (!d || d.type !== 'GPU') return;
  if (d.reason === 'clean-exit') return;
  gpuCrashes++;
  if (gpuCrashes >= 2) relaunchCompat('GPU 进程连续崩了 ' + gpuCrashes + ' 次');
});

/* ------------------------------------------------------------ 生命周期 */
const NEEDS_LOCK = !(SHOT || process.argv.includes('--probe'));
if (NEEDS_LOCK && !app.requestSingleInstanceLock()) {
  console.log('已有一个桌宠在跑，这个实例退出');
  app.quit();
} else {
  app.on('second-instance', () => { if (stage) stage.showInactive(); });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.zhuochong.pet');
    migrateOldProfile();
    // 首次启动就把默认配置落盘，方便用户找到并手改
    if (!fs.existsSync(store.file())) store.patch({});
    loadHistory();
    loadLibrary();
    createStage();
    rebuildTray();

    // 受限环境（受限令牌 / 远程桌面 / 显卡驱动异常）里渲染进程起不来：
    // 窗口在、页面永远 loading。10 秒还没加载完就自动切兼容模式重开。
    {
      let loaded = false;
      stage.webContents.once('did-finish-load', () => { loaded = true; });
      setTimeout(() => {
        if (loaded) return;
        relaunchCompat('页面 10 秒没加载出来');
      }, 10000);
    }

    const okHot = globalShortcut.register('Control+Shift+H', toggleBoss);
    if (!okHot) console.warn('[hotkey] Ctrl+Shift+H 被占用，老板键不可用');
    const okShot = globalShortcut.register('Control+Shift+S', shotToClipboard);
    if (!okShot) console.warn('[hotkey] Ctrl+Shift+S 被占用，截图不可用');
    const okRegion = globalShortcut.register('Control+Shift+A', captureRegion);
    if (!okRegion) console.warn('[hotkey] Ctrl+Shift+A 被占用，框选截图不可用');

    startSchedulers();
    await refresh();
    setTimeout(() => refresh('news'), 3000);

    if (SHOT) runShots();

    app.on('activate', () => { if (!stage) createStage(); });
  });

  app.on('window-all-closed', (e) => { /* 常驻，不退出 */ });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); timers.forEach(clearInterval); });
}
