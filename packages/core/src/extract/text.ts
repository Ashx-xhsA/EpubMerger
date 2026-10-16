// 元素 → 纯文本。text 用来对齐和核对数字，所以要去掉阅读时看不到、或两个版本不一样的东西：
// 注音（<rt>）、脚注引用号（[1]、*）、有文字的页码。

import { isTag, isText, type AnyNode, type Element } from 'domhandler';
import { decodeHTMLStrict } from 'entities/decode';
import { DomUtils } from 'htmlparser2';
import { attr, localName } from '../epub/xml.ts';

/** 完全跳过、连里面的文字也不要的元素 */
const SKIP_TAGS = new Set(['script', 'style', 'rt', 'rp', 'head']);

/** 先用一个正文里不会出现的字符占住 <br> 的位置，合并空白之后再换成换行 */
const BR = String.fromCharCode(0xe000);

/** 看起来像脚注引用号的文字：[1]、［12］、〔3〕、*、†、‡、§ */
const BRACKETED_REF = /^(\[\d{1,3}\]|［\d{1,3}］|〔\d{1,3}〕|\*{1,3}|[†‡§]{1,2})$/;
/** 放在 <sup> 里时，光秃秃的数字也算 */
const SUP_REF = /^(\d{1,3}|\[\d{1,3}\]|［\d{1,3}］|〔\d{1,3}〕|\*{1,3}|[†‡§]{1,2})$/;

/** 页码的文字：阿拉伯数字或罗马数字 */
const PAGE_NUMBER = /^\[?(\d{1,4}|[ivxlcdm]{1,8})\]?$/i;

/** epub:type 和 role 里的各个词，转成小写。如 "noteref"、"doc-noteref" */
export function semanticTypes(el: Element): string[] {
  const words = `${attr(el, 'type') ?? ''} ${attr(el, 'role') ?? ''}`.toLowerCase();
  return words.split(/\s+/).filter((w) => w !== '');
}

function rawText(el: Element): string {
  return decodeHTMLStrict(DomUtils.textContent(el)).replace(/\s+/g, '');
}

/**
 * 是不是脚注引用（正文里指向脚注的小链接）：
 * - 标了 epub:type="noteref" 或 role="doc-noteref"
 * - <sup> 里有链接，文字是 1、[1]、* 这类
 * - 链接里有 <sup>，或者文字带括号，如 <a href="#fn1">[1]</a>
 */
export function isNoteRef(el: Element): boolean {
  const types = semanticTypes(el);
  if (types.includes('noteref') || types.includes('doc-noteref')) return true;
  const name = localName(el.name);
  if (name === 'sup') {
    return (
      DomUtils.findOne((e) => localName(e.name) === 'a', el.children) !== null &&
      SUP_REF.test(rawText(el))
    );
  }
  if (name === 'a' && (attr(el, 'href') ?? '').includes('#')) {
    const text = rawText(el);
    if (BRACKETED_REF.test(text)) return true;
    const hasSup = DomUtils.findOne((e) => localName(e.name) === 'sup', el.children) !== null;
    return hasSup && SUP_REF.test(text);
  }
  return false;
}

/**
 * 是不是有文字的页码标记，如 <span epub:type="pagebreak">143</span>、<span class="pagenum">[iv]</span>。
 * 空的页码标记（<a id="page3"/>）没有文字，本来就不会进 text，不用认。
 */
export function isPageMarker(el: Element): boolean {
  const types = semanticTypes(el);
  if (types.includes('pagebreak') || types.includes('doc-pagebreak')) return true;
  const hint = `${attr(el, 'class') ?? ''} ${attr(el, 'id') ?? ''}`.toLowerCase();
  return hint.includes('page') && PAGE_NUMBER.test(rawText(el));
}

function collect(nodes: AnyNode[], out: string[]): void {
  for (const node of nodes) {
    if (isText(node)) {
      out.push(decodeHTMLStrict(node.data));
    } else if (isTag(node)) {
      const name = localName(node.name);
      if (name === 'br') out.push(BR);
      else if (SKIP_TAGS.has(name) || isNoteRef(node) || isPageMarker(node)) continue;
      else collect(node.children, out);
    }
    // 注释、CDATA、处理指令都不要
  }
}

/** 一组节点的纯文本。连续空白（包括 &nbsp;）合成一个空格，<br> 是换行，每行去掉首尾空白 */
export function nodesText(nodes: AnyNode[]): string {
  const parts: string[] = [];
  collect(nodes, parts);
  return parts
    .join('')
    .replace(/\s+/g, ' ')
    .split(BR)
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

/** 一个元素里的纯文本，规则同 nodesText */
export function elementText(el: Element): string {
  return nodesText(el.children);
}
