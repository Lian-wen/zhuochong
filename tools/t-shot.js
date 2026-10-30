'use strict';
/* 端到端测框选截图：开框选窗口 → 合成一次拖动 → 打印 rect / 落盘尺寸 */
const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || 9240;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() {
  return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
}

function conn(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0;
    const p = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
    });
    ws.addEventListener('open', () => resolve({
      send: (method, params = {}) => new Promise((r) => { const i = ++id; p.set(i, (m) => r(m.result)); ws.send(JSON.stringify({ id: i, method, params })); }),
      ev: async (expr) => {
        const r = await new Promise((res) => { const i = ++id; p.set(i, (m) => res(m.result)); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
        if (r && r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails.exception);
        return r && r.result && r.result.value;
      },
      close: () => ws.close()
    }));
  });
}

(async () => {
  let targets = await list();
  const panel = targets.find((t) => t.url.includes('panel.html'));
  if (!panel) throw new Error('panel 没开');
  const p = await conn(panel.webSocketDebuggerUrl);

  console.log('触发框选…');
  p.ev('window.api.shotRegion(); "fired"');

  let sel = null;
  for (let i = 0; i < 60; i++) {
    await wait(200);
    targets = await list();
    sel = targets.find((t) => t.url.includes('selector.html'));
    if (sel) break;
  }
  if (!sel) throw new Error('框选窗口 12 秒没出现');
  console.log('框选窗口已出现');
  await wait(400);

  const s = await conn(sel.webSocketDebuggerUrl);
  console.log('窗口尺寸:', await s.ev('innerWidth + "x" + innerHeight'));
  console.log('图已就绪:', await s.ev('document.getElementById("shot").naturalWidth + "x" + document.getElementById("shot").naturalHeight'));

  const drag = `(function(){
    const fire=(t,x,y)=>document.dispatchEvent(new MouseEvent(t,{clientX:x,clientY:y,button:0,bubbles:true}));
    fire('mousedown',320,300); fire('mousemove',980,560); fire('mouseup',980,560);
    return window.__lastRect ? JSON.stringify(window.__lastRect) : 'no-rect';
  })()`;
  console.log('rect:', await s.ev(drag));

  await wait(7000);
  const dir = path.join(process.env.USERPROFILE || '', 'Pictures', '桌宠截图');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.png')); } catch (e) { }
  files.sort();
  console.log('截图文件数:', files.length);
  if (files.length) console.log('最新:', files[files.length - 1], fs.statSync(path.join(dir, files[files.length - 1])).size, 'bytes');
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
