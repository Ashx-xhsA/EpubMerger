// 测试集回归测试：fixtures/pairs/ 下的每本真书都要能解析。
// 书有版权，fixtures/ 不进 git；别人 clone 仓库后没有这个文件夹，整组测试自动跳过。
// 放在 cli 包里而不是 core，是因为要用 Node 的 fs 读硬盘，core 不允许用 Node 独有的东西。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkLanguagePair,
  detectLanguage,
  extractBlocks,
  parseEpub,
  type Block,
  type TocEntry,
} from '@epubmerger/core';
import { afterAll, describe, expect, it } from 'vitest';

const PAIRS_DIR = fileURLToPath(new URL('../../../fixtures/pairs', import.meta.url));

const books = existsSync(PAIRS_DIR)
  ? readdirSync(PAIRS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .flatMap((d) => ['en', 'zh'].map((lang) => `${d.name}/${lang}.epub`))
      .filter((name) => existsSync(join(PAIRS_DIR, name)))
  : [];

function countEntries(entries: TocEntry[]): number {
  return entries.reduce((n, e) => n + 1 + countEntries(e.children), 0);
}

const summary: string[] = [];

describe.skipIf(books.length === 0)('fixtures: every book parses', () => {
  it.each(books)('%s', (name) => {
    const result = parseEpub(readFileSync(join(PAIRS_DIR, name)));
    if (!result.ok) {
      summary.push(`${name}\tERROR ${result.error.code}: ${result.error.message}`);
      expect.fail(`${result.error.code}: ${result.error.message}`);
    }
    const { book, warnings } = result;
    summary.push(
      [
        name,
        `v${book.version}`,
        `spine=${book.spine.length}`,
        `toc=${book.toc.length}/${countEntries(book.toc)} (${book.tocSource})`,
        `lang=${book.metadata.languages.join(',') || '-'}`,
        `warnings=${warnings.map((w) => `${w.code}: ${w.message}`).join(' | ') || '-'}`,
      ].join('\t'),
    );
    expect(book.spine.length).toBeGreaterThan(0);
    expect(book.toc.length).toBeGreaterThan(0);
  });

  afterAll(() => {
    console.log(['', '---- fixtures summary ----', ...summary.sort()].join('\n'));
  });
});

const extractSummary: string[] = [];

describe.skipIf(books.length === 0)('fixtures: every book extracts', () => {
  it.each(books)('%s', (name) => {
    const result = parseEpub(readFileSync(join(PAIRS_DIR, name)));
    if (!result.ok) return expect.fail(result.error.code);
    const { blocks } = extractBlocks(result.book);
    const byRegion = new Map<string, number>();
    for (const b of blocks) byRegion.set(b.region, (byRegion.get(b.region) ?? 0) + 1);
    extractSummary.push(
      [
        name,
        `blocks=${blocks.length}`,
        ...[...byRegion].sort((a, b) => b[1] - a[1]).map(([region, n]) => `${region}=${n}`),
      ].join('\t'),
    );
    expect(byRegion.get('body') ?? 0).toBeGreaterThan(0);
  });

  afterAll(() => {
    console.log(['', '---- extract summary ----', ...extractSummary.sort()].join('\n'));
  });
});

// 语言识别：开发集和测试集的每对书都要认对，组合检查要通过；
// 把一对书的块交错拼成的"假双语书"没有一种语言占多数，应该判成不确定
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures', import.meta.url));

const langPairs = ['pairs', 'holdout'].flatMap((group) => {
  const dir = join(FIXTURES_DIR, group);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'en.epub')))
    .map((d) => `${group}/${d.name}`);
});

function blocksOf(path: string): Block[] {
  const result = parseEpub(readFileSync(path));
  if (!result.ok) throw new Error(`${path}: ${result.error.code}`);
  return extractBlocks(result.book).blocks;
}

function interleave(a: Block[], b: Block[]): Block[] {
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => [a[i], b[i]])
    .flat()
    .filter((x) => x !== undefined);
}

describe.skipIf(langPairs.length === 0)('fixtures: language detection', () => {
  it.each(langPairs)('%s', (pair) => {
    const en = blocksOf(join(FIXTURES_DIR, pair, 'en.epub'));
    const zh = blocksOf(join(FIXTURES_DIR, pair, 'zh.epub'));
    const enLang = detectLanguage(en).language;
    const zhLang = detectLanguage(zh).language;
    expect(enLang).toEqual({ kind: 'single', lang: 'en' });
    expect(zhLang).toEqual({ kind: 'single', lang: 'zh-Hans' });
    expect(checkLanguagePair(enLang, zhLang)).toEqual({ ok: true, issues: [] });
    expect(detectLanguage(interleave(en, zh)).language).toEqual({ kind: 'uncertain' });
  });
});
