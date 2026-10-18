// 左右两栏：每对段落包成一个一行两格的小表格。
// 仍然只插不改：骨架段落前插入表格开头，后面插入表格结尾和另一本的段落。
// 每对一个小表格，不用一章一个大表格（大表格在阅读器里卡、翻页容易出问题）。

import { isTag, type AnyNode } from 'domhandler';
import { localName, parseXml } from '../epub/xml.ts';
import type { Block } from '../extract/types.ts';
import { insertAt, type Edit } from './edit.ts';

export const ROW_CLASS = 'bi-row';
export const LEFT_CLASS = 'bi-left';
export const RIGHT_CLASS = 'bi-right';

/** 表格可以放在这些元素里面（<p>、<ul>、<table> 这类里面不能直接放表格） */
const ROW_PARENTS = new Set(
  'body div section article aside main header footer nav blockquote figure li dd td th'.split(' '),
);

/** 骨架段落是这些标签时不包（<ul> 里只能放 <li>） */
const NO_WRAP_TAGS = new Set(['li', 'dt', 'dd']);

/**
 * 一个文件的"能不能包成表格"检查：一对里的骨架段落要在同一个父元素下，
 * 父元素里能放表格，第一段不是列表项
 */
export function rowChecker(source: string): (blocks: Block[]) => boolean {
  const doc = parseXml(source, { withIndices: true });
  const byStart = new Map<number, AnyNode>();
  const byEnd = new Map<number, AnyNode>();
  const visit = (nodes: AnyNode[]): void => {
    for (const node of nodes) {
      if (node.startIndex !== null) byStart.set(node.startIndex, node);
      if (node.endIndex !== null) byEnd.set(node.endIndex, node);
      if (isTag(node)) visit(node.children);
    }
  };
  visit(doc.children);

  return (blocks) => {
    const firstBlock = blocks[0];
    const lastBlock = blocks.at(-1);
    if (firstBlock === undefined || lastBlock === undefined) return false;
    if (blocks.some((b) => b.file !== firstBlock.file)) return false;
    const first = byStart.get(firstBlock.range[0]);
    const last = byEnd.get(lastBlock.range[1] - 1);
    const parent = first?.parent;
    if (first === undefined || last === undefined || parent === null || parent === undefined) {
      return false;
    }
    if (last.parent !== parent || !isTag(parent)) return false;
    if (!ROW_PARENTS.has(localName(parent.name))) return false;
    return !(isTag(first) && NO_WRAP_TAGS.has(localName(first.name)));
  };
}

/** 包住一对：skeleton 是这一对的骨架块（已检查过能包），others 是另一本插入的元素 */
export function rowEdits(skeleton: Block[], others: string[], otherFirst: boolean): Edit[] {
  const start = skeleton[0]!.range[0];
  const end = skeleton.at(-1)!.range[1];
  const open = `<table class="${ROW_CLASS}"><tr>`;
  const close = '</tr></table>';
  const cell = (side: string, content: string) => `<td class="${side}">${content}</td>`;
  if (otherFirst) {
    return [
      insertAt(start, `${open}${cell(LEFT_CLASS, others.join(''))}<td class="${RIGHT_CLASS}">`),
      insertAt(end, `</td>${close}`),
    ];
  }
  return [
    insertAt(start, `${open}<td class="${LEFT_CLASS}">`),
    insertAt(end, `</td>${cell(RIGHT_CLASS, others.join(''))}${close}`),
  ];
}

/** 另一本多出来、骨架没有对应的段落：骨架那一格空着 */
export function orphanRow(at: number, others: string[], otherFirst: boolean): Edit {
  const content = `<td class="${otherFirst ? LEFT_CLASS : RIGHT_CLASS}">${others.join('')}</td>`;
  const empty = `<td class="${otherFirst ? RIGHT_CLASS : LEFT_CLASS}"></td>`;
  return insertAt(
    at,
    `<table class="${ROW_CLASS}"><tr>${otherFirst ? content + empty : empty + content}</tr></table>`,
  );
}
