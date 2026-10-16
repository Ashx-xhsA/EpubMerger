import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CORE_VERSION, parseEpub, type Book, type TocEntry } from '@epubmerger/core';

const USAGE = `Usage:
  pnpm cli merge <en.epub> <zh.epub> -o <out.epub>
  pnpm cli inspect <book.epub>`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: 'string', short: 'o' },
    version: { type: 'boolean', short: 'v' },
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

function countEntries(entries: TocEntry[]): number {
  return entries.reduce((n, e) => n + 1 + countEntries(e.children), 0);
}
