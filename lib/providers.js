'use strict';
/**
 * 数据源适配器
 * 每个 provider 都返回 { ok, data, error, updatedAt }，失败时绝不清空上一次的结果。
 */
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const UA = { 'user-agent': 'Chachong/0.1 (desktop pet)' };

async function getJSON(url, opts = {}, timeout = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { ...UA, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function getText(url, opts = {}, timeout = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal, headers: { ...UA, ...(opts.headers || {}) } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

/* ============================ 天气 ============================ */
const WMO = {
  0: ['晴', '☀️'], 1: ['晴间多云', '🌤️'], 2: ['多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
  51: ['小毛雨', '🌦️'], 53: ['毛雨', '🌦️'], 55: ['大毛雨', '🌧️'],
  56: ['冻毛雨', '🌧️'], 57: ['冻毛雨', '🌧️'],
  61: ['小雨', '🌦️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '🌨️'],
  80: ['阵雨', '🌦️'], 81: ['强阵雨', '🌧️'], 82: ['暴雨', '⛈️'],
  85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
  95: ['雷阵雨', '⛈️'], 96: ['雷暴冰雹', '⛈️'], 99: ['强雷暴冰雹', '⛈️']
};
const wx = (code) => WMO[code] || ['未知', '🌡️'];

async function geocode(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
  const d = await getJSON(url);
  if (!d.results || !d.results.length) throw new Error('找不到这个城市');
  const r = d.results[0];
  return { name: r.name, lat: r.latitude, lon: r.longitude, admin: r.admin1 || '', country: r.country || '' };
}

async function weather(cfg) {
  const { lat, lon, name } = cfg.city;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,apparent_temperature,weather_code,relative_humidity_2m,wind_speed_10m,is_day'
    + '&hourly=temperature_2m,precipitation,precipitation_probability,weather_code'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset'
    + '&timezone=auto&forecast_days=2';
  const d = await getJSON(url);
  const cur = d.current;
  const [text, icon] = wx(cur.weather_code);

  const times = (d.hourly && d.hourly.time) || [];
  const now = Date.now();
  let rain = null;
  let firstFuture = 0;
  for (let i = 0; i < times.length; i++) {
    if (new Date(times[i]).getTime() >= now - 1800e3) { firstFuture = i; break; }
  }
  for (let i = firstFuture; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (t > now + 2 * 3600e3) break;
    const prob = (d.hourly.precipitation_probability || [])[i] || 0;
    const mm = (d.hourly.precipitation || [])[i] || 0;
    if (prob >= cfg.thresholds.rainProb || mm >= 0.2) {
      const inMin = Math.max(0, Math.round((t - now) / 60e3));
      const [rt] = wx((d.hourly.weather_code || [])[i]);
      rain = { inMinutes: inMin, prob, mm, text: rt, at: times[i] };
      break;
    }
  }

  return {
    city: name,
    temp: Math.round(cur.temperature_2m),
    feels: Math.round(cur.apparent_temperature),
    text,
    icon,
    code: cur.weather_code,
    isDay: cur.is_day === 1,
    humidity: cur.relative_humidity_2m,
    wind: Math.round(cur.wind_speed_10m),
    min: Math.round(d.daily.temperature_2m_min[0]),
    max: Math.round(d.daily.temperature_2m_max[0]),
    rainProbMax: d.daily.precipitation_probability_max ? d.daily.precipitation_probability_max[0] : null,
    rain,
    hourly: times.slice(firstFuture, firstFuture + 8).map((t, k) => {
      const i = firstFuture + k;
      return {
        t,
        temp: Math.round(d.hourly.temperature_2m[i]),
        prob: d.hourly.precipitation_probability ? d.hourly.precipitation_probability[i] : 0
      };
    })
  };
}

/* ============================ API 余额 ============================ */
const BALANCE_SRC = {
  deepseek: {
    name: 'DeepSeek', currency: 'CNY',
    req: (key) => ({ url: 'https://api.deepseek.com/user/balance', headers: { authorization: 'Bearer ' + key } }),
    parse: (d) => {
      const list = d.balance_infos || [];
      const cny = list.find((x) => x.currency === 'CNY') || list[0] || {};
      return { total: parseFloat(cny.total_balance || 0), topped: parseFloat(cny.topped_up_balance || 0), granted: parseFloat(cny.granted_balance || 0) };
    }
  },
  moonshot: {
    name: 'Moonshot', currency: 'CNY',
    req: (key) => ({ url: 'https://api.moonshot.cn/v1/users/me/balance', headers: { authorization: 'Bearer ' + key } }),
    parse: (d) => {
      const x = (d.data || d) || {};
      return { total: parseFloat(x.available_balance || 0), topped: parseFloat(x.cash_balance || 0), granted: parseFloat(x.voucher_balance || 0) };
    }
  },
  siliconflow: {
    name: '硅基流动', currency: 'CNY',
    req: (key) => ({ url: 'https://api.siliconflow.cn/v1/user/info', headers: { authorization: 'Bearer ' + key } }),
    parse: (d) => {
      const x = d.data || d;
      return { total: parseFloat(x.totalBalance != null ? x.totalBalance : (x.balance || 0)), topped: 0, granted: 0 };
    }
  },
  openrouter: {
    name: 'OpenRouter', currency: 'USD',
    req: (key) => ({ url: 'https://openrouter.ai/api/v1/credits', headers: { authorization: 'Bearer ' + key } }),
    parse: (d) => {
      const x = d.data || d;
      return { total: parseFloat(x.total_credits || 0) - parseFloat(x.total_usage || 0), topped: 0, granted: 0 };
    }
  }
};

async function balance(cfg, secrets) {
  const out = [];
  for (const id of Object.keys(BALANCE_SRC)) {
    const key = secrets[id];
    if (!key) continue;
    const src = BALANCE_SRC[id];
    try {
      const { url, headers } = src.req(key);
      const d = await getJSON(url, { headers });
      const p = src.parse(d);
      out.push({ id, name: src.name, currency: src.currency, ok: true, ...p });
    } catch (e) {
      out.push({ id, name: src.name, currency: src.currency, ok: false, error: e.message });
    }
  }
  return out;
}

/* ============================ 早报 ============================ */
function stripTags(s) {
  return (s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function parseFeed(xml, source, limit) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of blocks.slice(0, limit)) {
    const title = stripTags((b.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    let link = (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || (b.match(/<link>([\s\S]*?)<\/link>/i) || [])[1] || '';
    const date = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) || [])[1] || (b.match(/<published>([\s\S]*?)<\/published>/i) || [])[1] || '';
    if (title) items.push({ title: stripTags(title), link: link.trim(), source, date: stripTags(date) });
  }
  return items;
}

async function sixty() {
  const d = await getJSON('https://60s.viki.moe/v2/60s');
  const data = d.data || d;
  const news = data.news || data.list || [];
  return {
    items: news.map((t) => ({ title: stripTags(String(t)), source: '每日 60 秒', link: '' })),
    date: data.date || '',
    lunar: data.lunar_date || ''
  };
}

async function news(cfg, secrets) {
  const feeds = (cfg.rss || []).slice(0, 4);
  // 全部并行：慢的源不拖累快的
  const all = await Promise.allSettled([
    sixty(),
    ...feeds.map((f) => getText(f.url, {}, 13000).then((x) => parseFeed(x, f.name, 4)))
  ]);

  const items = [];
  let meta = {};
  if (all[0] && all[0].status === 'fulfilled') {
    items.push(...all[0].value.items);
    meta = { date: all[0].value.date, lunar: all[0].value.lunar };
  }
  for (let i = 1; i < all.length; i++) {
    if (all[i].status === 'fulfilled') items.push(...all[i].value);
  }

  if (!items.length) throw new Error('所有资讯源都拿不到');

  // 去重
  const seen = new Set();
  const uniq = items.filter((x) => {
    const k = (x.title || '').slice(0, 18);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const summary = await summarize(uniq.slice(0, 14), secrets.deepseek);
  return { items: uniq.slice(0, 18), summary, ...meta };
}

async function summarize(items, key) {
  if (!key || !items.length) return '';
  try {
    const list = items.map((x, i) => `${i + 1}. ${x.title}`).join('\n');
    const d = await getJSON('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: '你是一只嘴贱但靠谱的桌宠。把新闻压成最多 3 条，每条不超过 28 个字，用中文，不要编号前缀的客套话，直接给内容。' },
          { role: 'user', content: '今天的新闻：\n' + list }
        ],
        temperature: 0.4, max_tokens: 200
      })
    }, 20000);
    const t = d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
    return (t || '').trim();
  } catch (e) {
    console.error('[news] 摘要失败:', e.message);
    return '';
  }
}

/* ============================ GitHub ============================ */
async function github(cfg, secrets) {
  const token = secrets.github_token || (cfg.github && cfg.github.token) || '';
  const user = (cfg.github && cfg.github.user) || '';
  const h = token ? { authorization: 'Bearer ' + token } : {};
  if (token) {
    try {
      const n = await getJSON('https://api.github.com/notifications?all=false&per_page=5', { headers: h });
      return {
        mode: 'notifications',
        unread: n.length,
        items: n.map((x) => ({ title: x.subject.title, repo: x.repository.full_name, type: x.subject.type, link: x.subject.url }))
      };
    } catch (e) { /* 落到 events */ }
  }
  if (!user) throw new Error('还没填 GitHub 用户名');
  const ev = await getJSON(`https://api.github.com/users/${encodeURIComponent(user)}/events/public?per_page=6`, { headers: h });
  return {
    mode: 'events',
    unread: 0,
    items: ev.map((e) => ({
      type: e.type,
      repo: e.repo && e.repo.name,
      title: e.type === 'PushEvent' ? `推送 ${(e.payload && e.payload.commits || []).length} 个提交`
        : e.type === 'WatchEvent' ? 'star 了仓库'
          : e.type === 'ReleaseEvent' ? '发布了版本'
            : e.type.replace('Event', ''),
      time: e.created_at
    }))
  };
}

/* ============================ arXiv ============================ */
async function arxiv(cfg, secrets) {
  const cats = (cfg.arxiv && cfg.arxiv.cats) || 'cs.AI+OR+cs.CL';
  const max = (cfg.arxiv && cfg.arxiv.max) || 4;
  const url = `http://export.arxiv.org/api/query?search_query=cat:${cats}&sortBy=submittedDate&sortOrder=descending&max_results=${max}`;
  const xml = await getText(url, {}, 15000);
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  const items = blocks.map((b) => ({
    title: stripTags((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]),
    id: stripTags((b.match(/<id>([\s\S]*?)<\/id>/i) || [])[1]),
    published: stripTags((b.match(/<published>([\s\S]*?)<\/published>/i) || [])[1]),
    summary: stripTags((b.match(/<summary>([\s\S]*?)<\/summary>/i) || [])[1]).slice(0, 500)
  }));
  return { items };
}

/* ============================ 系统 ============================ */
let prevCpu = os.cpus().map((c) => c.times);
let prevNet = null;
let prevNetAt = 0;

function netBytes() {
  return new Promise((resolve) => {
    exec('netstat -e', { windowsHide: true, timeout: 4000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = stdout.match(/^\s*(?:Bytes|字节)\s+(\d+)\s+(\d+)/im);
      resolve(m ? { rx: +m[1], tx: +m[2] } : null);
    });
  });
}

function statfsSafe(p) {
  try {
    if (typeof fs.statfsSync !== 'function') return null;
    const s = fs.statfsSync(p);
    const total = s.blocks * s.bsize;
    const free = s.bfree * s.bsize;
    return { total, used: total - free, pct: Math.round(((total - free) / total) * 100) };
  } catch (e) { return null; }
}

async function system() {
  const cur = os.cpus().map((c) => c.times);
  let idle = 0, total = 0;
  cur.forEach((t, i) => {
    const p = prevCpu[i] || t;
    const dIdle = t.idle - p.idle;
    const dTotal = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.irq - p.irq) + dIdle;
    idle += dIdle; total += dTotal;
  });
  prevCpu = cur;
  const cpu = total > 0 ? Math.round((1 - idle / total) * 100) : 0;

  const totalMem = os.totalmem();
  const usedMem = totalMem - os.freemem();
  const memPct = Math.round((usedMem / totalMem) * 100);

  let down = 0, up = 0;
  const nb = await netBytes();
  const now = Date.now();
  if (nb && prevNet) {
    const dt = (now - prevNetAt) / 1000;
    if (dt > 0.5) {
      down = Math.max(0, (nb.rx - prevNet.rx) / dt);
      up = Math.max(0, (nb.tx - prevNet.tx) / dt);
    }
  }
  if (nb) { prevNet = nb; prevNetAt = now; }

  const disk = statfsSafe(process.env.SystemDrive ? process.env.SystemDrive + '\\' : 'C:\\');
  const g = await gpu();

  return {
    cpu, memPct,
    memUsedGB: +(usedMem / 1073741824).toFixed(1),
    memTotalGB: +(totalMem / 1073741824).toFixed(1),
    down, up,
    disk, gpu: g, uptimeH: Math.round(os.uptime() / 3600)
  };
}

/* ============================ GPU ============================ */
function execAsync(cmd, timeout = 4000) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

let gpuCache = { at: 0, data: null };

async function gpu() {
  const now = Date.now();
  if (gpuCache.data && now - gpuCache.at < 3000) return gpuCache.data;

  let out = null;
  const nv = await execAsync(
    'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits'
  );
  if (nv && nv.trim()) {
    const p = nv.trim().split(/\r?\n/)[0].split(',').map((x) => parseFloat(x.trim()));
    if (p.length >= 2 && !isNaN(p[0])) {
      out = {
        ok: true, vendor: 'nvidia', util: Math.round(p[0]),
        memUsed: isFinite(p[1]) ? Math.round(p[1]) : null,
        memTotal: isFinite(p[2]) ? Math.round(p[2]) : null,
        temp: isFinite(p[3]) ? Math.round(p[3]) : null
      };
    }
  }

  if (!out) {
    const tp = await execAsync('typeperf "\\GPU Engine(*)\\Utilization Percentage" -sc 1 -si 1', 9000);
    if (tp) {
      const lines = tp.split(/\r?\n/).filter((l) => l.trim());
      const header = lines[0] || '';
      const dataLine = lines[lines.length - 1] || '';
      const names = (header.match(/"([^"]*)"/g) || []).map((s) => s.replace(/"/g, ''));
      const vals = (dataLine.match(/"([^"]*)"/g) || []).map((s) => s.replace(/"/g, ''));
      const groups = {};
      for (let i = 0; i < names.length; i++) {
        const m = names[i].match(/engtype_(\w+)/i);
        if (!m) continue;
        const v = parseFloat(vals[i]);
        if (isNaN(v)) continue;
        const k = m[1].toLowerCase();
        groups[k] = (groups[k] || 0) + v;
      }
      const keys = Object.keys(groups);
      if (keys.length) {
        const peak = keys.reduce((a, k) => (groups[k] > groups[a] ? k : a), keys[0]);
        out = {
          ok: true, vendor: 'wddm', engine: peak,
          util: Math.max(0, Math.min(100, Math.round(groups[peak]))),
          memUsed: null, memTotal: null, temp: null
        };
      }
    }
  }

  if (!out) out = { ok: false, error: '这台机器读不到 GPU' };
  gpuCache = { at: now, data: out };
  return out;
}

