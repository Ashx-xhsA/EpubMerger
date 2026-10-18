// 一个 XHTML 文件 → 块序列。
//
// 一个块 = 最里层的块级元素：它是块级标签，并且里面没有别的块级元素。
// 很多书整章都是 <div> 套 <div>，所以从 <body> 往下递归，直到找到这样的元素。
// 容器里如果既有直接写的文字又有子块（<div>文字<p>…</p></div>），直接写的文字单独成一块。
//
// 用 XML 模式解析：书里常见 <a id="page3"/> 这种自闭合写法，HTML 模式会把它当成没关闭的链接，吞掉后面的内容。

import { isTag, isText, type AnyNode, type Document, type Element } from 'domhandler';
import { DomUtils } from 'htmlparser2';
import { attr, findFirst, localName, parseXml } from '../epub/xml.ts';
import { elementText, isNoteRef, isPageMarker, nodesText, semanticTypes } from './text.ts';
import type { Block, BlockKind } from './types.ts';

/** 块级标签。遇到它们就不再当成行内内容 */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details',
  'div', 'dl', 'dt', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul',
]); // prettier-ignore

/** 图片：<img>、SVG 里的 <image>、整个 <svg>（封面常用） */
const IMAGE_TAGS = new Set(['img', 'image', 'svg']);

/** 跳过的元素：里面不会有正文 */
const SKIP_TAGS = new Set(['script', 'style', 'head', 'hr']);

/** 分隔符：没有字母、数字、汉字，只有符号，如 * * *、◇、——、~ ~ ~ */
const SEPARATOR = /^[^\p{L}\p{N}]+$/u;

/** 脚注容器常见的 class 名（不同的书写法不同，遇到新写法加在这里） */
const NOTE_CLASS = /^(f?notes?|foot-?notes?|end-?notes?|rear-?notes?|zhusi|zhushi)$/i;

/** 标准的脚注容器写法 */
const NOTE_TYPES = new Set(['footnote', 'footnotes', 'endnote', 'endnotes', 'rearnote', 'rearnotes', 'note',
  'doc-footnote', 'doc-endnote', 'doc-endnotes']); // prettier-ignore

/** blocks.ts 只管切块，region 由 regions.ts 决定，这里先不填 */
export interface RawBlock extends Omit<Block, 'region'> {
  /** 在标准写法或常见 class 的脚注容器里 */
  inNote: boolean;
  /** 块里有链接（目录页的特征） */
  hasLink: boolean;
  /**
   * 块的第一个内容就是链接，前面没有文字。脚注一般以指回正文的序号链接开头（"[1] 见……"）；
   * 正文里的引用号则跟在文字后面。用来区分"脚注"和"被脚注的回链指着的正文段落"
   */
  startsWithLink: boolean;
}

export interface SplitResult {
  blocks: RawBlock[];
  /** 这个文件里所有脚注引用指向的地址（原样的 href，如 "notes.html#n3"），用来认出被指向的脚注块 */
  noteRefTargets: string[];
  /**
   * <body> 和整个包住正文的外层元素（如 <body><section epub:type="copyright-page">）上的
   * epub:type / role，非正文识别用
   */
  rootTypes: string[];
}

function isBlockTag(node: AnyNode): node is Element {
  return isTag(node) && BLOCK_TAGS.has(localName(node.name));
}

function isImage(node: AnyNode): node is Element {
  return isTag(node) && IMAGE_TAGS.has(localName(node.name));
}

function hasBlockDescendant(el: Element): boolean {
  return DomUtils.findOne((e) => BLOCK_TAGS.has(localName(e.name)), el.children) !== null;
}

function hasImage(nodes: AnyNode[]): boolean {
  return DomUtils.findOne((e) => IMAGE_TAGS.has(localName(e.name)), nodes) !== null;
}

function hasLink(nodes: AnyNode[]): boolean {
  return (
    DomUtils.findOne((e) => localName(e.name) === 'a' && attr(e, 'href') !== null, nodes) !== null
  );
}

