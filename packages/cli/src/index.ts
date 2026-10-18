import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  alignBook,
  generateBilingual,
  toBlockPairs,
  CHAPTER_THRESHOLD,
  CORE_VERSION,
  chapterSections,
  checkLanguagePair,
  detectLanguage,
  extractBlocks,
  parseEpub,
  prefillChapters,
  splitChapters,
  validateChapterMap,
  withTitles,
  type Block,
  type Book,
  type ParseWarning,
  type BookLanguage,
  type ChapterMap,
  type ChapterResult,
  type Section,
  type TocEntry,
} from '@epubmerger/core';
import { loadE5 } from './embed.ts';

const USAGE = `Usage:
  pnpm cli merge <en.epub> <zh.epub> -o <out.epub> [--map <file>] [--skeleton en|zh] [--first en|zh] [--layout stacked|columns] [--length]
  pnpm cli inspect <book.epub>
  pnpm cli blocks <book.epub> [--text]
  pnpm cli chapters <book.epub> [--ignore-toc]
  pnpm cli chapters <en.epub> <zh.epub> [--map <file>] [--prefill meaning|order] [--threshold ${CHAPTER_THRESHOLD}]
  pnpm cli lang <a.epub> [b.epub]
  pnpm cli align <en.epub> <zh.epub> [--map <file>] [--length]`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', short: 'o' },
    version: { type: 'boolean', short: 'v' },
    text: { type: 'boolean' },
    'ignore-toc': { type: 'boolean' },
    map: { type: 'string' },
    prefill: { type: 'string', default: 'meaning' },
    threshold: { type: 'string', default: String(CHAPTER_THRESHOLD) },
    length: { type: 'boolean' },
    skeleton: { type: 'string', default: 'en' },
    first: { type: 'string' },
    layout: { type: 'string', default: 'stacked' },
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

if (command === 'chapters' && args.length === 1 && args[0]) {
  process.exit(chapters(args[0], values['ignore-toc'] === true));
}

if (
  command === 'chapters' &&
  args.length === 2 &&
  args[0] &&
  args[1] &&
  (values.prefill === 'meaning' || values.prefill === 'order')
) {
  process.exit(await chapterMap(args[0], args[1], values.prefill));
}

if (command === 'lang' && (args.length === 1 || args.length === 2)) {
  process.exit(lang(args));
}

if (command === 'align' && args.length === 2 && args[0] && args[1]) {
  process.exit(await alignCommand(args[0], args[1], values.length === true));
}

const [enPath, zhPath] = args;
const skeleton = values.skeleton;
const first = values.first ?? skeleton;
const layout = values.layout;
if (
  command !== 'merge' ||
  !enPath ||
  !zhPath ||
  !values.output ||
  (skeleton !== 'en' && skeleton !== 'zh') ||
  (first !== 'en' && first !== 'zh') ||
  (layout !== 'stacked' && layout !== 'columns')
) {
  console.error(USAGE);
  process.exit(1);
}

process.exit(
  await merge(enPath, zhPath, values.output, {
    skeleton,
    otherFirst: first !== skeleton,
    layout,
    lengthOnly: values.length === true,
  }),
);

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

  console.log('\n按章节（只数正文）：块数 · 字数');
  printChapters(splitChapters(book, all), all);

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

/** 打印切章节的结果：切法、警告、目录的几个数字，每节的块数、字数；ignoreToc 时假装没有目录 */
function chapters(path: string, ignoreToc: boolean): number {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) {
    console.log(`✗ ${result.error.code}：${result.error.message}`);
    return 1;
  }
  const book = ignoreToc ? { ...result.book, toc: [] } : result.book;
  const all = extractBlocks(book).blocks;
  printChapters(splitChapters(book, all), all);
  return 0;
}

function printChapters(result: ChapterResult, all: Block[]): void {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`切法：${result.source}，共 ${result.chapters.length} 节`);
  for (const w of result.warnings) console.log(`⚠ ${w.code}：${w.message}`);
  const st = result.tocStats;
  if (st !== null) {
    console.log(
      `目录：${st.entries} 项 · 指向 spine 以外 ${pct(st.unresolvedShare)} · ` +
        `目录前 ${pct(st.beforeTocShare)} · 最大一节 ${pct(st.largestShare)}`,
    );
  }
  for (const c of result.chapters) {
    const inChapter = all.slice(c.start, c.end).filter((b) => b.region === 'body');
    const title = c.beforeToc ? '（目录前）' : c.title || '（空标题）';
    console.log(`${'  '.repeat(c.depth + 1)}${title} · ${inChapter.length} · ${chars(inChapter)}`);
  }
}

