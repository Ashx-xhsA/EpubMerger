import type { Block } from '@epubmerger/core';
import { escapeHtml } from './chapters.ts';
import type { GoldGroup } from './gold.ts';
import type { GroupResult } from './paragraphs.ts';
import { pickSample } from './review.ts';

/**
 * 抽查人工修正：从每本书 gold.json 里来自 gold-fixes.json 的单元中固定抽 size 条，
 * 两边段落全文并排，前后各带一段上下文。人点 ✓ ✗，结果存在浏览器里，可以复制成文字交给 Claude
 */

export interface CheckBook {
  book: string;
  groups: GroupResult[];
  gold: GoldGroup[];
}

export interface CheckItem {
  book: string;
  group: number;
  title: string;
  fix: string;
  en: number[];
  zh: number[];
}

export function pickFixes(b: CheckBook, size: number): CheckItem[] {
  const all = b.gold.flatMap((g) =>
    g.beads
      .filter((x) => x.fix !== undefined)
      .map((x) => {
        const group = b.groups.find((r) => r.index === g.index)!;
        return {
          book: b.book,
          group: g.index,
          title: group.zhTitle || group.enTitle,
          fix: x.fix!,
          en: x.en,
          zh: x.zh,
        };
      }),
  );
  const candidates = all.map((x) => ({
    key: `${x.book}|${x.group}|${x.en.join(',')}|${x.zh.join(',')}`,
    yellow: false,
    init: null,
  }));
  return pickSample(candidates, size).map((i) => all[i]!);
}

function side(blocks: Block[], ids: number[], lang: string): string {
  if (ids.length === 0) return `<td class="skip">（没有对应）</td>`;
  const p = (i: number, cls: string) =>
    blocks[i] === undefined
      ? ''
      : `<p class="${cls}"><span class="id">#${i}</span>${escapeHtml(blocks[i]!.text)}</p>`;
  const before = p(Math.min(...ids) - 1, 'context');
  const after = p(Math.max(...ids) + 1, 'context');
  return `<td lang="${lang}">${before}${ids.map((i) => p(i, '')).join('')}${after}</td>`;
}

