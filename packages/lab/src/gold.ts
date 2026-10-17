import type { Pair } from '@epubmerger/core';
import type { GroupResult } from './paragraphs.ts';
import { answerIds, answerNear, assignVerdicts, opening, rows, type Verdict } from './review.ts';

/**
 * 标准答案：把 0.4a 的判断（verdicts.json）变成每组完整的配对表，给 0.10 算 F1。
 * 判对的行和没判过的白色行原样收下（白色行抽查 300 行全对），判错的行换成 answer 写的段落；
 * 对不上的地方列成清单，由人看原文后写进 gold-fixes.json
 */

/** 一个配对单元，附每段开头，以后抽取变了、编号对不上时能发现 */
export interface GoldBead extends Pair {
  enHead: string[];
  zhHead: string[];
  /** 来自 gold-fixes.json 的单元：修正的说明 */
  fix?: string;
}

export interface GoldGroup {
  /** 章节表里第几组 */
  index: number;
  beads: GoldBead[];
}

/**
 * 人工修正：一个配对单元，用段落开头来认段落（和 verdicts.json 一样）。
 * 套上时，这些段落先从别的单元里拿掉，再加上这个单元。en、zh 都可以是空数组，表示没有对应
 */
export interface GoldFix {
  group: number;
  en: string[];
  zh: string[];
  /** 同样的开头有好几段时，选离这个编号最近的 */
  enAt?: number;
  zhAt?: number;
  note?: string;
}

export interface GoldResult {
  groups: GoldGroup[];
  problems: string[];
}

function head(text: string): string {
  return opening(text);
}

/** 开头 → 这一组里的段落编号；找不到时为 undefined */
function find(openings: string[], blocks: GroupResult['en'], near: number): (number | undefined)[] {
  return openings.map((a) => {
    const id = answerIds([a], blocks, near);
    return id === '?' ? undefined : Number(id);
  });
}

function describe(g: GroupResult, side: 'en' | 'zh', i: number): string {
  return `${side === 'en' ? '英' : '中'} #${i}「${head(g[side][i]!.text)}」`;
}

function beadText(g: GroupResult, b: Pair): string {
  const part = (side: 'en' | 'zh') =>
    b[side].length === 0 ? '（无）' : b[side].map((i) => describe(g, side, i)).join(' + ');
  return `${part('en')} ↔ ${part('zh')}`;
}