function startsWithLink(nodes: AnyNode[]): boolean {
  for (const node of nodes) {
    if (isText(node)) {
      if (node.data.replace(/&nbsp;|&#160;|&#xa0;/gi, '').trim() !== '') return false;
    } else if (isTag(node)) {
      if (localName(node.name) === 'a' && attr(node, 'href') !== null) return true;
      if (IMAGE_TAGS.has(localName(node.name))) return false;
      if (startsWithLink(node.children)) return true;
      if (DomUtils.textContent(node).trim() !== '') return false;
    }
  }
  return false;
}

function isNoteContainer(el: Element): boolean {
  if (semanticTypes(el).some((t) => NOTE_TYPES.has(t))) return true;
  return (attr(el, 'class') ?? '').split(/\s+/).some((c) => NOTE_CLASS.test(c));
}

/** 文件里脚注引用的链接地址：<a epub:type="noteref" href=…>，或 <sup> 引用号里的 <a> */
function findNoteRefTargets(root: Element | Document): string[] {
  return DomUtils.findAll((a) => {
    if (localName(a.name) !== 'a' || !(attr(a, 'href') ?? '').includes('#')) return false;
    const parent = a.parent;
    return isNoteRef(a) || (parent !== null && isTag(parent) && isNoteRef(parent));
  }, root.children).map((a) => attr(a, 'href') ?? '');
}

/** 节点和里面所有元素的 id，按文档顺序 */
function collectIds(nodes: AnyNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: AnyNode): void => {
    if (!isTag(node)) return;
    const id = attr(node, 'id');
    if (id !== null && id !== '') ids.push(id);
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

/** 一串相邻节点在原文里的位置 [start, end)。解析时要打开 withIndices */
function rangeOf(nodes: AnyNode[]): [number, number] {
  return [nodes[0]?.startIndex ?? 0, (nodes.at(-1)?.endIndex ?? -1) + 1];
}

function outerHtml(nodes: AnyNode | AnyNode[]): string {
  // 解析时没有解码实体，这里也不重新编码，原样输出
  return DomUtils.getOuterHTML(nodes, { xmlMode: true, decodeEntities: false });
}

function kindOf(el: Element, text: string): { kind: BlockKind; headingLevel?: number } {
  const name = localName(el.name);
  const h = /^h([1-6])$/.exec(name);
  if (h?.[1] !== undefined) return { kind: 'heading', headingLevel: Number(h[1]) };
  if (SEPARATOR.test(text)) return { kind: 'other' };
  if (name === 'li' || name === 'dt' || name === 'dd') return { kind: 'list' };
  if (name === 'blockquote') return { kind: 'quote' };
  return { kind: 'para' };
}

/** 把一个 XHTML 文件切成块。file 是它在 zip 里的路径，原样记到每个块上 */
export function splitBlocks(xhtml: string, file: string): SplitResult {
  const doc = parseXml(xhtml, { withIndices: true });
  const root = findFirst(doc, 'body') ?? doc;
  const blocks: RawBlock[] = [];
  // 还没有落到某个块上的 id：容器自己的 id、被丢掉的空块里的 id。交给下一个块
  let pending: string[] = [];
  // 现在是否在脚注容器里面（容器可以嵌套，所以记层数）
  let noteDepth = 0;

  const emit = (
    block: Omit<RawBlock, 'file' | 'range' | 'inNote' | 'hasLink' | 'startsWithLink'>,
    nodes: AnyNode[],
  ): void => {
    blocks.push({
      ...block,
      file,
      range: rangeOf(nodes),
      ids: [...pending, ...block.ids],
      inNote: noteDepth > 0,
      hasLink: hasLink(nodes),
      startsWithLink: startsWithLink(nodes),
    });
    pending = [];
  };

  const emitImage = (nodes: AnyNode[]): void => {
    emit(
      { kind: 'image', text: '', html: outerHtml(nodes), ids: collectIds(nodes), className: '' },
      nodes,
    );
  };

  /** 容器里连续的一串行内内容（文字、<span>、<a>……），当作一个没有标签的段落 */
  const emitRun = (run: AnyNode[]): void => {
    if (run.length === 0) return;
    const text = nodesText(run);
    if (text !== '') {
      const kind = SEPARATOR.test(text) ? 'other' : 'para';
      emit({ kind, text, html: outerHtml(run), ids: collectIds(run), className: '' }, run);
    } else if (hasImage(run)) {
      emitImage(run);
    } else {
      pending.push(...collectIds(run));
    }
  };

  const emitLeaf = (el: Element): void => {
    if (isPageMarker(el)) {
      pending.push(...collectIds([el]));
      return;
    }
    const text = elementText(el);
    if (text === '') {
      if (hasImage([el])) emitImage([el]);
      else pending.push(...collectIds([el]));
      return;
    }
    emit(
      {
        ...kindOf(el, text),
        text,
        html: outerHtml(el),
        ids: collectIds([el]),
        className: attr(el, 'class') ?? '',
      },
      [el],
    );
  };

  const walkChildren = (el: Element | Document): void => {
    let run: AnyNode[] = [];
    for (const child of el.children) {
      if (isTag(child) && SKIP_TAGS.has(localName(child.name))) {
        continue;
      } else if (isBlockTag(child) || isImage(child)) {
        emitRun(run);
        run = [];
        visit(child);
      } else if (isTag(child) || isText(child)) {
        run.push(child);
      }
    }
    emitRun(run);
  };

  const visit = (el: Element): void => {
    const name = localName(el.name);
    if (SKIP_TAGS.has(name)) return;
    const note = isNoteContainer(el);
    if (note) noteDepth++;
    if (isImage(el)) {
      emitImage([el]);
    } else if (name === 'table') {
      const text = elementText(el);
      if (text === '' && !hasImage([el])) pending.push(...collectIds([el]));
      else
        emit(
          {
            kind: 'table',
            text,
            html: outerHtml(el),
            ids: collectIds([el]),
            className: attr(el, 'class') ?? '',
          },
          [el],
        );
    } else if (!hasBlockDescendant(el)) {
      emitLeaf(el);
    } else {
      // 容器：自己的 id 交给里面的第一个块
      const id = attr(el, 'id');
      if (id !== null && id !== '') pending.push(id);
      walkChildren(el);
    }
    if (note) noteDepth--;
  };

  walkChildren(root);
  // 文件末尾还有没落下的 id（如末尾一个空的锚点），挂到最后一个块上
  const last = blocks.at(-1);
  if (last !== undefined && pending.length > 0) last.ids.push(...pending);
  return { blocks, noteRefTargets: findNoteRefTargets(root), rootTypes: findRootTypes(root) };
}

/** 从 <body> 往下，只要元素只有一个子元素就继续往里走，收集一路上的 epub:type / role */
function findRootTypes(root: Element | Document): string[] {
  const types: string[] = [];
  let el: Element | Document = root;
  for (;;) {
    if (isTag(el)) types.push(...semanticTypes(el));
    const children: Element[] = el.children.filter(isTag);
    const hasLooseText = el.children.some((c) => isText(c) && c.data.trim() !== '');
    if (children.length !== 1 || hasLooseText || children[0] === undefined) return types;
    el = children[0];
  }
}
