import { normalizeTitle, regionOfTitle } from '../extract/regions.ts';
import type { Region } from '../extract/types.ts';
import type { Section } from './map.ts';
import { nonEmpty, sectionChars, type Anchor } from './prefill.ts';

/**
 * 猜两本书的正文从哪一节开始、到哪一节结束（1.6）。用户在章节表之前确认或改掉，
 * 然后首尾之外的节不合并，中间按长度配（pairFromAnchor）。9 对书上，首尾选对时只要改 7 行
 */

/** 这些区域的节不会是正文的首尾。preface 不在里面：导言、序言常常两本书都有，算正文 */
const SKIP_REGIONS = new Set<Region>([
  'cover',
  'titlepage',
  'copyright',
  'toc',
  'praise',
  'also-by',
  'about-author',
  'translator',
  'dedication',
  'epigraph',
  'acknowledgments',
  'notes',
  'bibliography',
  'index',
  'auxiliary',
]);

/** regionOfTitle 要求整个标题就是那个词；这里补几种只看开头的杂页 */
const SKIP_TITLE =
  /^(epigraphs?|中译(本|版)?序|译者(导读|序|前言)|译序|译后记|glossary|词汇表|术语表|select bibliography|further reading|note on the text|list of (illustrations|variants|maps|figures)|sneak peek|excerpt|preview|bonus|reading group|discussion questions|试读|节选)/;

/** 正文前面的序、导言。只有一本有时（例如只有英文版有学者写的导言）不算正文的开头 */
const PREFACE_LIKE = /^(prologue|introduction|preface|foreword|序|引言|导论|导言|前言|楔子|引子)/;

/** 正文后面的尾声、后记。同上，只有一本有时不算正文的结尾 */
const EPILOGUE_LIKE =
  /^(epilogue|afterword|postscript|coda|conclusion|后记|尾声|结语|结论|跋|终章)/;

/** 一节里字数最多的区域 */
function mainRegion(s: Section): Region | null {
  const chars = new Map<Region, number>();
  for (const b of s.blocks) chars.set(b.region, (chars.get(b.region) ?? 0) + b.text.length);
  return [...chars].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** 可能是正文首尾的节：有正文、不太短（杂页一般很短）、标题和内容都不像杂页 */
function candidates(sections: Section[]): number[] {
  const ids = nonEmpty(sections);
  const chars = ids.map((i) => sectionChars(sections[i]!)).sort((a, b) => a - b);
  const median = chars[Math.floor(chars.length / 2)] ?? 0;
  return ids.filter((i) => {
    const s = sections[i]!;
    const title = normalizeTitle(s.title);
    const region = mainRegion(s);
    const byTitle = regionOfTitle(s.title);
    return (
      // 目录之前的内容（chapterSections 起的名字）几乎都是杂页
      s.title !== '（目录前）' &&
      sectionChars(s) >= median / 10 &&
      !SKIP_TITLE.test(title) &&
      !(byTitle !== null && SKIP_REGIONS.has(byTitle)) &&
      !(region !== null && SKIP_REGIONS.has(region))
    );
  });
}

/**
 * 两边各取第一个候选；一边像序、另一边不像时，像序的那边往后走一个，直到两边一致。
 * 结尾同理，从后往前，看像不像后记
 */
function pick(en: Section[], zh: Section[], ce: number[], cz: number[], like: RegExp): Anchor {
  const test = (s: Section[], i: number | undefined) =>
    i !== undefined && like.test(normalizeTitle(s[i]!.title));
  let [a, b] = [0, 0];
  for (;;) {
    const [pa, pb] = [test(en, ce[a]), test(zh, cz[b])];
    if (pa && !pb && a + 1 < ce.length) a++;
    else if (pb && !pa && b + 1 < cz.length) b++;
    else break;
  }
  return { en: ce[a] ?? 0, zh: cz[b] ?? 0 };
}

export function guessAnchors(en: Section[], zh: Section[]): { from: Anchor; to: Anchor } {
  const ce = candidates(en);
  const cz = candidates(zh);
  const fallback = (s: Section[]) => {
    const ids = nonEmpty(s);
    return ids.length > 0 ? ids : [0];
  };
  const [fe, fz] = [ce.length > 0 ? ce : fallback(en), cz.length > 0 ? cz : fallback(zh)];
  const from = pick(en, zh, fe, fz, PREFACE_LIKE);
  const back = pick(en, zh, [...fe].reverse(), [...fz].reverse(), EPILOGUE_LIKE);
  return {
    from,
    to: { en: Math.max(back.en, from.en), zh: Math.max(back.zh, from.zh) },
  };
}