/* ============================ arXiv 论文 ============================ */
function buildQuery(t) {
  const kws = (t.keywords || []).filter(Boolean);
  const parts = kws.map((k) => `all:"${String(k).replace(/"/g, '')}"`);
  let q = parts.length > 1 ? '(' + parts.join(' OR ') + ')' : (parts[0] || 'all:"machine learning"');
  (t.exclude || []).filter(Boolean).forEach((x) => {
    q += ` ANDNOT all:"${String(x).replace(/"/g, '')}"`;
  });
  if (t.cats && t.cats.length) {
    q += ' AND (' + t.cats.map((c) => `cat:${c}`).join(' OR ') + ')';
  }
  return q;
}

function cleanTex(t) {
  return String(t || '')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/\\[a-zA-Z]+\s*\{[^{}]*\}/g, ' ')
    .replace(/[\\{}$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseArxiv(xml) {
  const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const id = stripTags((b.match(/<id>([\s\S]*?)<\/id>/i) || [])[1]);
    const title = cleanTex(stripTags((b.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).replace(/\s+/g, ' '));
    const abs = stripTags((b.match(/<summary>([\s\S]*?)<\/summary>/i) || [])[1]).replace(/\s+/g, ' ');
    const published = stripTags((b.match(/<published>([\s\S]*?)<\/published>/i) || [])[1]);
    const authors = [...b.matchAll(/<name>([\s\S]*?)<\/name>/gi)].map((m) => stripTags(m[1])).slice(0, 4);
    const cats = [...b.matchAll(/term="([^"]+)"/g)].map((m) => m[1]).filter((c) => c.includes('.'));
    const pdf = (b.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/i) || [])[1] || id.replace('/abs/', '/pdf/');
    return { id, title, abs, published, authors, cats, pdf };
  }).filter((x) => x.title);
}

