'use strict';
/**
 * 配置与密钥存储
 * - 配置：%APPDATA%/zhuochong/config.json
 * - 密钥：DPAPI 加密后存在同一文件的 _secrets 下，绝不明文落盘
 */
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

function dir() { return app.getPath('userData'); }
function file() { return path.join(dir(), 'config.json'); }

const DEFAULTS = {
  city: { name: '北京', lat: 39.9042, lon: 116.4074 },
  thresholds: {
    balanceLow: 20,        // 余额低于此值预警（元）
    sitMinutes: 45,        // 连续活跃多久提醒起来
    nightHour: 23.5,       // 熬夜劝退时间点（23:30）
    rainProb: 50           // 未来 2 小时降雨概率阈值 %
  },
  offpeak: { enabled: true, start: '00:30', end: '08:30' }, // 优惠时段（可改）
  cards: {
    weather: true, balance: true, system: true, news: true, github: false, arxiv: false
  },
  pet: {
    name: '桌宠',
    scale: 1,
    quiet: false,          // 安静模式：不说话，只更新数据
    reduceMotion: false,
    autoWalk: true,
    autoReport: true,      // 自己主动播报
    reportMinutes: 5,      // 播报间隔（分钟）
    alwaysOnTop: true
  },
  github: { user: '', token: '' },
  arxiv: { cats: 'cs.AI+OR+cs.CL', max: 4 },
  papers: {
    enabled: true,
    maxPerDay: 6,
    tldr: true,
    pushAt: '09:00',
    // 默认不预置任何话题 —— 每个人的领域不一样，硬塞一个方向等于替用户做决定。
    // 设置页给了几个模板，点一下就能加；也可以自己填关键词。
    topics: []
  },
  rss: [
    { name: '量子位', url: 'https://www.qbitai.com/feed' },
    { name: '爱范儿', url: 'https://www.ifanr.com/feed' },
    { name: 'Solidot', url: 'https://www.solidot.org/index.rss' },
    { name: '少数派', url: 'https://sspai.com/feed' }
  ],
  lastRun: 0
};

let cache = null;

function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function read() {
  if (cache) return cache;
  let disk = {};
  try {
    if (fs.existsSync(file())) disk = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    console.error('[store] 配置损坏，使用默认值:', e.message);
  }
  cache = deepMerge(DEFAULTS, disk);
  if (cache.pet && cache.pet.name === '茶宠') cache.pet.name = '桌宠';
  if (!cache._secrets) cache._secrets = {};
  return cache;
}

function write() {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[store] 写入失败:', e.message);
    return false;
  }
}

function get() { return read(); }

function patch(p) {
  cache = deepMerge(read(), p);
  write();
  return publicView();
}

/** 对外可见的配置（抹掉密钥） */
function publicView() {
  const c = JSON.parse(JSON.stringify(read()));
  delete c._secrets;
  c.hasKey = {};
  for (const k of Object.keys(read()._secrets || {})) c.hasKey[k] = true;
  if (c.github && c.github.token) c.github = { user: c.github.user, hasToken: true };
  return c;
}

function encryptionOK() {
  try { return safeStorage.isEncryptionAvailable(); } catch (e) { return false; }
}

function setSecret(name, value) {
  const c = read();
  if (!c._secrets) c._secrets = {};
  if (!value) { delete c._secrets[name]; write(); return true; }
  try {
    if (encryptionOK()) {
      c._secrets[name] = 'enc:' + safeStorage.encryptString(value).toString('base64');
    } else {
      c._secrets[name] = 'b64:' + Buffer.from(value, 'utf8').toString('base64');
      console.warn('[store] 系统加密不可用，密钥仅 base64 保存');
    }
    write();
    return true;
  } catch (e) {
    console.error('[store] 保存密钥失败:', e.message);
    return false;
  }
}

function getSecret(name) {
  const raw = read()._secrets && read()._secrets[name];
  if (!raw) return '';
  try {
    if (raw.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64'));
    }
    if (raw.startsWith('b64:')) return Buffer.from(raw.slice(4), 'base64').toString('utf8');
    return raw;
  } catch (e) {
    console.error('[store] 解密失败（可能换了机器/账户）:', e.message);
    return '';
  }
}

function reset() {
  cache = deepMerge(DEFAULTS, {});
  cache._secrets = {};
  write();
  return publicView();
}

module.exports = { get, patch, publicView, setSecret, getSecret, reset, encryptionOK, dir, file };
