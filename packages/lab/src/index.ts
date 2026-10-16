import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { benchBook, benchSummary, formatBench, type BookBench } from './bench.ts';
import {
  bookSections,
  formatMap,
  loadOrCreateMap,
  mapHtml,
  mapPath,
  validate,
} from './chapters.ts';
import { dumpReview, reviewHtml, type Verdict } from './review.ts';
import { chapterTestHtml, predictAll, scoreChapters, sectionVectors } from './chapter-align.ts';
import { withCache } from './cache.ts';
import type { ChapterMap } from './chapters.ts';
import { cosine, isModelKey, loadEmbedder, MODELS, type ModelKey } from './embed.ts';
import {
  alignBook,
  alignGroup,
  disagreements,
  formatSummary,
  paragraphsHtml,
  scoreJudged,
  type AlignOptions,
  type GroupResult,
  type JudgedCase,
} from './paragraphs.ts';

const MODEL_KEYS = Object.keys(MODELS).filter(isModelKey);

const USAGE = `Usage:
  pnpm lab sim [--model ${MODEL_KEYS.join('|')}] <text> <text> [...]
  pnpm lab bench [--model ${MODEL_KEYS.join('|')}|all] <book.epub> [...]
  pnpm lab chapters <en.epub> <zh.epub> [--html]
  pnpm lab paragraphs [--model ${MODEL_KEYS.join('|')}] [--threshold 0.75] [--lambda 200] <en.epub> <zh.epub>
  pnpm lab compare [--threshold 0.75] [--lambdas 20,50,100] <pair-dir> [...]
  pnpm lab chapter-test [--thresholds 0.75,0.8,0.85] [--lambdas 20,50,100] <pair-dir> [...]`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: 'string', short: 'm', default: 'e5' },
    html: { type: 'boolean' },
    threshold: { type: 'string', default: '0.75' },
    lambda: { type: 'string', default: '200' },
    lambdas: { type: 'string', default: '20,50,100' },
    verbose: { type: 'boolean' },
    dump: { type: 'boolean' },
    review: { type: 'boolean' },
    thresholds: { type: 'string', default: '0.75,0.8,0.85' },
  },
});

const [command, ...args] = positionals;
const model = values.model;

if (command === 'bench' && args.length >= 1 && (model === 'all' || isModelKey(model))) {
  const models = model === 'all' ? MODEL_KEYS : [model];
  const results: BookBench[] = [];
  for (const m of models) {
    for (const book of args) {
      const r = await benchBook(book, m);
      console.log(formatBench(r) + '\n');
      results.push(r);
    }
  }
  console.log(benchSummary(results));
} else if (command === 'chapters' && args.length === 2 && args[0] && args[1]) {
  process.exit(chapters(args[0], args[1], values.html === true));
} else if (
  command === 'paragraphs' &&
  args.length === 2 &&
  args[0] &&
  args[1] &&
  isModelKey(model)
) {
  await paragraphs(args[0], args[1], model, alignOptions());
} else if (command === 'compare' && args.length >= 1 && isModelKey(model)) {
  await compare(args, model);
} else if (command === 'chapter-test' && args.length >= 1 && isModelKey(model)) {
  await chapterTest(args, model);
} else if (!isModelKey(model)) {
  console.error(`unknown model: ${model}\n${USAGE}`);
  process.exit(1);
} else if (command === 'sim' && args.length >= 2) {
  await sim(model, args);
} else {
  console.error(USAGE);
  process.exit(1);
}

/**
 * 读（或按顺序预填）章节对照表，检查后并排打印；html 时改为在书对的文件夹里写 chapters.html。
 * 返回退出码：表有问题时为 1
 */
function chapters(enPath: string, zhPath: string, html: boolean): number {
  const en = bookSections(enPath);
  const zh = bookSections(zhPath);
  const existed = existsSync(mapPath(enPath));
  const map = loadOrCreateMap(enPath, en, zh);
  console.log(`${existed ? '读取' : '已生成草稿'}：${mapPath(enPath)}`);
  console.log(`英文 ${en.length} 节，中文 ${zh.length} 节，共 ${map.groups.length} 组\n`);
  const problems = validate(map.groups, en.length, zh.length);
  if (html) {
    const out = join(dirname(enPath), 'chapters.html');
    writeFileSync(out, mapHtml(basename(dirname(enPath)), map, en, zh, problems));
    console.log(`网页版：${out}`);
  } else {
    console.log(formatMap(map, en, zh));
  }
  if (problems.length > 0) {
    console.log(`\n✗ 对照表有问题：\n  ${problems.join('\n  ')}`);
    return 1;
  }
  return 0;
}

