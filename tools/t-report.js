'use strict';
/* 测播报：左键连点看话题是否轮换，右键看面板是否弹出 */
const PORT = process.env.CDP_PORT || 9260;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function list() { return (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); }

function conn(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let id = 0; const p = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && p.has(m.id)) { p.get(m.id)(m.result); p.delete(m.id); }
    });
    ws.addEventListener('open', () => resolve({
      ev: async (expr) => {
        const r = await new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } })); });
        if (r && r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails.exception);
        return r && r.result && r.result.value;
      },
      close: () => ws.close()
    }));
  });
}

(async () => {
  await wait(8000);
  const targets = await list();
  const st = targets.find((t) => t.url.includes('stage.html'));
  const s = await conn(st.webSocketDebuggerUrl);

  console.log('快照有数据:', await s.ev('window.__snap ? "yes" : "no"'));
  console.log('论文条数:', await s.ev('(window.__snap && window.__snap.papers) ? window.__snap.papers.items.length : -1'));
  console.log('资讯条数:', await s.ev('(window.__snap && window.__snap.news) ? window.__snap.news.items.length : -1'));

  const click = `(function(){
    const pet=document.getElementById('pet');
    pet.dispatchEvent(new MouseEvent('mousedown',{button:0,clientX:800,clientY:300,screenX:800,screenY:900,bubbles:true}));
    document.dispatchEvent(new MouseEvent('mouseup',{button:0,bubbles:true}));
    return 'ok';
  })()`;

  for (let i = 1; i <= 6; i++) {
    await s.ev(click);
    await wait(260);
    const txt = await s.ev('document.getElementById("bMsg").textContent');
    console.log(`第 ${i} 次左键 →`, txt.slice(0, 56));
  }

  await wait(300);
  await s.ev('document.getElementById("pet").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})); "rc"');
  await wait(1200);
  const after = await list();
  console.log('右键后页面数:', after.length, after.map((t) => t.url.split('/').pop()).join(','));

  console.log('报错:', await s.ev('JSON.stringify(window.__errs||[])'));
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
