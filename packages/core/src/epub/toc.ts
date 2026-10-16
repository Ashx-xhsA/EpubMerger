// 目录解析：ePub 3 的 nav 和 ePub 2 的 NCX 都转成同一种树形结构 TocEntry[]。

import { dirname, resolveHref } from './path.ts';
import { decodeText } from './text.ts';
import type { OpfInfo } from './opf.ts';
import type { ParseWarning, TocEntry } from './types.ts';
import { attr, childElements, findAll, findFirst, localName, parseXml, textOf } from './xml.ts';
import type { Element } from './xml.ts';
import type { ZipArchive } from './zip.ts';

type Target = { path: string; fragment: string | null };
type Resolve = (href: string) => Target | null;

/**
 * 目录里链接的解析规则：
 * 1. 按标准，以目录文件自己所在的文件夹为起点
 * 2. 算出来的文件不存在时，改以 OPF 所在的文件夹为起点再试一次（有的工具写错了基准）
 * 3. 还是不存在，就保留第 1 步的结果，由 readToc 统计成 TOC_BROKEN_LINKS 警告
 * 指向书外的链接返回 null。
 */
function makeResolve(tocPath: string, opfDir: string, exists: (path: string) => boolean): Resolve {
  const tocDir = dirname(tocPath);
  return (href) => {
    const standard = resolveHref(tocDir, href);
    if (standard === null || exists(standard.path)) return standard;
    const fallback = resolveHref(opfDir, href);
    return fallback !== null && exists(fallback.path) ? fallback : standard;
  };
}

/**
 * 组装一项目录。没有可用的链接（只是一个分组标题，或者链接指向书外）时，
 * 借用第一个子项的位置；连子项都没有就丢掉这一项。
 */
function makeEntry(title: string, target: Target | null, children: TocEntry[]): TocEntry[] {
  if (target !== null) return [{ title, href: target.path, fragment: target.fragment, children }];
  const first = children[0];
  if (first === undefined) return [];
  return [{ title, href: first.href, fragment: first.fragment, children }];
}

// ---- nav（ePub 3）----
// <nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章</a><ol>…子目录…</ol></li></ol></nav>

export function parseNav(text: string, resolve: Resolve): TocEntry[] {
  const navs = findAll(parseXml(text), 'nav');
  // 一个文件里可能还有 page-list（纸书页码对照）、landmarks 等，只要 toc；都没标就用第一个
  const tocNav =
    navs.find((nav) => (attr(nav, 'type') ?? '').split(/\s+/).includes('toc')) ?? navs[0];
  const list = tocNav === undefined ? null : findFirst(tocNav, 'ol');
  return list === null ? [] : navList(list, resolve);
}

function navList(ol: Element, resolve: Resolve): TocEntry[] {
  return childElements(ol, 'li').flatMap((li) => {
    // 标题写在 <a>（有链接）或 <span>（只是分组标题）里
    const label = childElements(li).find((el) => ['a', 'span'].includes(localName(el.name)));
    const href = label !== undefined && localName(label.name) === 'a' ? attr(label, 'href') : null;
    const sublist = childElements(li, 'ol')[0];
    return makeEntry(
      label === undefined ? '' : textOf(label),
      href === null ? null : resolve(href),
      sublist === undefined ? [] : navList(sublist, resolve),
    );
  });
}

// ---- NCX（ePub 2）----
// <navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="ch1.xhtml"/>…子 navPoint…</navPoint></navMap>
// 按在文件里出现的先后排序，不用 playOrder：有的书 playOrder 是乱的。

export function parseNcx(text: string, resolve: Resolve): TocEntry[] {
  const navMap = findFirst(parseXml(text), 'navMap');
  return navMap === null ? [] : navPoints(navMap, resolve);
}

function navPoints(parent: Element, resolve: Resolve): TocEntry[] {
  return childElements(parent, 'navPoint').flatMap((point) => {
    const label = childElements(point, 'navLabel')[0];
    const content = childElements(point, 'content')[0];
    const src = content === undefined ? null : attr(content, 'src');
    return makeEntry(
      label === undefined ? '' : textOf(label),
      src === null ? null : resolve(src),
      navPoints(point, resolve),
    );
  });
}

// ---- 选用哪个目录 ----

export interface TocResult {
  toc: TocEntry[];
  source: 'nav' | 'ncx' | 'none';
  warnings: ParseWarning[];
}

/**
 * 有 nav 且能解析出至少一项就用 nav，否则用 NCX，都不行就返回空目录。
 * 没有目录不算错误，0.6 会用别的办法切章节。
 */
export function readToc(archive: ZipArchive, opf: OpfInfo, opfPath: string): TocResult {
  const exists = (path: string) => archive.read(path) !== null;
  const opfDir = dirname(opfPath);
  const warnings: ParseWarning[] = [];

  const tryParse = (path: string | null, parse: typeof parseNav): TocEntry[] => {
    const bytes = path === null ? null : archive.read(path);
    if (path === null || bytes === null) return [];
    return parse(decodeText(bytes), makeResolve(path, opfDir, exists));
  };

  let toc = tryParse(opf.navPath, parseNav);
  let source: TocResult['source'] = 'nav';
  if (toc.length === 0) {
    toc = tryParse(opf.ncxPath, parseNcx);
    source = 'ncx';
    if (toc.length > 0 && opf.navPath !== null) {
      warnings.push({
        code: 'NAV_FALLBACK_TO_NCX',
        message: `nav ${opf.navPath} has no usable entries, using NCX`,
      });
    }
  }
  if (toc.length === 0) {
    source = 'none';
    warnings.push({ code: 'NO_TOC', message: 'no usable nav or NCX table of contents' });
  }

  const broken = countBroken(toc, exists);
  if (broken > 0) {
    warnings.push({
      code: 'TOC_BROKEN_LINKS',
      message: `${broken} table of contents link(s) point to missing files`,
    });
  }
  return { toc, source, warnings };
}

function countBroken(entries: TocEntry[], exists: (path: string) => boolean): number {
  return entries.reduce(
    (n, e) => n + (exists(e.href) ? 0 : 1) + countBroken(e.children, exists),
    0,
  );
}