/**
 * 按章节表在每组里配段落（按长度、按意思各一次），打印统计；
 * 在书对的文件夹里写 paragraphs.html（给人看）和 disagreements.txt（两种方法不一致的地方）
 */
async function paragraphs(
  enPath: string,
  zhPath: string,
  key: ModelKey,
  options: AlignOptions,
): Promise<void> {
  const groups = await alignBook(enPath, zhPath, key, options);
  console.log(formatSummary(groups));
  const dir = dirname(enPath);
  writeFileSync(join(dir, 'paragraphs.html'), paragraphsHtml(basename(dir), groups, options));
  writeFileSync(join(dir, 'disagreements.txt'), disagreements(groups) + '\n');
  if (values.dump) {
    writeFileSync(join(dir, 'review.txt'), dumpReview(groups) + '\n');
    console.log(`黄色行：${join(dir, 'review.txt')}`);
  }
  if (values.review) {
    const path = join(dir, 'verdicts.json');
    const verdicts = existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as { verdicts: Verdict[] }).verdicts
      : [];
    writeFileSync(join(dir, 'review.html'), reviewHtml(basename(dir), groups, verdicts, options));
    console.log(`检查页：${join(dir, 'review.html')}（读入 ${verdicts.length} 条判断）`);
  }
  console.log(
    `\n网页版：${join(dir, 'paragraphs.html')}\n不一致的地方：${join(dir, 'disagreements.txt')}`,
  );
}

function alignOptions(): AlignOptions {
  return { threshold: Number(values.threshold), lambda: Number(values.lambda) };
}

/**
 * 在几对书上比较各种方法：用 judged.json（人工判断过的段落）打分，再加上长度、意思两法的一致率。
 * 只用于开发阶段自检，这些条目是看着调参的
 */
async function compare(dirs: string[], key: ModelKey): Promise<void> {
  const lambdas = values.lambdas.split(',').map(Number);
  const methods: { name: string; pick: (g: GroupResult) => GroupResult['byLength'] }[] = [
    { name: '按长度', pick: (g) => g.byLength },
    { name: '按意思', pick: (g) => g.byMeaning },
  ];
  const results = new Map<string, string[]>();
  const totals = new Map<string, [number, number]>();
  for (const dir of dirs) {
    const options = alignOptions();
    const groups = await alignBook(join(dir, 'en.epub'), join(dir, 'zh.epub'), key, options);
    const cases = (
      JSON.parse(readFileSync(join(dir, 'judged.json'), 'utf8')) as { cases: JudgedCase[] }
    ).cases;
    // 换 lambda 只需要重算合并法，向量和另外两种方法都不变
    const combined = lambdas.map((lambda) => ({
      name: `合并 λ=${lambda}`,
      pick: (g: GroupResult) =>
        alignGroup(g.en, g.zh, g.enVecs, g.zhVecs, { ...options, lambda }).byCombined,
    }));
    for (const m of [...methods, ...combined]) {
      const s = scoreJudged(groups, cases, m.pick);
      if (s.notFound.length > 0) console.log(`${basename(dir)} 找不到：${s.notFound.join('；')}`);
      if (values.verbose && s.wrong.length > 0) {
        console.log(`\n${basename(dir)} · ${m.name} 配错：\n  ${s.wrong.join('\n  ')}`);
      }
      results.set(m.name, [...(results.get(m.name) ?? []), `${s.correct}/${s.total}`]);
      const [c, t] = totals.get(m.name) ?? [0, 0];
      totals.set(m.name, [c + s.correct, t + s.total]);
    }
    const symbols = groups.reduce((n, g) => n + g.symbols, 0);
    console.log(`${basename(dir)}：去掉了 ${symbols} 个只有符号的块`);
  }
  console.log(`\n方法          ${dirs.map((d) => basename(d).padEnd(24)).join('')}合计`);
  for (const [name, cells] of results) {
    const [c, t] = totals.get(name)!;
    console.log(`${name.padEnd(12)}  ${cells.map((x) => x.padEnd(24)).join('')}${c}/${t}`);
  }
}

/**
 * 章节自动配对测试：四种方法在每对书上配章节，和确认过的章节表比。
 * 按意思、合并两种方法试几组门槛和 lambda，取三本书合计"要改的行"最少的那组生成网页
 */
