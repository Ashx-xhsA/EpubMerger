// 判断一个 spine 文件是正文还是哪一种非正文。
//
// 不同的书写法不同，所以按信号的可靠程度依次看，第一个命中的算数：
// 1. epub:type / role（ePub 3 的标准写法，大部分 ePub 2 的书没有）
// 2. 指向这个文件的目录项标题
// 3. 文件里第一个标题（或第一个短段落）的文字
// 4. 内容特征：版权页、注释、索引、目录页各有明显的样子
// 5. linear="no" 的文件
// 都没命中就是正文。关键词要求整个标题基本就是这个词，免得把 "Notes from Underground" 这种章名认成注释。

import type { RawBlock } from './blocks.ts';
import type { Region } from './types.ts';

export interface FileFacts {
  /** spine 里的 linear 属性 */
  linear: boolean;
  /** <body> 和外层容器上的 epub:type / role */
  rootTypes: string[];
  /** 指向这个文件的第一个目录项的标题；没有目录项指向它时是 null */
  tocTitle: string | null;
  blocks: RawBlock[];
}

export interface RegionResult {
  region: Region;
  /** 为什么判成这个 region，人工检查用 */
  reason: string;
}

/** epub:type / role 的词 → region。frontmatter、chapter 这类说明不了是什么的词不在表里 */
const SEMANTIC_TYPES: Record<string, Region> = {
  cover: 'cover',
  titlepage: 'titlepage',
  halftitlepage: 'titlepage',
  'copyright-page': 'copyright',
  colophon: 'copyright',
  toc: 'toc',
  index: 'index',
  bibliography: 'bibliography',
  footnotes: 'notes',
  endnotes: 'notes',
  rearnotes: 'notes',
  acknowledgments: 'acknowledgments',
  dedication: 'dedication',
  epigraph: 'epigraph',
  preface: 'preface',
  foreword: 'preface',
  introduction: 'preface',
};

/**
 * 标题关键词。标题先经过 normalizeTitle：转小写、去掉首尾的符号和序号、中文去掉空格。
 * 每条都是整个标题的匹配（^…$）。遇到新写法加在这里
 */
