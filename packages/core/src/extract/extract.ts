// 正文抽取的入口：一本书 → 按 spine 顺序的块序列，每块带上 region。

import { dirname, resolveHref } from '../epub/path.ts';
import type { Book, TocEntry } from '../epub/types.ts';
import { splitBlocks, type SplitResult } from './blocks.ts';
import { classifyFile } from './regions.ts';
import type { Block, ExtractResult, FileInfo } from './types.ts';

/** 每个文件第一个指向它的目录项标题（目录按文档顺序拉平） */
function firstTocTitles(toc: TocEntry[]): Map<string, string> {
  const titles = new Map<string, string>();
  const visit = (entries: TocEntry[]): void => {
    for (const entry of entries) {
      if (!titles.has(entry.href)) titles.set(entry.href, entry.title);
      visit(entry.children);
    }
  };
  visit(toc);
  return titles;
}

/** "文件路径#id"，用来在全书范围内认出被脚注引用指着的块 */
function key(path: string, id: string): string {
  return `${path}#${id}`;
}

export function extractBlocks(book: Book): ExtractResult {
  const tocTitles = firstTocTitles(book.toc);
  const split: SplitResult[] = book.spine.map((item) => {
    const xhtml = book.readText(item.href);
    return xhtml === null
      ? { blocks: [], noteRefTargets: [], rootTypes: [] }
      : splitBlocks(xhtml, item.href);
  });

  // 全书所有脚注引用指向的位置。引用可能在正文文件里、脚注在另一个注释文件里
  const noteTargets = new Set<string>();
  book.spine.forEach((item, i) => {
    for (const href of split[i]?.noteRefTargets ?? []) {
      const target = href.startsWith('#')
        ? { path: item.href, fragment: href.slice(1) }
        : resolveHref(dirname(item.href), href);
      if (target?.fragment) noteTargets.add(key(target.path, target.fragment));
    }
  });

  const blocks: Block[] = [];
  const files: FileInfo[] = [];
  book.spine.forEach((item, i) => {
    const { blocks: raw, rootTypes } = split[i] ?? { blocks: [], rootTypes: [] };
    const { region, reason } = classifyFile({
      linear: item.linear,
      rootTypes,
      tocTitle: tocTitles.get(item.href) ?? null,
      blocks: raw,
    });
    files.push({ href: item.href, region, reason, blockCount: raw.length });
    for (const b of raw) {
      // 脚注块：在脚注容器里，或者被脚注引用指着、并且以链接开头（指回正文的序号）。
      // 只看"有没有链接"不够：脚注的回链也指着正文段落，而正文段落里也有引用号链接
      const pointedTo = b.startsWithLink && b.ids.some((id) => noteTargets.has(key(item.href, id)));
      const block: Block = {
        kind: b.kind,
        text: b.text,
        html: b.html,
        file: b.file,
        ids: b.ids,
        className: b.className,
        region: b.inNote || pointedTo ? 'notes' : region,
      };
      if (b.headingLevel !== undefined) block.headingLevel = b.headingLevel;
      blocks.push(block);
    }
  });
  return { blocks, files };
}
