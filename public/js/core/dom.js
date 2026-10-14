export const $ = (id) => document.getElementById(id);

// h('div', { class: 'x', onclick }, 'text', childEl)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

// Reads an NDJSON response stream, calling onLine for each parsed object.
export async function readNdjson(res, onLine) {
  const rd = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onLine(JSON.parse(line));
    }
  }
}

// Two-click confirmation for destructive buttons.
export function confirmButton(btn, { armedLabel, ms = 4000, onConfirm }) {
  const label = btn.textContent;
  let timer = null;
  btn.addEventListener('click', async () => {
    if (!timer) {
      btn.textContent = armedLabel;
      timer = setTimeout(() => { timer = null; btn.textContent = label; }, ms);
      return;
    }
    clearTimeout(timer);
    timer = null;
    btn.textContent = label;
    await onConfirm();
  });
}