const TITLE_RULES: [Region, RegExp][] = [
  ['cover', /^(cover( page| image)?|front cover|封面)$/],
  ['titlepage', /^(title page|half title|书名页|扉页|标题页)$/],
  ['copyright', /^(copyright( page| information| notice)?|版权(页|信息|声明|所有)?|图书在版编目.*)$/],
  ['toc', /^(contents|table of contents|目录|目次)$/],
  ['praise', /^(praise( for .*)?|advance praise( for .*)?|赞誉|各方赞誉|推荐语|媒体推荐|名人推荐|好评推荐)$/],
  ['also-by', /^(also by .*|by the same author|other books by .*|books by .*|作者其他作品|同作者作品)$/],
  ['about-author', /^(about the (authors?|translators?)|作者简介|作者介绍|关于作者|译者简介|作者及译者简介|作译者简介)$/],
  ['translator', /^(译者序|译序|译者前言|译后记|译者后记|译者的话|出版说明|出版者的话|编者按|编者的话|推荐序.*|中文版序.*|中译本序.*|导读.*)$/],
  ['preface', /^(preface|foreword|introduction|afterword|author'?s note|a note on .*|前言|序言|序|自序|引言|导论|绪论|导言|后记)$/],
  ['dedication', /^(dedication|献词|题献)$/],
  ['epigraph', /^(epigraph|题记|引语)$/],
  ['acknowledgments', /^(acknowledge?ments?|致谢|鸣谢|谢辞)$/],
  ['notes', /^(notes?|endnotes|footnotes|notes (and|&) sources|sources (and|&) notes|注释|注|尾注|注解)$/],
  ['bibliography', /^(bibliography|selected bibliography|references|works cited|further reading|sources|illustration credits|picture credits|参考文献|参考书目|延伸阅读|推荐阅读|图片来源)$/],
  ['index', /^(index|general index|索引)$/],
]; // prettier-ignore

const CJK = /\p{Script=Han}/u;

/** "  PRAISE FOR  Piranesi:" → "praise for piranesi"；"目 录" → "目录" */
export function normalizeTitle(title: string): string {
  let t = title.toLowerCase().replace(/\s+/g, ' ');
  // 去掉首尾的标点、符号；英文的 ’ 也统一成 '
  t = t.replace(/[’‘]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (CJK.test(t)) t = t.replace(/ /g, '');
  return t;
}

export function regionOfTitle(title: string): Region | null {
  const t = normalizeTitle(title);
  if (t === '') return null;
  for (const [region, re] of TITLE_RULES) if (re.test(t)) return region;
  return null;
}

function regionOfTypes(types: string[]): string | null {
  for (const type of types) {
    const word = type.startsWith('doc-') ? type.slice(4) : type;
    if (SEMANTIC_TYPES[word] !== undefined) return word;
  }
  return null;
}

// ---- 内容特征 ----

/** 版权页的特征，文件短并且命中两条以上才算 */
const COPYRIGHT_SIGNS: [string, RegExp][] = [
  ['ISBN', /ISBN/i],
  ['©', /©|\(c\)\s*\d{4}|copyright\s+(©\s*)?\d{4}/i],
  ['all rights reserved', /all rights reserved/i],
  ['版权所有', /版权所有/],
  ['CIP', /CIP|在版编目/],
  ['定价', /定\s*价/],
];
const COPYRIGHT_MAX_CHARS = 5000;

/** 注释：以序号开头，如 "1. Darwin, Origin, 45."、"[12] 见……"、"3 See…" */
const NOTE_LINE = /^(\[\d{1,3}\]|［\d{1,3}］|〔\d{1,3}〕|\d{1,3}[.、．)）]?\s)/;
/**
 * 索引：以"逗号 + 页码"结尾，如 "fossils, 12, 45–48"、"化石，12"。
 * 要求逗号，免得把目录页的 "Chapter 3" 也当成索引
 */
const INDEX_LINE = /[,，]\s*\d{1,4}([–—-]\d{1,4})?\.?$/;

function share(blocks: RawBlock[], test: (b: RawBlock) => boolean): number {
  return blocks.length === 0 ? 0 : blocks.filter(test).length / blocks.length;
}

function regionOfContent(blocks: RawBlock[]): RegionResult | null {
  const textBlocks = blocks.filter((b) => b.text !== '');
  const all = textBlocks.map((b) => b.text).join('\n');
  if (all.length <= COPYRIGHT_MAX_CHARS) {
    const hits = COPYRIGHT_SIGNS.filter(([, re]) => re.test(all)).map(([name]) => name);
    if (hits.length >= 2) return { region: 'copyright', reason: `content: ${hits.join(', ')}` };
  }
  // 后面几条要有足够多的块才有统计意义
  if (textBlocks.length < 10) return null;
  const notes = share(textBlocks, (b) => NOTE_LINE.test(b.text));
  if (notes >= 0.5) return { region: 'notes', reason: `content: ${pct(notes)} numbered lines` };
  const index = share(textBlocks, (b) => b.text.length < 300 && INDEX_LINE.test(b.text));
  if (index >= 0.6)
    return { region: 'index', reason: `content: ${pct(index)} end with page numbers` };
  const links = share(textBlocks, (b) => b.hasLink && b.text.length < 100);
  if (links >= 0.7) return { region: 'toc', reason: `content: ${pct(links)} short links` };
  return null;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/** 文件里第一个标题；没有标题时用第一个不长的文字块 */
function firstTitle(blocks: RawBlock[]): string | null {
  const heading = blocks.find((b) => b.kind === 'heading');
  if (heading !== undefined) return heading.text;
  const first = blocks.find((b) => b.text !== '');
  return first !== undefined && first.text.length <= 40 ? first.text : null;
}

export function classifyFile(facts: FileFacts): RegionResult {
  const type = regionOfTypes(facts.rootTypes);
  if (type !== null) return { region: SEMANTIC_TYPES[type] ?? 'body', reason: `epub:type=${type}` };

  if (facts.tocTitle !== null) {
    const region = regionOfTitle(facts.tocTitle);
    if (region !== null) return { region, reason: `toc title: ${facts.tocTitle}` };
  }

  const title = firstTitle(facts.blocks);
  if (title !== null) {
    const region = regionOfTitle(title);
    if (region !== null) return { region, reason: `first heading: ${title}` };
  }

  const content = regionOfContent(facts.blocks);
  if (content !== null) return content;

  if (!facts.linear) return { region: 'auxiliary', reason: 'linear=no' };
  return { region: 'body', reason: '' };
}