function scorePaper(it, t) {
  const title = (it.title || '').toLowerCase();
  const absText = (it.abs || '').toLowerCase();
  let s = 0;
  const hits = [];
  for (const kw of t.keywords || []) {
    const k = String(kw).toLowerCase().replace(/"/g, '');
    if (!k) continue;
    if (title.includes(k)) { s += 30; hits.push(kw); }
    else if (absText.includes(k)) { s += 9; hits.push(kw); }
  }
  if (s === 0) return { score: 0, hits: [] };

  const days = (Date.now() - new Date(it.published).getTime()) / 86400000;
  s += Math.max(0, 20 - days * 1.6);
  if (it.cites) s += Math.min(12, Math.round(Math.log10(1 + it.cites) * 8));
  if (/survey|review|overview|tutorial|a guide/i.test(it.title)) s -= 16;
  if (t.cats && t.cats.length && it.cats.some((c) => t.cats.includes(c))) s += 6;
  return { score: Math.round(s), hits: [...new Set(hits)] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function abstractOf(w) {
  const inv = w.abstract_inverted_index;
  if (!inv) return '';
  const pos = [];
  for (const word of Object.keys(inv)) {
    for (const p of inv[word]) pos.push([p, word]);
  }
  pos.sort((a, b) => a[0] - b[0]);
  return pos.map((x) => x[1]).join(' ');
}

async function openalexSearch(t) {
  const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const q = (t.keywords || []).slice(0, 3).map((k) => String(k).replace(/"/g, '')).join(' ');
  const url = 'https://api.openalex.org/works?search=' + encodeURIComponent(q)
    + `&filter=from_publication_date:${since},to_publication_date:${new Date().toISOString().slice(0, 10)}`
    + '&sort=publication_date:desc&per_page=25&mailto=zhuochong@local';
  const d = await getJSON(url, {}, 30000);
  return (d.results || []).map((w) => {
    const loc = w.primary_location || {};
    const doi = (w.doi || '').replace('https://doi.org/', '');
    return {
      id: doi ? 'https://doi.org/' + doi : (loc.landing_page_url || w.id),
      title: (w.title || '').replace(/<[^>]+>/g, ''),
      abs: abstractOf(w),
      published: (w.publication_date || '') + 'T00:00:00Z',
      authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean).slice(0, 4),
      cats: [w.type || 'article'],
      pdf: loc.pdf_url || loc.landing_page_url || '',
      cites: w.cited_by_count || 0,
      venue: (loc.source && loc.source.display_name) || '',
      src: 'OpenAlex'
    };
  }).filter((x) => x.title);
}

async function arxivSearch(t) {
  const q = buildQuery(t);
  const url = 'http://export.arxiv.org/api/query?search_query=' + encodeURIComponent(q)
    + `&sortBy=submittedDate&sortOrder=descending&max_results=${Math.min(100, t.max || 40)}`;
  const xml = await getText(url, {}, 9000);
  return parseArxiv(xml).map((x) => ({ ...x, src: 'arXiv' }));
}

async function papers(cfg, secrets) {
  const pcfg = cfg.papers || {};
  const topics = (pcfg.topics || []).filter((t) => t && t.on !== false);
  // 没配话题不是错误，是还没开始用
  if (!topics.length) return { items: [], poolSize: 0, at: Date.now(), empty: true };

  const pool = [];
  const seenId = new Set();
  const seenTitle = new Set();
  let usedSource = '';

  // 话题并发抓，别一个个排队（OpenAlex 单次就要 9 秒）
  const collected = await Promise.all(topics.map(async (t, i) => {
    if (i > 0) await sleep(1200 * i);
    let items = [];
    let src = '';
    try {
      items = await arxivSearch(t);
      if (items.length) src = 'arXiv';
    } catch (e) {
      console.warn('[papers] arXiv 不通（' + e.message + '），改用 OpenAlex');
    }
    if (!items.length) {
      try {
        items = await openalexSearch(t);
        if (items.length) src = 'OpenAlex';
      } catch (e) {
        console.error('[papers] 话题「' + t.name + '」两个源都失败:', e.message);
      }
    }
    return { t, items, src };
  }));

  for (const { t, items, src } of collected) {
    if (src && !usedSource) usedSource = src;
    for (const it of items) {
      const idKey = (it.id || '').toLowerCase();
      const titleKey = (it.title || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').slice(0, 60);
      if (!idKey || seenId.has(idKey) || seenTitle.has(titleKey)) continue;
      seenId.add(idKey);
      seenTitle.add(titleKey);
      const { score, hits } = scorePaper(it, t);
      if (score <= 0) continue;
      pool.push({ ...it, topic: t.name, topicId: t.id, score, hits });
    }
  }

  pool.sort((a, b) => b.score - a.score);
  const top = pool.slice(0, pcfg.maxPerDay || 8);
  if (pcfg.tldr !== false) await attachTldr(top, secrets.deepseek);
  return { items: top, poolSize: pool.length, at: Date.now(), source: usedSource };
}

async function attachTldr(items, key) {
  if (!key || !items.length) return;
  try {
    const payload = items.map((x, i) => `[${i}] ${x.title}\n${x.abs.slice(0, 420)}`).join('\n\n');
    const d = await getJSON('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你在帮一个研究者筛选每天的新论文。每篇给一句话中文概括，要说清"做了什么、结果如何"，不超过 34 个字。严格按 "序号|概括" 每行一条输出，不要任何别的内容。'
          },
          { role: 'user', content: payload }
        ],
        temperature: 0.3, max_tokens: 500
      })
    }, 25000);
    const text = (d.choices && d.choices[0] && d.choices[0].message.content) || '';
    text.split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*\[?(\d+)\]?\s*[|｜]\s*(.+)$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        if (items[idx]) items[idx].tldr = m[2].trim();
      }
    });
  } catch (e) {
    console.error('[papers] 摘要失败:', e.message);
  }
}

