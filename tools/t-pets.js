'use strict';
/* 测「我的桌宠」：素材网格、点击切换、改名 */
const fs = require('fs');
const PORT = process.env.CDP_PORT || 9280;
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
        const r = await new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })); });
        if (r && r.exceptionDetails) return 'ERR:' + JSON.stringify(r.exceptionDetails.exception);
        return r && r.result && r.result.value;
      },
      close: () => ws.close()
    }));
  });
}

(async () => {
  await wait(9000);
  let targets = await list();
  const st = targets.find((t) => t.url.includes('stage.html'));
  const s = await conn(st.webSocketDebuggerUrl);
  // 右键开面板
  await s.ev('document.getElementById("pet").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})); "rc"');
  await wait(1500);

  targets = await list();
  const pn = targets.find((t) => t.url.includes('panel.html'));
  if (!pn) { console.log('面板没开'); process.exit(1); }
  const p = await conn(pn.webSocketDebuggerUrl);

  await p.ev('document.querySelector("[data-tab=set]").click(); "ok"');
  await wait(1500);

  console.log('网格数量:', await p.ev('document.querySelectorAll("#petGrid .cell").length'));
  console.log('当前选中:', await p.ev('(document.querySelector("#petGrid .cell.on")||{}).title || "(无)"'));
  console.log('名字输入框:', await p.ev('document.getElementById("petNameInp").value'));

  const third = await p.ev('(function(){const c=document.querySelectorAll("#petGrid .cell")[2];return c?c.title:"none";})()');
  console.log('准备切到:', third);
  await p.ev('document.querySelectorAll("#petGrid .cell")[2].click(); "clicked"');
  await wait(1200);
  console.log('切换后选中:', await p.ev('(document.querySelector("#petGrid .cell.on")||{}).title || "(无)"'));

  // 宠物那边实际用的图
  const img = await s.ev('document.getElementById("petImg").src');
  console.log('舞台图:', decodeURIComponent(img).split('/').slice(-2).join('/'));

  // 改名
  await p.ev(`(function(){
    const i=document.getElementById('petNameInp');
    i.value='小乌龟'; i.dispatchEvent(new Event('change',{bubbles:true})); return 'ok';
  })()`);
  await wait(900);
  console.log('顶栏名字:', await p.ev('document.getElementById("petName").textContent'));

  console.log('报错:', await p.ev('JSON.stringify(window.__errs||[])'));
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