/** 读一本书，按 splitChapters 切节，每节只留参与配对的块；解析失败时返回错误码 */
function readSections(path: string): Section[] | string {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) return `${result.error.code}：${result.error.message}`;
  const all = extractBlocks(result.book).blocks;
  return chapterSections(splitChapters(result.book, all), all);
}

/**
 * 两本书的章节表：文件已有就读进来检查；没有就预填一份写进去（不覆盖已有的文件）。
 * 并排打印，返回退出码：读不了书或表有问题时 1
 */
async function chapterMap(
  enPath: string,
  zhPath: string,
  method: 'meaning' | 'order',
): Promise<number> {
  const en = readSections(enPath);
  const zh = readSections(zhPath);
  if (typeof en === 'string' || typeof zh === 'string') {
    if (typeof en === 'string') console.log(`✗ ${enPath}：${en}`);
    if (typeof zh === 'string') console.log(`✗ ${zhPath}：${zh}`);
    return 1;
  }
  const path = values.map ?? join(dirname(enPath), 'chapters.json');
  let map: ChapterMap;
  if (existsSync(path)) {
    map = JSON.parse(readFileSync(path, 'utf8')) as ChapterMap;
    console.log(`读取：${path}`);
  } else {
    const start = performance.now();
    const embedder = method === 'meaning' ? await loadE5() : undefined;
    const result = await prefillChapters(en, zh, { embedder, threshold: Number(values.threshold) });
    map = { groups: withTitles(result.groups, en, zh) };
    writeFileSync(path, JSON.stringify(map, null, 2) + '\n');
    const how = result.method === 'meaning' ? '按意思' : '按顺序';
    console.log(`已预填（${how}，${((performance.now() - start) / 1000).toFixed(1)} 秒）：${path}`);
  }
  console.log(`英文 ${en.length} 节，中文 ${zh.length} 节，共 ${map.groups.length} 组\n`);
  console.log(formatMap(map, en, zh));
  const problems = validateChapterMap(map.groups, en.length, zh.length);
  if (problems.length > 0) {
    console.log(`\n✗ 章节表有问题：\n  ${problems.join('\n  ')}`);
    return 1;
  }
  console.log('\n✓ 章节表检查通过');
  return 0;
}

/**
 * 按确认过的章节表逐组配段落，打印每组配成几对、几段没有对应。
 * lengthOnly 时不加载模型，只按长度配。返回退出码：读不了书或章节表有问题时 1
 */
async function alignCommand(enPath: string, zhPath: string, lengthOnly: boolean): Promise<number> {
  const en = readSections(enPath);
  const zh = readSections(zhPath);
  if (typeof en === 'string' || typeof zh === 'string') {
    if (typeof en === 'string') console.log(`✗ ${enPath}：${en}`);
    if (typeof zh === 'string') console.log(`✗ ${zhPath}：${zh}`);
    return 1;
  }
  const path = values.map ?? join(dirname(enPath), 'chapters.json');
  if (!existsSync(path)) {
    console.log(`✗ 没有章节表 ${path}，先运行 pnpm cli chapters <en.epub> <zh.epub>`);
    return 1;
  }
  const map = JSON.parse(readFileSync(path, 'utf8')) as ChapterMap;
  const problems = validateChapterMap(map.groups, en.length, zh.length);
  if (problems.length > 0) {
    console.log(`✗ 章节表有问题：\n  ${problems.join('\n  ')}`);
    return 1;
  }

  const start = performance.now();
  const embedder = lengthOnly ? undefined : await loadE5();
  const aligned = await alignBook(map.groups, en, zh, { embedder });
  const total = { pairs: 0, enOnly: 0, zhOnly: 0 };
  for (const g of aligned.groups) {
    const pairs = g.pairs.filter((p) => p.en.length > 0 && p.zh.length > 0).length;
    const enOnly = g.pairs.filter((p) => p.zh.length === 0).length;
    const zhOnly = g.pairs.filter((p) => p.en.length === 0).length;
    total.pairs += pairs;
    total.enOnly += enOnly;
    total.zhOnly += zhOnly;
    const group = map.groups[g.index]!;
    const titles = (ids: number[], sections: Section[]) =>
      ids.map((i) => sections[i]!.title).join(' + ');
    console.log(
      `[${g.index}] ${titles(group.en, en)} ↔ ${titles(group.zh, zh)}：英 ${g.en.length} 段、中 ${g.zh.length} 段，` +
        `配成 ${pairs} 对，英文没对应 ${enOnly}，中文没对应 ${zhOnly}`,
    );
  }
  const how = aligned.method === 'combined' ? '长度 + 意思' : '只按长度';
  console.log(
    `\n共配成 ${total.pairs} 对，英文没对应 ${total.enOnly} 段，中文没对应 ${total.zhOnly} 段` +
      `（${how}，${((performance.now() - start) / 1000).toFixed(1)} 秒）`,
  );
  return 0;
}

