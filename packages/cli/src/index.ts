import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  CORE_VERSION,
  checkLanguagePair,
  detectLanguage,
  extractBlocks,
  parseEpub,
  type Block,
  type Book,
  type BookLanguage,
  type TocEntry,
} from '@epubmerger/core';

const USAGE = `Usage:
  pnpm cli merge <en.epub> <zh.epub> -o <out.epub>
  pnpm cli inspect <book.epub>
  pnpm cli blocks <book.epub> [--text]
  pnpm cli lang <a.epub> [b.epub]`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', short: 'o' },
    version: { type: 'boolean', short: 'v' },
    text: { type: 'boolean' },
  },
});

if (values.version) {
  console.log(`epubmerger core ${CORE_VERSION}`);
  process.exit(0);
}

const [command, ...args] = positionals;

if (command === 'inspect' && args.length === 1 && args[0]) {
  process.exit(inspect(args[0]));
}

if (command === 'blocks' && args.length === 1 && args[0]) {
  process.exit(blocks(args[0], values.text === true));
}

if (command === 'lang' && (args.length === 1 || args.length === 2)) {
  process.exit(lang(args));
}

const [enPath, zhPath] = args;
if (command !== 'merge' || !enPath || !zhPath || !values.output) {
  console.error(USAGE);
  process.exit(1);
}

console.log(`merge ${enPath} + ${zhPath} -> ${values.output} (not implemented yet)`);

/** 打印一本书的解析结果，返回退出码：0 成功，1 失败 */
function inspect(path: string): number {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) {
    console.log(`✗ ${result.error.code}：${result.error.message}`);
    return 1;
  }
  const { book, warnings } = result;
  console.log(describeBook(book));
  console.log(
    warnings.length === 0
      ? '警告：无'
      : ['警告：', ...warnings.map((w) => `  ${w.code}：${w.message}`)].join('\n'),
  );
  return 0;
}

/** 打印每本书的语言判定和统计；两本时再打印组合检查，返回退出码：有错误时 1 */
function lang(paths: string[]): number {
  const languages: BookLanguage[] = [];
  for (const [i, path] of paths.entries()) {
    const result = parseEpub(readFileSync(path));
    if (!result.ok) {
      console.log(`✗ ${path}：${result.error.code}：${result.error.message}`);
      return 1;
    }
    const start = performance.now();
    const { language, stats } = detectLanguage(extractBlocks(result.book).blocks);
    const ms = performance.now() - start;
    languages.push(language);
    const voted = Object.values(stats.languages).reduce((n, x) => n + x, 0);
    const share = (n: number) => `${((100 * n) / Math.max(1, voted)).toFixed(1)}%`;
    console.log(`${paths.length === 2 ? `[${'ab'[i]}] ` : ''}${path}`);
    console.log(
      `  判定：${language.kind === 'single' ? language.lang : '不确定'}（${ms.toFixed(0)} ms，不算解析和抽取）`,
    );
    const ranked = Object.entries(stats.languages).sort((x, y) => y[1] - x[1]);
    console.log(
      `  投票：${ranked.map(([l, n]) => `${l} ${Math.round(n)} 段（${share(n)}）`).join('，') || '无'}`,
    );
    const p = stats.paragraphs;
    console.log(
      `  段落：${Object.entries(p)
        .filter(([, n]) => n > 0)
        .map(([c, n]) => `${c}=${n}`)
        .join(' ')}`,
    );
    console.log(`  繁简专用字：繁 ${stats.variants.traditional}，简 ${stats.variants.simplified}`);
    for (const [script, votes] of Object.entries(stats.samples)) {
      console.log(
        `  franc 抽样（${script}）：${Object.entries(votes)
          .map(([l, n]) => `${l}=${n}`)
          .join(' ')}`,
      );
    }
  }
  const [a, b] = languages;
  if (a === undefined || b === undefined) return 0;
  const check = checkLanguagePair(a, b);
  if (check.issues.length === 0) console.log('组合检查：✓ 通过');
  for (const issue of check.issues) {
    const mark = issue.level === 'error' ? '✗' : '⚠';
    const book = issue.bookSide === 'both' ? '两本' : issue.bookSide;
    console.log(`组合检查：${mark} ${issue.code}（${book}${issue.lang ? `：${issue.lang}` : ''}）`);
  }
  return check.ok ? 0 : 1;
}

