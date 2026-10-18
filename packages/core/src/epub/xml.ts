// 包一层 htmlparser2，只提供 OPF、目录要用的几个函数。
//
// 两个要注意的地方：
// 1. htmlparser2 不懂命名空间，"dc:title" 只是一个名字叫 "dc:title" 的标签。
//    所以这里按"去掉前缀后的本地名"匹配，有前缀（<dc:title>）和没前缀（<title xmlns=...>）都能找到。
//    同时忽略大小写，兼容写得不规范的书。
// 2. 关掉 htmlparser2 自己的实体解码，统一用 entities 解一次。
//    htmlparser2 的 XML 模式不认识 &nbsp; 这类 HTML 写法，如果它先解一遍、我们再解一遍，
//    "&amp;nbsp;" 会被解两次，错变成空格。

import { isTag, type AnyNode, type Document, type Element } from 'domhandler';
import { decodeHTMLStrict } from 'entities/decode';
import { DomUtils, parseDocument } from 'htmlparser2';

export type { Document, Element };

/** withIndices：记下每个节点在 text 里的起止位置（startIndex / endIndex），生成 ePub 时按位置插入用 */
export function parseXml(text: string, options: { withIndices?: boolean } = {}): Document {
  const indices = options.withIndices ?? false;
  return parseDocument(text, {
    xmlMode: true,
    decodeEntities: false,
    withStartIndices: indices,
    withEndIndices: indices,
  });
}

/** "dc:title" → "title"，并转成小写 */
export function localName(name: string): string {
  const i = name.indexOf(':');
  return (i < 0 ? name : name.slice(i + 1)).toLowerCase();
}

function matches(name: string): (el: Element) => boolean {
  const target = name.toLowerCase();
  return (el) => localName(el.name) === target;
}

/** root 下面（不含 root 自己）所有本地名为 name 的元素，按文档顺序 */
export function findAll(root: Document | Element, name: string): Element[] {
  return DomUtils.findAll(matches(name), root.children);
}

/** root 下面第一个本地名为 name 的元素 */
export function findFirst(root: Document | Element, name: string): Element | null {
  return DomUtils.findOne(matches(name), root.children, true);
}

/** el 的直接子元素；给了 name 时只要本地名为 name 的 */
export function childElements(el: Element, name?: string): Element[] {
  const test = name === undefined ? () => true : matches(name);
  return el.children.filter((c: AnyNode): c is Element => isTag(c) && test(c));
}

/**
 * 取属性值（已解码实体）。先精确匹配属性名，找不到再按本地名匹配，
 * 所以 attr(el, 'role') 能取到 opf:role，attr(el, 'type') 能取到 epub:type。
 * 没有这个属性时返回 null。
 */
export function attr(el: Element, name: string): string | null {
  const exact = el.attribs[name];
  if (exact !== undefined) return decodeHTMLStrict(exact);
  const target = localName(name);
  for (const [key, value] of Object.entries(el.attribs)) {
    if (localName(key) === target) return decodeHTMLStrict(value);
  }
  return null;
}

/** 元素里的全部文字（已解码实体），连续空白（包括 &nbsp;）合并成一个普通空格，去掉首尾空白 */
export function textOf(el: Element): string {
  return decodeHTMLStrict(DomUtils.textContent(el)).replace(/\s+/g, ' ').trim();
}
