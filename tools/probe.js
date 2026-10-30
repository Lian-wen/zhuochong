'use strict';
/**
 * 自检探针：连上 CDP，抓一张真实渲染截图 + 检查 DOM 是否正常
 * 用法：先启动 `electron . --probe --remote-debugging-port=9222`，再 node tools/probe.js
 */
const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || 9222;
const OUT = path.join(__dirname, '..', '.workbuddy');

function cdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener('open', () => resolve({ send, close: () => ws.close() }));
    ws.addEventListener('error', (e) => reject(new Error('ws error')));
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    });
    function send(method, params = {}) {
      const mid = ++id;
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params }));
        setTimeout(() => {
          if (pending.has(mid)) { pending.delete(mid); rej(new Error('timeout ' + method)); }
        }, 15000);
      });
    }
  });
}

async function listTargets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  let targets = await listTargets();
  console.log('页面数：', targets.length, targets.map((t) => t.url.split('/').pop()).join(', '));

  const stage = targets.find((t) => t.url.includes('stage.html'));
  if (!stage) throw new Error('没找到 stage 页面');

  const c = await cdp(stage.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');

  const ev = async (expr) => {
    const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) return 'ERR: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description);
    return r.result.value;
  };

  console.log('窗口尺寸：', await ev('innerWidth + "x" + innerHeight'));
  console.log('宠物存在：', await ev('!!document.getElementById("pet")'));
  console.log('宠物位置：', await ev('(document.getElementById("pet").style.left||"?") + "," + (document.getElementById("pet").style.bottom||"?")'));
  console.log('气泡文字：', await ev('document.getElementById("bMsg").textContent.slice(0,60)'));
  console.log('气泡可见：', await ev('document.getElementById("bubble").classList.contains("show")'));
  console.log('SVG 可见：', await ev('getComputedStyle(document.getElementById("catSvg")).display'));
  console.log('页面报错：', await ev('JSON.stringify(window.__errs||[])'));
  console.log('数据快照：', await ev('(window.__snap ? "有" : "无")'));

  // 点一下宠物，弹出卡片坞
  await ev('document.getElementById("pet").dispatchEvent(new MouseEvent("mousedown",{button:0,clientX:800,clientY:300,screenX:800,screenY:900})); document.dispatchEvent(new MouseEvent("mouseup")); "clicked"');
  await new Promise((r) => setTimeout(r, 2200));

  targets = await listTargets();
  console.log('点击后页面：', targets.length);

  for (const t of targets) {
    const name = t.url.includes('panel') ? 'live-panel' : t.url.includes('stage') ? 'live-stage' : null;
    if (!name) continue;
    const conn = await cdp(t.webSocketDebuggerUrl);
    await conn.send('Page.enable');
    await conn.send('Runtime.enable');
    // 透明底在图里看不清，临时铺一个底色
    await conn.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 239, g: 233, b: 222, a: 1 } });
    const shot = await conn.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
    console.log('已保存', name + '.png');
    conn.close();
  }
  c.close();
  process.exit(0);
})().catch((e) => { console.error('探针失败：', e.message); process.exit(1); });