async function chapterTest(dirs: string[], key: ModelKey): Promise<void> {
  const thresholds = values.thresholds.split(',').map(Number);
  const lambdas = values.lambdas.split(',').map(Number);
  const embedder = withCache(await loadEmbedder(key));
  const books: {
    dir: string;
    en: ReturnType<typeof bookSections>;
    zh: ReturnType<typeof bookSections>;
    truth: ChapterMap['groups'];
    enVecs: Float32Array[];
    zhVecs: Float32Array[];
  }[] = [];
  for (const dir of dirs) {
    const en = bookSections(join(dir, 'en.epub'));
    const zh = bookSections(join(dir, 'zh.epub'));
    const truth = (JSON.parse(readFileSync(join(dir, 'chapters.json'), 'utf8')) as ChapterMap)
      .groups;
    books.push({
      dir,
      en,
      zh,
      truth,
      enVecs: await sectionVectors(en, embedder),
      zhVecs: await sectionVectors(zh, embedder),
    });
  }
  // 每组参数在每本书上要改几行
  const grid = thresholds.flatMap((threshold) => lambdas.map((lambda) => ({ threshold, lambda })));
  const toFix = (b: (typeof books)[number], o: { threshold: number; lambda: number }) => {
    const p = predictAll(b.en, b.zh, b.enVecs, b.zhVecs, o);
    return Object.fromEntries(
      Object.entries(p).map(([m, groups]) => [m, scoreChapters(b.truth, groups, b.en, b.zh)]),
    );
  };
  console.log(
    `门槛  λ    ${books.map((b) => basename(b.dir).padEnd(26)).join('')}（每格：按意思 / 合并 要改几行）`,
  );
  const best = {
    meaning: { total: Infinity, o: grid[0]! },
    combined: { total: Infinity, o: grid[0]! },
  };
  for (const o of grid) {
    const per = books.map((b) => toFix(b, o));
    const sum = (m: string) => per.reduce((n, s) => n + s[m]!.toFix, 0);
    if (sum('meaning') < best.meaning.total) best.meaning = { total: sum('meaning'), o };
    if (sum('combined') < best.combined.total) best.combined = { total: sum('combined'), o };
    console.log(
      `${o.threshold.toFixed(2)}  ${String(o.lambda).padEnd(4)} ${per.map((s) => `${s['meaning']!.toFix} / ${s['combined']!.toFix}`.padEnd(26)).join('')}`,
    );
  }
  console.log(
    `\n最好：按意思 门槛 ${best.meaning.o.threshold}；合并 门槛 ${best.combined.o.threshold}、λ ${best.combined.o.lambda}\n`,
  );
  for (const b of books) {
    const pm = predictAll(b.en, b.zh, b.enVecs, b.zhVecs, best.meaning.o);
    const pc = predictAll(b.en, b.zh, b.enVecs, b.zhVecs, best.combined.o);
    const predictions = {
      order: pc.order,
      length: pc.length,
      meaning: pm.meaning,
      combined: pc.combined,
    };
    for (const [m, groups] of Object.entries(predictions)) {
      const s = scoreChapters(b.truth, groups, b.en, b.zh);
      console.log(
        `${basename(b.dir).padEnd(24)} ${m.padEnd(9)} 正文 ${s.paired.correct}/${s.paired.total} · 不合并 ${s.unmerged.correct}/${s.unmerged.total} · 要改 ${s.toFix} 行`,
      );
    }
    writeFileSync(
      join(b.dir, 'chapter-test.html'),
      chapterTestHtml(basename(b.dir), b.truth, b.en, b.zh, predictions, best.combined.o),
    );
  }
}

/** 打印几段文字两两之间的相似度，用来快速试一个模型 */
async function sim(key: keyof typeof MODELS, texts: string[]): Promise<void> {
  const start = performance.now();
  const embedder = await loadEmbedder(key);
  const loaded = performance.now();
  const vectors = await embedder.embed(texts);
  const done = performance.now();

  console.log(`model ${MODELS[key].id}: load ${ms(loaded - start)}, embed ${ms(done - loaded)}`);
  texts.forEach((t, i) => console.log(`[${i}] ${t}`));
  console.log(`\n     ${texts.map((_, j) => `[${j}]`.padStart(6)).join('')}`);
  vectors.forEach((a, i) => {
    const row = vectors.map((b) => cosine(a, b).toFixed(2).padStart(6)).join('');
    console.log(`[${i}]  ${row}`);
  });
}

function ms(n: number): string {
  return `${Math.round(n)} ms`;
}
