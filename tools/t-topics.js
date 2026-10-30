'use strict';
/* 测论文话题：空状态 → 点模板 → 拉数据 */
const PORT = process.env.CDP_PORT || 9300;
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
  let t = await list();
  const st = t.find((x) => x.url.includes('stage.html'));
  const s = await conn(st.webSocketDebuggerUrl);
  await s.ev('document.getElementById("pet").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true})); "rc"');
  await wait(1500);
  t = await list();
  const pn = t.find((x) => x.url.includes('panel.html'));
  if (!pn) { console.log('面板没开'); process.exit(1); }
  const p = await conn(pn.webSocketDebuggerUrl);
  await p.ev('document.querySelector("[data-tab=paper]").click(); "ok"');
  await wait(1200);

  console.log('空状态 pMeta:', await p.ev('document.getElementById("pMeta").textContent'));
  console.log('话题块数量:', await p.ev('document.querySelectorAll("#topicBox .topic").length'));
  console.log('模板按钮:', await p.ev('document.querySelectorAll("#topicTpl [data-tpl]").length'));

  await p.ev('document.querySelector("[data-tpl=ai]").click(); "ok"');
  await wait(1500);
  console.log('点模板后话题数:', await p.ev('document.querySelectorAll("#topicBox .topic").length'));
  console.log('话题名:', await p.ev('(document.querySelector("#topicBox .topic b")||{}).textContent'));
  console.log('关键词:', await p.ev('(document.querySelector("#topicBox textarea")||{}).value'));
  console.log('pMeta:', await p.ev('document.getElementById("pMeta").textContent'));
  process.exit(0);
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