/** 把章节表并排打印出来：每组左英右中，附上段数、字数和开头预览 */
function formatMap(map: ChapterMap, en: Section[], zh: Section[]): string {
  const lines: string[] = [];
  const describe = (sections: Section[], ids: number[], side: 'en' | 'zh') => {
    if (ids.length === 0) return ['    （不合并）'];
    const blocks = ids.flatMap((i) => sections[i]!.blocks);
    const titles = ids.map((i) => `${'  '.repeat(sections[i]!.depth)}[${i}] ${sections[i]!.title}`);
    return [
      ...titles.map((t) => `    ${t}`),
      `    ${blocks.length} 段 · ${chars(blocks)} 字`,
      `    ${preview(blocks, side)}`,
    ];
  };
  map.groups.forEach((g, k) => {
    lines.push(
      `── 第 ${k} 组`,
      '  EN',
      ...describe(en, g.en, 'en'),
      '  ZH',
      ...describe(zh, g.zh, 'zh'),
    );
  });
  return lines.join('\n');
}

/** 开头约 200 个字：中文按字数，英文按单词数（约 50 个词） */
function preview(blocks: Block[], side: 'en' | 'zh'): string {
  const text = blocks
    .map((b) => b.text)
    .join(' / ')
    .replace(/\s+/g, ' ');
  if (side === 'zh') return text.length > 200 ? text.slice(0, 200) + '…' : text;
  const words = text.split(' ');
  return words.length > 50 ? words.slice(0, 50).join(' ') + ' …' : text;
}

function countEntries(entries: TocEntry[]): number {
  return entries.reduce((n, e) => n + 1 + countEntries(e.children), 0);
}

/** 一本书读进来：书、全部块、章节 */
function loadBook(
  path: string,
): { book: Book; blocks: Block[]; sections: Section[]; warnings: ParseWarning[] } | string {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) return `${result.error.code}：${result.error.message}`;
  const all = extractBlocks(result.book).blocks;
  return {
    book: result.book,
    blocks: all,
    sections: chapterSections(splitChapters(result.book, all), all),
    warnings: result.warnings,
  };
}

