// 改 OPF 和 NCX。和插段落一样按字符位置替换，不重新输出整个文件。

import type { Element } from 'domhandler';
import { attr, findAll, findFirst, parseXml } from '../epub/xml.ts';
import { applyEdits, insertAt, type Edit } from './edit.ts';
import { escapeXml } from './sanitize.ts';

export interface OpfChanges {
  title: string;
  /** 新的 identifier，如 "urn:uuid:…" */
  identifier: string;
  /** 骨架书的语言在前 */
  languages: string[];
  /** 新增的 css：manifest 里的 id 和相对 OPF 的 href */
  css: { id: string; href: string };
  /** ePub 3 的 dcterms:modified，格式 CCYY-MM-DDThh:mm:ssZ */
  modified: string;
}

/** 元素在原文里的范围 [start, end) */
function span(el: Element): [number, number] {
  return [el.startIndex ?? 0, (el.endIndex ?? -1) + 1];
}

/** 换掉元素里的内容，保留元素自己的标签和属性；元素是空的（<x/>）时整个换掉 */
function setText(el: Element, text: string): Edit {
  const first = el.children[0];
  const last = el.children.at(-1);
  if (first === undefined || last === undefined) {
    const [start, end] = span(el);
    return { start, end, text: `<${el.name}>${text}</${el.name}>` };
  }
  return { start: first.startIndex ?? 0, end: (last.endIndex ?? -1) + 1, text };
}

/** 在元素的结束标签前面插入 */
function beforeClose(source: string, el: Element, text: string): Edit {
  const end = span(el)[1];
  return insertAt(source.lastIndexOf('</', end), text);
}

/** 返回改好的 OPF；结构坏到找不到 metadata / manifest 时返回 null */
export function updateOpf(source: string, epub3: boolean, changes: OpfChanges): string | null {
  const doc = parseXml(source, { withIndices: true });
  const pkg = findFirst(doc, 'package');
  const metadata = findFirst(doc, 'metadata');
  const manifest = findFirst(doc, 'manifest');
  if (pkg === null || metadata === null || manifest === null) return null;
  const edits: Edit[] = [];

  const title = findFirst(metadata, 'title');
  if (title !== null) edits.push(setText(title, escapeXml(changes.title)));
  else
    edits.push(beforeClose(source, metadata, `<dc:title>${escapeXml(changes.title)}</dc:title>`));

  // unique-identifier 指向的那个 identifier 换成新 UUID，去掉 opf:scheme="ISBN" 这类属性；
  // 其他 identifier（ISBN 等）保留
  const uid = attr(pkg, 'unique-identifier');
  const ident = findAll(metadata, 'identifier').find(
    (el) => uid !== null && attr(el, 'id') === uid,
  );
  if (ident !== undefined) {
    const [start, end] = span(ident);
    edits.push({
      start,
      end,
      text: `<${ident.name} id="${escapeXml(uid ?? '')}">${changes.identifier}</${ident.name}>`,
    });
  }

  // 所有 dc:language 换成两个，用第一个元素的写法（前缀）
  const langs = findAll(metadata, 'language');
  const langTag = langs[0]?.name ?? 'dc:language';
  const langXml = changes.languages.map((l) => `<${langTag}>${escapeXml(l)}</${langTag}>`).join('');
  langs.forEach((el, i) => {
    const [start, end] = span(el);
    edits.push({ start, end, text: i === 0 ? langXml : '' });
  });
  if (langs.length === 0) edits.push(beforeClose(source, metadata, langXml));

  if (epub3) {
    const modified = findAll(metadata, 'meta').find(
      (el) => attr(el, 'property') === 'dcterms:modified',
    );
    if (modified !== undefined) edits.push(setText(modified, changes.modified));
    else
      edits.push(
        beforeClose(
          source,
          metadata,
          `<meta property="dcterms:modified">${changes.modified}</meta>`,
        ),
      );
  }

  edits.push(
    beforeClose(
      source,
      manifest,
      `<item id="${changes.css.id}" href="${changes.css.href}" media-type="text/css"/>`,
    ),
  );
  return applyEdits(source, edits);
}

/** NCX 里的 dtb:uid 要和 OPF 的 identifier 一样（ePub 2，不一致时 epubcheck 报错） */
export function updateNcxUid(source: string, identifier: string): string {
  const doc = parseXml(source, { withIndices: true });
  const edits = findAll(doc, 'meta')
    .filter((el) => attr(el, 'name') === 'dtb:uid')
    .map((el) => {
      const [start, end] = span(el);
      return { start, end, text: `<${el.name} name="dtb:uid" content="${identifier}"/>` };
    });
  return applyEdits(source, edits);
}

/** dcterms:modified 要的格式：去掉毫秒 */
export function modifiedTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
