// 另一本书的块 → 能安全插进骨架书的 HTML 片段。
//
// 骨架书的 CSS 不认识另一本书的 class，id 可能和骨架书重复，链接指向的脚注也不会跟过来
// （trade-off 025），所以只留几种表示语义的行内标签，属性全部去掉。
// 实体先解码、再只转义 & < >：另一本书可能写 &nbsp; 这类 HTML 实体，
// 骨架书的 XHTML 不一定认识，读到就是 XML 错误，整章打不开。

import { isTag, isText, type AnyNode } from 'domhandler';
import { decodeHTMLStrict } from 'entities/decode';
import { localName, parseXml } from '../epub/xml.ts';
import { isNoteRef, isPageMarker } from '../extract/text.ts';

/** 保留的标签（去掉属性） */
const KEEP_TAGS = new Set('i em b strong u s sup sub small br code q cite abbr'.split(' '));

/** 连标签带内容整个删掉 */
const DROP_TAGS = new Set(['img', 'image', 'svg', 'script', 'style', 'rt', 'rp', 'head']);

/** 去掉标签时要补一个空格的块级标签，防止表格的格子、列表项连成一串 */
const BLOCK_TAGS = new Set(
  'address article aside blockquote caption dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header li ol p pre section table td th tr ul'.split(
    ' ',
  ),
);

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function serialize(nodes: AnyNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (isText(node)) {
      out += escapeXml(decodeHTMLStrict(node.data));
    } else if (isTag(node)) {
      const name = localName(node.name);
      if (DROP_TAGS.has(name) || isNoteRef(node) || isPageMarker(node)) continue;
      if (name === 'br') out += '<br/>';
      else if (KEEP_TAGS.has(name)) out += `<${name}>${serialize(node.children)}</${name}>`;
      else if (BLOCK_TAGS.has(name)) out += ` ${serialize(node.children)} `;
      else out += serialize(node.children);
    }
    // 注释、CDATA、处理指令都不要
  }
  return out;
}

/**
 * 一个块的 html → 清理过的内容（不含外层标签）。最外层只有一个块级元素（如 <p>）时只取它里面的内容；
 * 容器里散放的文字（没有外层标签）整个都取。首尾空白去掉，连续的普通空白合成一个（不换行空格保留）
 */
export function sanitizeBlock(html: string): string {
  const doc = parseXml(html);
  const top = doc.children.filter((n) => !(isText(n) && n.data.trim() === ''));
  const only = top.length === 1 ? top[0] : undefined;
  const nodes =
    only !== undefined && isTag(only) && BLOCK_TAGS.has(localName(only.name))
      ? only.children
      : doc.children;
  return serialize(nodes)
    .replace(/[ \t\n\r\f]+/g, ' ')
    .replace(/ ?<br\/> ?/g, '<br/>')
    .trim();
}