/** 生成双语 ePub，写出后读回检查。返回退出码：0 成功，1 失败 */
async function merge(
  enPath: string,
  zhPath: string,
  outPath: string,
  options: {
    skeleton: 'en' | 'zh';
    otherFirst: boolean;
    layout: 'stacked' | 'columns';
    lengthOnly: boolean;
  },
): Promise<number> {
  const start = performance.now();
  const en = loadBook(enPath);
  const zh = loadBook(zhPath);
  if (typeof en === 'string' || typeof zh === 'string') {
    if (typeof en === 'string') console.log(`✗ ${enPath}：${en}`);
    if (typeof zh === 'string') console.log(`✗ ${zhPath}：${zh}`);
    return 1;
  }

  // 语言：有错误就停下；不确定时按参数位置当成 en / zh-Hans
  const enLang = detectLanguage(en.blocks).language;
  const zhLang = detectLanguage(zh.blocks).language;
  const check = checkLanguagePair(enLang, zhLang);
  for (const issue of check.issues) {
    console.log(`${issue.level === 'error' ? '✗' : '⚠'} 语言：${issue.code}（${issue.bookSide}）`);
  }
  if (!check.ok) return 1;
  const langOf = (l: BookLanguage, fallback: string) => (l.kind === 'single' ? l.lang : fallback);
  const langs = { en: langOf(enLang, 'en'), zh: langOf(zhLang, 'zh-Hans') };

  // 章节表：没有就自动预填（没经过确认）
  const embedder = options.lengthOnly ? undefined : await loadE5();
  const mapPath = values.map ?? join(dirname(enPath), 'chapters.json');
  let map: ChapterMap;
  if (existsSync(mapPath)) {
    map = JSON.parse(readFileSync(mapPath, 'utf8')) as ChapterMap;
    const problems = validateChapterMap(map.groups, en.sections.length, zh.sections.length);
    if (problems.length > 0) {
      console.log(`✗ 章节表有问题：\n  ${problems.join('\n  ')}`);
      return 1;
    }
  } else {
    const result = await prefillChapters(en.sections, zh.sections, { embedder });
    map = { groups: result.groups };
    console.log(
      `⚠ 没有章节表 ${mapPath}，已自动预填（${result.method === 'meaning' ? '按意思' : '按顺序'}），没经过确认`,
    );
  }

  const aligned = await alignBook(map.groups, en.sections, zh.sections, { embedder });
  const alignedAt = performance.now();
  const pairs = toBlockPairs(aligned, options.skeleton);
  const skel = options.skeleton === 'en' ? en : zh;
  const result = generateBilingual({
    skeleton: skel.book,
    skeletonLang: options.skeleton === 'en' ? langs.en : langs.zh,
    otherLang: options.skeleton === 'en' ? langs.zh : langs.en,
    pairs,
    otherFirst: options.otherFirst,
    layout: options.layout,
    title: `${en.book.metadata.title} / ${zh.book.metadata.title}（中英双语）`,
  });
  if (!result.ok) {
    console.log(`✗ 生成失败：${result.message}`);
    return 1;
  }
  const generatedAt = performance.now();
  writeFileSync(outPath, result.bytes);

  const { report } = result;
  const otherCount = pairs.reduce((n, p) => n + p.other.length, 0);
  const secs = (from: number, to: number) => ((to - from) / 1000).toFixed(1);
  console.log(
    `✓ ${outPath}（${(result.bytes.length / 1024 / 1024).toFixed(1)} MB）\n` +
      `  骨架 ${options.skeleton}，${options.otherFirst ? '另一本在前' : '骨架在前'}，${options.layout === 'columns' ? `两栏（${report.rows} 对包成表格，${report.columnFallbacks} 对退回上下交替）` : '上下交替'}，配对${aligned.method === 'combined' ? '长度 + 意思' : '只按长度'}\n` +
      `  另一本参与配对 ${otherCount} 段：插入 ${report.inserted}，丢掉 ${report.dropped.length}，改了 ${report.changedFiles.length} 个文件\n` +
      `  耗时：读书 + 配对 ${secs(start, alignedAt)} 秒，生成 ${secs(alignedAt, generatedAt)} 秒`,
  );
  for (const d of report.dropped.slice(0, 5)) console.log(`  丢掉（${d.reason}）：${d.text}`);
  if (report.dropped.length > 5) console.log(`  ……共 ${report.dropped.length} 段`);
  for (const w of report.warnings.slice(0, 5)) console.log(`  ⚠ ${w.code}：${w.message}`);
  if (report.warnings.length > 5) console.log(`  ……共 ${report.warnings.length} 条警告`);

  // 插入段落的字数：有段落被丢掉或清理后为空时算不准，不查
  const complete =
    report.dropped.length === 0 && !report.warnings.some((w) => w.code === 'EMPTY_BLOCK');
  const insertedChars = complete ? chars(pairs.flatMap((p) => p.other)) : null;
  const problems = verifyOutput(
    result.bytes,
    skel,
    { count: report.inserted, chars: insertedChars },
    options.layout,
  );
  if (problems.length > 0) {
    console.log(`✗ 读回检查：\n  ${problems.join('\n  ')}`);
    return 1;
  }
  console.log('✓ 读回检查通过');
  return 0;
}

/**
 * 读回检查：输出能被 parseEpub 读出、没有骨架书原来没有的警告；改过的文件里没有新的重复 id；
 * 字数（去掉空白）= 骨架书 + 插入的段落（有段落被丢掉或清理后为空时不查）；
 * 上下交替时再查块数 = 骨架书 + 插入数（两栏时整个表格是一块，不查）。返回发现的问题
 */
function verifyOutput(
  bytes: Uint8Array,
  skeleton: { book: Book; blocks: Block[]; warnings: ParseWarning[] },
  inserted: { count: number; chars: number | null },
  layout: 'stacked' | 'columns',
): string[] {
  const result = parseEpub(bytes);
  if (!result.ok) return [`parseEpub：${result.error.code}：${result.error.message}`];
  const problems: string[] = [];
  const known = new Set(skeleton.warnings.map((w) => w.code));
  for (const w of result.warnings) {
    if (!known.has(w.code)) problems.push(`新警告 ${w.code}：${w.message}`);
  }
  const blocks = extractBlocks(result.book).blocks;
  if (inserted.chars !== null) {
    const expected = chars(skeleton.blocks) + inserted.chars;
    if (chars(blocks) !== expected) problems.push(`字数 ${chars(blocks)}，应该是 ${expected}`);
  }
  if (layout === 'stacked' && blocks.length !== skeleton.blocks.length + inserted.count) {
    problems.push(`块数 ${blocks.length}，应该是 ${skeleton.blocks.length + inserted.count}`);
  }
  for (const item of skeleton.book.spine) {
    const before = duplicateIds(skeleton.book.readText(item.href) ?? '');
    const after = duplicateIds(result.book.readText(item.href) ?? '');
    if (after > before) problems.push(`${item.href}：重复 id ${before} → ${after}`);
  }
  return problems;
}

function duplicateIds(xhtml: string): number {
  const ids = [...xhtml.matchAll(/\sid\s*=\s*["']([^"']*)["']/g)].map((m) => m[1]);
  return ids.length - new Set(ids).size;
}
