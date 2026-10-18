// 判一本书的语言：每段先按文字判（script.ts），再按段落数投票。
//
// 中日韩靠文字本身就能分开；英文、法文、德文用的是同一套字母，要交给 franc 按字母组合的统计规律认。
// franc 认短段落不准、也比数字符慢，所以每种字母文字只均匀抽一部分够长的段落给它，
// 再按抽样的比例把这种文字的段落分给各语言。

import { franc } from 'franc-min';
import type { Block, Region } from '../extract/types.ts';
import { classifyParagraph } from './script.ts';
import type { BookLanguage, LanguageDetection, ParagraphClass } from './types.ts';
import { countVariants } from './variant.ts';

/** 某种语言至少占这么多段，就是这种语言的书 */
export const SINGLE_SHARE = 0.7;
/** 字母文字的段至少要有这么多个字母才交给 franc */
export const MIN_SAMPLE_LETTERS = 100;
/** 每种字母文字最多抽这么多段 */
export const MAX_SAMPLES = 200;

/** 这些区域的文字和书的语言常常不一样（中文译本的版权页、参考文献、索引往往整页是英文） */
const SKIPPED_REGIONS: ReadonlySet<Region> = new Set([
  'cover',
  'titlepage',
  'copyright',
  'toc',
  'notes',
  'bibliography',
  'index',
]);
const VOTING_KINDS: ReadonlySet<Block['kind']> = new Set(['para', 'quote', 'list']);

/** franc 的 ISO 639-3 代码 → BCP 47。只列常见的，其他保留三字母代码 */
const BCP47: Readonly<Record<string, string>> = {
  eng: 'en',
  fra: 'fr',
  deu: 'de',
  spa: 'es',
  por: 'pt',
  ita: 'it',
  nld: 'nl',
  pol: 'pl',
  tur: 'tr',
  swe: 'sv',
  ces: 'cs',
  hun: 'hu',
  ron: 'ro',
  ind: 'id',
  vie: 'vi',
  rus: 'ru',
  ukr: 'uk',
  bel: 'be',
  bul: 'bg',
  ell: 'el',
  arb: 'ar',
  heb: 'he',
  pes: 'fa',
  urd: 'ur',
  hin: 'hi',
  tha: 'th',
};

const ALPHABETIC = ['latin', 'cyrillic', 'other'] as const;

function emptyClassCounts(): Record<ParagraphClass, number> {
  return { zh: 0, ja: 0, ko: 0, latin: 0, cyrillic: 0, other: 0, mixed: 0, short: 0 };
}

/** 从 items 里按位置均匀挑最多 max 个 */
export function evenSample<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.floor((i * items.length) / max)]!);
}

function letterCount(text: string): number {
  return text.match(/\p{L}/gu)?.length ?? 0;
}

/** 用 franc 认一组同一种字母文字的段落，返回 语言 → 段数（抽样内） */
function sampleLanguages(texts: string[]): Record<string, number> {
  const long = texts.filter((t) => letterCount(t) >= MIN_SAMPLE_LETTERS);
  // 一段够长的都没有（比如全是短诗）：把短段落拼起来认一次
  const samples =
    long.length > 0 ? evenSample(long, MAX_SAMPLES) : [texts.join(' ').slice(0, 5000)];
  const votes: Record<string, number> = {};
  for (const text of samples) {
    const code = franc(text);
    if (code === 'und') continue;
    const lang = BCP47[code] ?? code;
    votes[lang] = (votes[lang] ?? 0) + 1;
  }
  return votes;
}

/** 按语言的段落数下结论 */
function decide(languages: Record<string, number>): BookLanguage {
  const ranked = Object.entries(languages)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, n]) => sum + n, 0);
  const [first] = ranked;
  if (first === undefined || total === 0) return { kind: 'uncertain' };
  // 已经是双语的书（两种语言各占一半）也落在这里：不专门拦，交给用户看警告
  if (first[1] / total >= SINGLE_SHARE) return { kind: 'single', lang: first[0] };
  return { kind: 'uncertain' };
}

/** 判一本书的语言。blocks 是 extractBlocks 的结果 */
export function detectLanguage(blocks: Block[]): LanguageDetection {
  const paragraphs = emptyClassCounts();
  const variants = { traditional: 0, simplified: 0 };
  const alphabetic: Record<(typeof ALPHABETIC)[number], string[]> = {
    latin: [],
    cyrillic: [],
    other: [],
  };

  for (const block of blocks) {
    if (SKIPPED_REGIONS.has(block.region) || !VOTING_KINDS.has(block.kind)) continue;
    const cls = classifyParagraph(block.text);
    paragraphs[cls]++;
    if (cls === 'zh') {
      const v = countVariants(block.text);
      variants.traditional += v.traditional;
      variants.simplified += v.simplified;
    } else if (cls === 'latin' || cls === 'cyrillic' || cls === 'other') {
      alphabetic[cls].push(block.text);
    }
  }

  const languages: Record<string, number> = {};
  const add = (lang: string, n: number) => {
    if (n > 0) languages[lang] = (languages[lang] ?? 0) + n;
  };
  add(variants.traditional > variants.simplified ? 'zh-Hant' : 'zh-Hans', paragraphs.zh);
  add('ja', paragraphs.ja);
  add('ko', paragraphs.ko);

  const samples: Record<string, Record<string, number>> = {};
  for (const script of ALPHABETIC) {
    const texts = alphabetic[script];
    if (texts.length === 0) continue;
    const votes = sampleLanguages(texts);
    samples[script] = votes;
    const voted = Object.values(votes).reduce((sum, n) => sum + n, 0);
    // 按抽样的比例把这种文字的段落分给各语言
    for (const [lang, n] of Object.entries(votes)) add(lang, (texts.length * n) / voted);
  }

  return { language: decide(languages), stats: { paragraphs, languages, variants, samples } };
}