/** 一组的标准答案。problems 里每条都写明组号和段落，方便对着原文改 */
export function goldGroup(
  g: GroupResult,
  verdicts: Verdict[],
  fixes: GoldFix[],
): { group: GoldGroup; problems: string[] } {
  const problems: string[] = [];
  const where = `组 ${g.index}（${g.zhTitle || g.enTitle}）`;
  const groupRows = rows(g);
  const assigned = assignVerdicts(g, groupRows, verdicts);

  const mine = verdicts.filter((v) => v.group === g.index);
  const used = new Set(assigned.values());
  for (const v of mine) {
    if (!used.has(v)) problems.push(`${where}：判断找不到对应的行：「${v.zh ?? v.en}」`);
  }

  // answered：判错、换成了答案的单元；shrunk：段落被答案拿走了一部分，剩下的要人看
  type Draft = Pair & { answered: boolean; shrunk: boolean; fix?: string };
  let beads: Draft[] = groupRows.map((row) => {
    const v = assigned.get(row.k);
    const keep = { ...row.pair, answered: false, shrunk: false };
    if (v === undefined || v.ok === true) return keep;
    if (v.ok === null) {
      problems.push(`${where}：判成不确定：${beadText(g, row.pair)}`);
      return keep;
    }
    // 判错：有中文的行，answer 是英文；没有中文的行，answer 是中文
    const other = row.pair.zh.length > 0 ? 'en' : 'zh';
    const ids = find(v.answer ?? [], g[other], answerNear(g, row));
    ids.forEach((id, n) => {
      if (id === undefined) problems.push(`${where}：答案找不到段落「${v.answer![n]}」`);
    });
    const found = ids.filter((id): id is number => id !== undefined);
    const pair = other === 'en' ? { en: found, zh: row.pair.zh } : { en: row.pair.en, zh: found };
    return { ...pair, answered: true, shrunk: false };
  });

  // 答案优先：答案点名的段落，从没判错的单元里拿掉
  const claimed = {
    en: new Set(beads.filter((b) => b.answered).flatMap((b) => b.en)),
    zh: new Set(beads.filter((b) => b.answered).flatMap((b) => b.zh)),
  };
  const without = (b: Draft, taken: { en: Set<number>; zh: Set<number> }): Draft => {
    const en = b.en.filter((i) => !taken.en.has(i));
    const zh = b.zh.filter((j) => !taken.zh.has(j));
    const shrunk = en.length < b.en.length || zh.length < b.zh.length;
    return { ...b, en, zh, shrunk: b.shrunk || shrunk };
  };
  beads = beads
    .map((b) => (b.answered ? b : without(b, claimed)))
    .filter((b) => b.en.length + b.zh.length > 0);

  for (const fix of fixes.filter((f) => f.group === g.index)) {
    const en = find(fix.en, g.en, fix.enAt ?? 0);
    const zh = find(fix.zh, g.zh, fix.zhAt ?? 0);
    if ([...en, ...zh].some((id) => id === undefined)) {
      problems.push(`${where}：修正找不到段落：${[...fix.en, ...fix.zh].join(' / ')}`);
      continue;
    }
    const bead = { en: en as number[], zh: zh as number[] };
    const taken = { en: new Set(bead.en), zh: new Set(bead.zh) };
    // 人改过的单元算看过了：剩下的部分不再报"被拿走"
    beads = beads
      .map((b) => {
        const rest = without(b, taken);
        const touched = rest.en.length < b.en.length || rest.zh.length < b.zh.length;
        return touched ? { ...rest, shrunk: false } : rest;
      })
      .filter((b) => b.en.length + b.zh.length > 0);
    beads.push({ ...bead, answered: true, shrunk: false, fix: fix.note ?? '修正' });
  }

  for (const b of beads) {
    if (b.shrunk) problems.push(`${where}：段落被答案拿走，剩下：${beadText(g, b)}`);
  }

  // 每段恰好出现一次
  for (const side of ['en', 'zh'] as const) {
    const count = new Array<number>(g[side].length).fill(0);
    for (const b of beads) for (const i of b[side]) count[i]!++;
    count.forEach((n, i) => {
      if (n === 0) problems.push(`${where}：落单：${describe(g, side, i)}`);
      if (n > 1) {
        const holders = beads.filter((b) => b[side].includes(i)).map((b) => beadText(g, b));
        problems.push(
          `${where}：${describe(g, side, i)} 出现 ${n} 次：\n      ${holders.join('\n      ')}`,
        );
      }
    });
  }

  // 顺序：按行的顺序，修正加在最后（打分不看顺序）
  return {
    group: {
      index: g.index,
      beads: beads.map((b) => ({
        en: b.en,
        zh: b.zh,
        enHead: b.en.map((i) => head(g.en[i]!.text)),
        zhHead: b.zh.map((j) => head(g.zh[j]!.text)),
        ...(b.fix !== undefined && { fix: b.fix }),
      })),
    },
    problems,
  };
}

export function buildGold(
  groups: GroupResult[],
  verdicts: Verdict[],
  fixes: GoldFix[],
): GoldResult {
  const results = groups.map((g) => goldGroup(g, verdicts, fixes));
  const known = new Set(groups.map((g) => g.index));
  const stray = [...verdicts, ...fixes]
    .filter((v) => !known.has(v.group))
    .map((v) => `组 ${v.group} 不在配对的组里（判断或修正对不上）`);
  return {
    groups: results.map((r) => r.group),
    problems: [...stray, ...results.flatMap((r) => r.problems)],
  };
}
