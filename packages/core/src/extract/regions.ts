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
 * 标题关键词。标题先经过 normalizeTitle：转小写、去掉首尾的符号和序号、汉字标题去掉空格。
 * 每个词都是整个标题的匹配（^…$），词里可以写正则。遇到新写法加在这里。
 * 韩文词之间的空格可有可无（'저자 ?소개'）。每种语言一行。序章、Prologue、Epilogue 这类在小说里通常是正文的词不收
 */
const TITLE_WORDS: [Region, string[]][] = [
  ['cover', [
    'cover( page| image)?', 'front cover', // en
    '封面', // zh
    '表紙', // ja
    '표지', // ko
    'couverture', 'umschlag', 'portada', 'cubierta', 'copertina', 'capa', // fr de es it pt
    'обложка', // ru
  ]],
  ['titlepage', [
    'title page', 'half title',
    '书名页', '扉页', '标题页', '書名頁', '扉頁',
    'タイトルページ',
    '속표지',
    'page de titre', 'titelseite', 'titelblatt', 'portadilla', 'frontespizio', 'folha de rosto',
    'титульный лист',
  ]],
  ['copyright', [
    'copyright( page| information| notice)?',
    '版权(页|信息|声明|所有)?', '图书在版编目.*', '版權(頁|資訊|聲明|所有)?',
    '奥付', '著作権', '版権',
    '판권(면)?', '저작권',
    "droits d'auteur", 'mentions légales', 'impressum', 'derechos de autor', "diritti d'autore", 'direitos autorais', 'ficha técnica',
    'авторские права', 'выходные данные',
  ]],
  ['toc', [
    'contents', 'table of contents',
    '目录', '目次', '目錄',
    'もくじ',
    '차례', '목차',
    'table des matières', 'sommaire', 'inhalt', 'inhaltsverzeichnis', 'índice', 'contenidos?', 'indice', 'sommario', 'sumário', 'conteúdo',
    'содержание', 'оглавление',
  ]],
  ['praise', [
    'praise( for .*)?', 'advance praise( for .*)?',
    '赞誉', '各方赞誉', '推荐语', '媒体推荐', '名人推荐', '好评推荐', '讚譽', '各方讚譽', '推薦語', '媒體推薦', '名人推薦', '好評推薦',
    'pressestimmen', 'elogios',
  ]],
  ['also-by', [
    'also by .*', 'by the same author', 'other books by .*', 'books by .*',
    '作者其他作品', '同作者作品',
    'du même auteur', 'vom selben autor', 'weitere bücher von .*', 'del mismo autor', 'otras obras de .*', 'dello stesso autore', 'altre opere di .*', 'do mesmo autor', 'outras obras de .*',
  ]],
  ['about-author', [
    'about the (authors?|translators?)',
    '作者简介', '作者介绍', '关于作者', '译者简介', '作者及译者简介', '作译者简介', '作者簡介', '作者介紹', '關於作者', '譯者簡介',
    '著者紹介', '著者略歴', '作者紹介', '訳者紹介', '訳者略歴',
    '(저자|지은이|옮긴이|역자) ?소개',
    "à propos de l'auteur", "l'auteur", 'über den autor', 'über die autorin', 'zum autor', 'zur autorin', 'sobre el autor', 'sobre la autora', 'acerca del autor', "l'autore", "nota sull'autore", 'sobre o autor', 'sobre a autora',
    'об авторе',
  ]],
  ['translator', [
    '译者序', '译序', '译者前言', '译后记', '译者后记', '译者的话', '出版说明', '出版者的话', '编者按', '编者的话', '推荐序.*', '中文版序.*', '中译本序.*', '导读.*',
    '譯者序', '譯序', '譯者前言', '譯後記', '譯者後記', '譯者的話', '出版說明', '編者按', '編者的話', '推薦序.*', '中譯本序.*', '導讀.*',
    '訳者あとがき', '訳者解説', '解説',
    '옮긴이의 ?말', '역자 ?후기', '역자의 ?말', '해설',
    'note du traducteur', 'préface du traducteur', 'nachwort des übersetzers', 'anmerkung des übersetzers', 'nota del traductor', 'nota del traduttore', 'nota do tradutor',
    'от переводчика',
  ]],
  ['preface', [
    'preface', 'foreword', 'introduction', 'afterword', "author'?s note", 'a note on .*',
    '前言', '序言', '序', '自序', '引言', '导论', '绪论', '导言', '后记', '導論', '緒論', '導言', '後記',
    'まえがき', 'はじめに', '序文', 'あとがき',
    '서문', '머리말', '들어가며', '서론', '후기',
    'préface', 'avant-propos', 'postface', 'vorwort', 'einleitung', 'einführung', 'nachwort', 'prefacio', 'introducción', 'nota del autor', 'prefazione', 'introduzione', 'premessa', 'postfazione', "nota dell'autore", 'prefácio', 'introdução', 'apresentação', 'posfácio', 'nota do autor',
    'предисловие', 'введение', 'послесловие', 'от автора',
  ]],
  ['dedication', [
    'dedication',
    '献词', '题献', '獻詞', '題獻',
    '献辞',
    '헌사',
    'dédicace', 'widmung', 'dedicatoria', 'dedica', 'dedicatória',
    'посвящение',
  ]],
  ['epigraph', [
    'epigraph',
    '题记', '引语', '題記', '引語',
    '題辞', 'エピグラフ',
    'épigraphe', 'exergue', 'motto', 'epígrafe', 'epigrafe',
    'эпиграф',
  ]],
  ['acknowledgments', [
    'acknowledge?ments?',
    '致谢', '鸣谢', '谢辞', '致謝', '鳴謝', '謝辭',
    '謝辞',
    '감사의 ?(말|글)',
    'remerciements', 'danksagung', 'dank', 'agradecimientos', 'ringraziamenti', 'agradecimentos',
    'благодарности',
  ]],
  ['notes', [
    'notes?', 'endnotes', 'footnotes', 'notes (and|&) sources', 'sources (and|&) notes',
    '注释', '注', '尾注', '注解', '註釋', '注釋', '註', '尾註', '註解',
    '原注', '訳注', '脚注',
    '주', '주석', '미주',
    'anmerkungen', 'fußnoten', 'endnoten', 'notas', 'note',
    'примечания', 'комментарии',
  ]],
  ['bibliography', [
    'bibliography', 'selected bibliography', 'references', 'works cited', 'further reading', 'sources', 'illustration credits', 'picture credits',
    '参考文献', '参考书目', '延伸阅读', '推荐阅读', '图片来源', '參考文獻', '參考書目', '延伸閱讀', '推薦閱讀', '圖片來源',
    '引用文献', '文献',
    '참고 ?문헌',
    'bibliographie', 'références', 'literaturverzeichnis', 'bibliografie', 'quellen', 'literatur', 'bibliografía', 'referencias', 'fuentes', 'bibliografia', 'riferimenti bibliografici', 'fonti', 'referências', 'fontes',
    'библиография', 'литература', 'список литературы', 'источники',
  ]],
  ['index', [
    'index', 'general index',
    '索引',
    '찾아보기', '색인',
    'index des noms', 'register', 'personenregister', 'sachregister', 'namensregister', 'índice (alfabético|analítico|onomástico)', 'indice (analitico|dei nomi)', 'índice (remissivo|onomástico)',
    '(предметный |именной )?указатель',
  ]],
]; // prettier-ignore

// PURE：告诉打包工具这个调用没有副作用。主页面只从 core 拿 checkLanguagePair，
// 没有这个标记，这张词表会被一起打包进主页面
const TITLE_RULES: [Region, RegExp][] = /* @__PURE__ */ TITLE_WORDS.map(([region, words]) => [
  region,
  new RegExp(`^(${words.join('|')})$`),
]);

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
  [
    'all rights reserved',
    /all rights reserved|tous droits réservés|alle rechte vorbehalten|todos los derechos reservados|tutti i diritti riservati|todos os direitos reservados|все права защищены/i,
  ],
  ['版权所有', /版权所有|版權所有|無断(転載|複製|複写)|무단 ?(전재|복제)/],
  ['CIP', /CIP|在版编目|在版編目/],
  ['定价', /定\s*[价價]/],
  ['dépôt légal', /dépôt légal|depósito legal/i],
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