function bibtex(it) {
  const first = (it.authors && it.authors[0]) || 'anonymous';
  const surname = (first.split(' ').pop() || 'anon').replace(/[^a-zA-Z]/g, '') || 'anon';
  const year = (it.published || '').slice(0, 4) || '2026';
  const word = ((it.title || '').toLowerCase().match(/[a-z]{4,}/) || ['paper'])[0];
  const key = `${surname}${year}${word}`;

  const id = it.id || '';
  const arxivId = /arxiv\.org/.test(id) ? id.split('/abs/').pop() : '';
  const doi = /doi\.org\//.test(id) ? id.split('doi.org/')[1] : '';

  const lines = [
    `@article{${key},`,
    `  title   = {${(it.title || '').replace(/[{}]/g, '')}},`,
    `  author  = {${(it.authors || []).join(' and ')}},`
  ];
  if (arxivId) lines.push(`  journal = {arXiv preprint arXiv:${arxivId}},`);
  else if (it.venue) lines.push(`  journal = {${it.venue}},`);
  lines.push(`  year    = {${year}},`);
  if (doi) lines.push(`  doi     = {${doi}},`);
  lines.push(`  url     = {${id}}`);
  lines.push('}');
  return lines.join('\n');
}

module.exports = { weather, balance, news, github, arxiv, system, gpu, papers, bibtex, geocode, getJSON };
