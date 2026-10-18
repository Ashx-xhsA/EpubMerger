// 决定另一本书的每段插到骨架书 XHTML 的哪里，并生成插入的元素。

import type { Block } from '../extract/types.ts';
import type { BlockPair } from '../paragraphs/align-book.ts';
import { insertAt, type Edit } from './edit.ts';
import { sanitizeBlock } from './sanitize.ts';

/** 插入的元素的 class，bilingual.css 用 */
export const INSERT_CLASS = 'bi-insert';

/** 插入的元素沿用骨架段落的这些标签（<ul> 里只能放 <li>，标题后面放标题），其他情况用 <div> */
const SAME_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'dt',
  'dd',
  'blockquote',
]);

export interface Placement {
  /** 来自 pairs 里的第几对 */
  pair: number;
  /** 骨架书里的文件和插入位置 */
  file: string;
  at: number;
  /** 插在哪个骨架块旁边，标签跟着它走 */
  anchor: Block;
  block: Block;
}

export type DropReason = 'NO_SKELETON_IN_GROUP';

export interface Dropped {
  reason: DropReason;
  block: Block;
}

/**
 * 每段另一本书的块插到哪里。骨架在前时：
 * - 一对里有骨架段落：插在最后一块骨架段落后面
 * - 没有对应（只有另一本）：挂到同一组里前一对的后面；组的开头就挂到后一对的前面
 * 另一本在前时左右镜像：插在第一块骨架段落前面，没有对应的挂到后一对的前面。
 * 一组里一块骨架段落都没有，就丢掉
 */
export function placeBlocks(
  pairs: BlockPair[],
  otherFirst: boolean,
): { placements: Placement[]; dropped: Dropped[] } {
  const placements: Placement[] = [];
  const dropped: Dropped[] = [];
  const before = (b: Block) => ({ file: b.file, at: b.range[0], anchor: b });
  const after = (b: Block) => ({ file: b.file, at: b.range[1], anchor: b });

  /** 一对的插入位置：front 为 true 时在第一块骨架段落前面，否则在最后一块后面 */
  const spot = (p: BlockPair, front: boolean) =>
    front ? before(p.skeleton[0]!) : after(p.skeleton.at(-1)!);

  pairs.forEach((p, k) => {
    if (p.other.length === 0) return;
    let where: { file: string; at: number; anchor: Block } | undefined;
    if (p.skeleton.length > 0) {
      where = spot(p, otherFirst);
    } else {
      const sameGroup = (q: BlockPair | undefined) =>
        q !== undefined && q.group === p.group && q.skeleton.length > 0;
      const prev = pairs.slice(0, k).reverse().find(sameGroup);
      const next = pairs.slice(k + 1).find(sameGroup);
      const first = otherFirst ? next : prev;
      if (first !== undefined) where = spot(first, otherFirst);
      else if (otherFirst && prev !== undefined) where = spot(prev, false);
      else if (!otherFirst && next !== undefined) where = spot(next, true);
    }
    for (const block of p.other) {
      if (where === undefined) dropped.push({ reason: 'NO_SKELETON_IN_GROUP', block });
      else placements.push({ pair: k, ...where, block });
    }
  });
  return { placements, dropped };
}

/** 骨架段落原文开头的标签名（保留前缀，如 "html:p"）；以文字开头时返回 null */
function tagName(source: string): string | null {
  return /^<([A-Za-z_][\w:.-]*)/.exec(source)?.[1] ?? null;
}

/**
 * 插入的元素。ePub 2（XHTML 1.1）不允许 lang 属性，只写 xml:lang；ePub 3 两个都写。
 * 内容清理后为空（例如这段只有图片）时返回 null
 */
export function insertedElement(
  anchorSource: string,
  block: Block,
  lang: string,
  epub3: boolean,
): string | null {
  const content = sanitizeBlock(block.html);
  if (content === '') return null;
  const name = tagName(anchorSource);
  const local = name?.slice(name.indexOf(':') + 1).toLowerCase();
  const tag = name !== null && local !== undefined && SAME_TAGS.has(local) ? name : 'div';
  const langs = epub3 ? `xml:lang="${lang}" lang="${lang}"` : `xml:lang="${lang}"`;
  return `<${tag} class="${INSERT_CLASS}" ${langs}>${content}</${tag}>`;
}

/** 在 </head> 前面加 css 链接；找不到 </head> 时返回 null */
export function stylesheetEdit(xhtml: string, href: string): Edit | null {
  const m = /<\/(?:[\w-]+:)?head\s*>/i.exec(xhtml);
  if (m === null) return null;
  return insertAt(m.index, `<link rel="stylesheet" type="text/css" href="${href}"/>`);
}

/** 输出一律按 UTF-8 写，所以 XML 声明里写了别的编码（如 GBK）时改成 UTF-8 */
export function utf8Declaration(xhtml: string): string {
  return xhtml.replace(
    /^(\uFEFF?\s*<\?xml[^>]*?encoding\s*=\s*)(["'])([^"']*)\2/,
    (all, head: string, quote: string, enc: string) =>
      enc.toLowerCase() === 'utf-8' ? all : `${head}${quote}UTF-8${quote}`,
  );
}