function describeBook(book: Book): string {
  const { metadata } = book;
  const nonLinear = book.spine.filter((item) => !item.linear).length;
  return [
    `书名：${metadata.title || '（无）'}`,
    `作者：${metadata.creators.join('、') || '（无）'}`,
    `语言（OPF 声明）：${metadata.languages.join(', ') || '（无）'}`,
    `ePub 版本：${book.version} · OPF：${book.opfPath}`,
    `spine：${book.spine.length} 个文件（其中 linear=no：${nonLinear} 个）`,
    `目录：${countEntries(book.toc)} 项，来源 ${book.tocSource}`,
    ...tocLines(book.toc, 1),
  ].join('\n');
}

function tocLines(entries: TocEntry[], depth: number): string[] {
  return entries.flatMap((entry) => [
    `${'  '.repeat(depth)}${entry.title || '（空标题）'}`,
    ...tocLines(entry.children, depth + 1),
  ]);
}

/** 打印正文抽取的结果：每个文件的 region，每个目录项下的段数；withText 时逐块打印开头 */
function blocks(path: string, withText: boolean): number {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) {
    console.log(`✗ ${result.error.code}：${result.error.message}`);
    return 1;
  }
  const { book } = result;
  const { blocks: all, files } = extractBlocks(book);
  const body = all.filter((b) => b.region === 'body');
  console.log(`共 ${all.length} 块，其中正文 ${body.length} 块、${chars(body)} 字`);

  console.log('\n按文件：region（判断依据）· 块数 · 字数');
  for (const f of files) {
    const inFile = all.filter((b) => b.file === f.href);
    const why = f.reason === '' ? '' : `（${f.reason}）`;
    const notes = inFile.filter((b) => b.region === 'notes' && f.region !== 'notes').length;
    const extra = notes > 0 ? ` · 其中脚注 ${notes} 块` : '';
    console.log(`  ${f.href}  ${f.region}${why} · ${f.blockCount} · ${chars(inFile)}${extra}`);
  }

  console.log('\n按目录项（只数正文）：块数 · 字数');
  const entries = flattenToc(book.toc, 0);
  const starts = entries.map(({ entry }) => tocStart(book, all, entry));
  entries.forEach(({ entry, depth }, i) => {
    const start = starts[i] ?? all.length;
    const end = Math.max(start, starts[i + 1] ?? all.length);
    const inEntry = all.slice(start, end).filter((b) => b.region === 'body');
    const title = entry.title || '（空标题）';
    console.log(`${'  '.repeat(depth + 1)}${title} · ${inEntry.length} · ${chars(inEntry)}`);
  });

  if (withText) {
    console.log('\n逐块：序号 kind region 开头');
    all.forEach((b, i) => {
      const head = b.text.replace(/\n/g, ' / ').slice(0, 40);
      console.log(`${String(i).padStart(5)} ${b.kind.padEnd(7)} ${b.region.padEnd(10)} ${head}`);
    });
  }
  return 0;
}

/** 字数：去掉空白后的字符数 */
function chars(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + b.text.replace(/\s/g, '').length, 0);
}

function flattenToc(entries: TocEntry[], depth: number): { entry: TocEntry; depth: number }[] {
  return entries.flatMap((entry) => [{ entry, depth }, ...flattenToc(entry.children, depth + 1)]);
}

/**
 * 目录项从第几块开始：同一文件里 ids 含锚点的块；找不到锚点就是这个文件的第一块；
 * 文件没有块就是后面第一个有块的文件的第一块
 */
function tocStart(book: Book, all: Block[], entry: TocEntry): number {
  if (entry.fragment !== null) {
    const fragment = entry.fragment;
    const i = all.findIndex((b) => b.file === entry.href && b.ids.includes(fragment));
    if (i >= 0) return i;
  }
  const spineIndex = new Map(book.spine.map((item, i) => [item.href, i]));
  const target = spineIndex.get(entry.href);
  if (target === undefined) return all.length;
  const i = all.findIndex((b) => (spineIndex.get(b.file) ?? -1) >= target);
  return i < 0 ? all.length : i;
}

function countEntries(entries: TocEntry[]): number {
  return entries.reduce((n, e) => n + 1 + countEntries(e.children), 0);
}
