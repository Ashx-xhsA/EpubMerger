// 测试集回归测试：fixtures/pairs/ 下的每本真书都要能解析。
// 书有版权，fixtures/ 不进 git；别人 clone 仓库后没有这个文件夹，整组测试自动跳过。
// 放在 cli 包里而不是 core，是因为要用 Node 的 fs 读硬盘，core 不允许用 Node 独有的东西。

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBlocks, parseEpub, type TocEntry } from '@epubmerger/core';
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