export function goldCheckHtml(books: CheckBook[], size: number): string {
  const sections = books.map((b) => {
    const items = pickFixes(b, size);
    const rows = items.map((x) => {
      const g = b.groups.find((r) => r.index === x.group)!;
      const id = `${x.book}|${x.group}|英${x.en.join('+') || '无'}|中${x.zh.join('+') || '无'}`;
      return `<tr data-id="${escapeHtml(id)}"><td class="meta"><div>组 ${x.group} · ${escapeHtml(x.title)}</div><div class="fix">${escapeHtml(x.fix)}</div><div class="verdict"><button data-v="ok">✓</button><button data-v="bad">✗</button><input placeholder="错在哪（可不填）"></div></td>${side(g.en, x.en, 'en')}${side(g.zh, x.zh, 'zh')}</tr>`;
    });
    return `<h2>${escapeHtml(b.book)}（抽 ${items.length} 条）</h2><table><thead><tr><th>修正</th><th>英文</th><th>中文</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  });
  return `<!doctype html>
<html lang="zh-Hans">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>标准答案抽查</title>
<style>
:root { --bg: #fafaf9; --card: #fff; --text: #1c1917; --muted: #78716c; --line: #e7e5e4; --ok: #15803d; --ok-soft: #dcfce7; --bad: #b91c1c; --bad-soft: #fee2e2; --accent: #2563eb; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1917; --card: #292524; --text: #f5f5f4; --muted: #a8a29e; --line: #44403c; --ok: #4ade80; --ok-soft: #14361f; --bad: #f87171; --bad-soft: #4c1d1d; --accent: #60a5fa; }
}
* { box-sizing: border-box; }
body { margin: 0; padding: 0 16px 48px; background: var(--bg); color: var(--text); font: 15px/1.6 -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
main { max-width: 1200px; margin: 0 auto; }
header { position: sticky; top: 0; z-index: 2; background: var(--bg); border-bottom: 1px solid var(--line); padding: 16px 0 12px; }
h1 { font-size: 20px; margin: 0 0 4px; }
.help { color: var(--muted); font-size: 13px; margin: 0 0 8px; }
header button { font: inherit; font-size: 13px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--text); cursor: pointer; }
#stats { font-size: 14px; margin-left: 12px; }
h2 { font-size: 16px; margin: 28px 0 6px; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; background: var(--card); }
th, td { border-bottom: 1px solid var(--line); padding: 8px; vertical-align: top; text-align: left; overflow-wrap: anywhere; }
th { color: var(--muted); font-weight: 600; }
th:first-child, td.meta { width: 220px; }
td p { margin: 0 0 6px; }
p.context { color: var(--muted); font-size: 13px; }
p.context::before { content: "上下文 "; font-size: 11px; }
.id { color: var(--accent); font-size: 11px; margin-right: 6px; font-variant-numeric: tabular-nums; }
td.skip { color: var(--muted); }
.fix { font-size: 13px; color: var(--muted); margin: 4px 0; }
.verdict { display: flex; flex-wrap: wrap; gap: 4px; }
.verdict button { width: 34px; height: 28px; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--text); cursor: pointer; }
.verdict input { width: 100%; padding: 2px 6px; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--text); font: inherit; font-size: 12px; }
tr.v-ok td:first-child { box-shadow: inset 4px 0 var(--ok); }
tr.v-bad td:first-child { box-shadow: inset 4px 0 var(--bad); }
tr.v-ok button[data-v="ok"] { background: var(--ok-soft); border-color: var(--ok); color: var(--ok); }
tr.v-bad button[data-v="bad"] { background: var(--bad-soft); border-color: var(--bad); color: var(--bad); }
textarea { width: 100%; height: 120px; margin-top: 8px; font: 12px/1.5 ui-monospace, monospace; background: var(--card); color: var(--text); border: 1px solid var(--line); }
@media (max-width: 640px) { th:first-child, td.meta { width: 120px; } body { font-size: 14px; } }
</style>
</head>
<body>
<main>
<header>
<h1>标准答案抽查</h1>
<p class="help">每行是 Claude 写进 gold-fixes.json 的一条修正：这几段英文和这几段中文应该配成一对（"没有对应"表示这几段在另一边没有翻译）。灰色小字是前后各一段上下文，只用来帮你判断。对就点 ✓，错就点 ✗，可以写一句错在哪。结果存在这个浏览器里；看完点"复制结果"，粘贴给 Claude。</p>
<button id="copy">复制结果</button><span id="stats"></span>
<textarea id="out" readonly hidden></textarea>
</header>
${sections.join('\n')}
</main>
<script>
const KEY = 'gold-check';
let state = {};
try { state = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };
const rows = [...document.querySelectorAll('tr[data-id]')];
function paint() {
  let ok = 0, bad = 0;
  for (const tr of rows) {
    const s = state[tr.dataset.id] || {};
    tr.classList.toggle('v-ok', s.v === 'ok');
    tr.classList.toggle('v-bad', s.v === 'bad');
    tr.querySelector('input').value = s.note || '';
    if (s.v === 'ok') ok++;
    if (s.v === 'bad') bad++;
  }
  document.getElementById('stats').textContent = '已看 ' + (ok + bad) + ' / ' + rows.length + '，错 ' + bad;
}
for (const tr of rows) {
  const id = tr.dataset.id;
  tr.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    state[id] = { ...(state[id] || {}), v: b.dataset.v };
    save(); paint();
  }));
  tr.querySelector('input').addEventListener('input', (e) => {
    state[id] = { ...(state[id] || {}), note: e.target.value };
    save();
  });
}
document.getElementById('copy').addEventListener('click', async () => {
  const text = rows.map((tr) => {
    const s = state[tr.dataset.id] || {};
    const v = s.v === 'ok' ? '对' : s.v === 'bad' ? '错' : '没看';
    return tr.dataset.id + '：' + v + (s.note ? '（' + s.note + '）' : '');
  }).join('\\n');
  const out = document.getElementById('out');
  out.value = text;
  out.hidden = false;
  try { await navigator.clipboard.writeText(text); document.getElementById('copy').textContent = '已复制'; } catch { out.select(); }
});
paint();
</script>
</body>
</html>
`;
}
