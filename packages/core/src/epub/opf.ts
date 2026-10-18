// 读 META-INF/container.xml 找到 OPF，再解析 OPF 的 metadata / manifest / spine。

import { dirname, resolveHref } from './path.ts';
import type { BookMetadata, ManifestItem, ParseError, ParseWarning, SpineItem } from './types.ts';
import { attr, childElements, findAll, findFirst, parseXml, textOf, type Element } from './xml.ts';

/** 从 container.xml 里找 OPF 的路径。优先 media-type 是 OPF 的 rootfile；找不到返回 null */
export function readContainer(text: string): string | null {
  const rootfiles = findAll(parseXml(text), 'rootfile');
  const preferred =
    rootfiles.find((el) => attr(el, 'media-type') === 'application/oebps-package+xml') ??
    rootfiles[0];
  const path = preferred === undefined ? null : attr(preferred, 'full-path');
  return path === null || path.trim() === '' ? null : path.trim();
}

/** OPF 解析结果。除了 Book 要用的字段，还带上前置检查要用的信息 */
export interface OpfInfo {
  version: string;
  metadata: BookMetadata;
  manifest: Map<string, ManifestItem>;
  spine: SpineItem[];
  /** ePub 3 nav 目录的路径（manifest 里 properties 含 nav 的那项） */
  navPath: string | null;
  /** ePub 2 NCX 目录的路径（spine 的 toc 属性指向的那项，没写时找 NCX 类型的文件） */
  ncxPath: string | null;
  /** 声明了固定版式：ePub 3 的 rendition:layout = pre-paginated，或 Kindle 的 fixed-layout = true */
  fixedLayout: boolean;
  /** spine 的 page-progression-direction，如 "rtl"；没写时为 null */
  pageProgression: string | null;
  /** Kindle 来源的书写的 primary-writing-mode，如 "horizontal-lr"、"vertical-rl"；没写时为 null */
  writingMode: string | null;
}

export type OpfResult =
  { ok: true; opf: OpfInfo; warnings: ParseWarning[] } | { ok: false; error: ParseError };

const NCX_MEDIA_TYPE = 'application/x-dtbncx+xml';

export function parseOpf(text: string, opfPath: string): OpfResult {
  const warnings: ParseWarning[] = [];
  const doc = parseXml(text);
  const pkg = findFirst(doc, 'package');
  if (pkg === null) return corrupted('OPF has no <package> element');

  // ---- manifest ----
  const baseDir = dirname(opfPath);
  const manifest = new Map<string, ManifestItem>();
  let skippedItems = 0;
  const manifestEl = findFirst(pkg, 'manifest');
  for (const el of manifestEl === null ? [] : childElements(manifestEl, 'item')) {
    const id = attr(el, 'id');
    const href = attr(el, 'href');
    const resolved = href === null ? null : resolveHref(baseDir, href);
    // 缺 id / href、指向书外（http: 等）、id 重复的项都跳过
    if (id === null || resolved === null || manifest.has(id)) {
      skippedItems++;
      continue;
    }
    manifest.set(id, {
      id,
      href: resolved.path,
      mediaType: attr(el, 'media-type') ?? '',
      properties: splitList(attr(el, 'properties')),
    });
  }
  if (skippedItems > 0) {
    warnings.push({
      code: 'MANIFEST_ITEMS_SKIPPED',
      message: `${skippedItems} manifest item(s) skipped (missing id/href, external, or duplicate id)`,
    });
  }

  // ---- spine ----
  const spineEl = findFirst(pkg, 'spine');
  if (spineEl === null) return corrupted('OPF has no <spine> element');
  const spine: SpineItem[] = [];
  const missingIds: string[] = [];
  for (const el of childElements(spineEl, 'itemref')) {
    const idref = attr(el, 'idref');
    const item = idref === null ? undefined : manifest.get(idref);
    if (idref === null || item === undefined) {
      missingIds.push(idref ?? '(no idref)');
      continue;
    }
    spine.push({ idref, href: item.href, linear: attr(el, 'linear') !== 'no' });
  }
  if (missingIds.length > 0) {
    warnings.push({
      code: 'SPINE_ITEMS_SKIPPED',
      message: `spine refers to id(s) not in manifest: ${missingIds.join(', ')}`,
    });
  }
  if (spine.length === 0) return corrupted('spine is empty');

  // ---- 目录文件 ----
  const items = [...manifest.values()];
  const navPath = items.find((item) => item.properties.includes('nav'))?.href ?? null;
  const tocId = attr(spineEl, 'toc');
  const ncxPath =
    (tocId === null ? undefined : manifest.get(tocId))?.href ??
    items.find((item) => item.mediaType === NCX_MEDIA_TYPE)?.href ??
    null;

  // ---- metadata ----
  const metadataEl = findFirst(pkg, 'metadata');
  const metadata = metadataEl === null ? emptyMetadata() : readMetadata(metadataEl, pkg);
  if (metadata.title === '') {
    warnings.push({ code: 'MISSING_TITLE', message: 'OPF has no dc:title' });
  }
  if (metadata.languages.length === 0) {
    warnings.push({ code: 'MISSING_LANGUAGE', message: 'OPF has no dc:language' });
  }

  return {
    ok: true,
    warnings,
    opf: {
      version: attr(pkg, 'version') ?? '',
      metadata,
      manifest,
      spine,
      navPath,
      ncxPath,
      fixedLayout: metadataEl !== null && isFixedLayout(metadataEl),
      pageProgression: attr(spineEl, 'page-progression-direction'),
      writingMode: metadataEl === null ? null : readWritingMode(metadataEl),
    },
  };
}

function readMetadata(metadataEl: Element, pkg: Element): BookMetadata {
  const texts = (name: string) =>
    findAll(metadataEl, name)
      .map(textOf)
      .filter((t) => t !== '');

  // identifier 取 package 的 unique-identifier 指向的那个，没有就取第一个
  const uniqueId = attr(pkg, 'unique-identifier');
  const identifiers = findAll(metadataEl, 'identifier');
  const unique = identifiers.find((el) => uniqueId !== null && attr(el, 'id') === uniqueId);
  const identifierEl = unique ?? identifiers[0];
  const identifier = identifierEl === undefined ? '' : textOf(identifierEl);
  // ePub 2 的封面：<meta name="cover" content="封面图片的 manifest id"/>
  const coverMeta = findAll(metadataEl, 'meta').find((m) => attr(m, 'name') === 'cover');

  return {
    title: texts('title')[0] ?? '',
    creators: texts('creator'),
    languages: texts('language'),
    identifier: identifier === '' ? null : identifier,
    coverId: coverMeta === undefined ? null : attr(coverMeta, 'content') || null,
  };
}

function emptyMetadata(): BookMetadata {
  return { title: '', creators: [], languages: [], identifier: null, coverId: null };
}

function isFixedLayout(metadataEl: Element): boolean {
  return findAll(metadataEl, 'meta').some((meta) => {
    // ePub 3：<meta property="rendition:layout">pre-paginated</meta>
    if (attr(meta, 'property') === 'rendition:layout') return textOf(meta) === 'pre-paginated';
    // Kindle 的写法：<meta name="fixed-layout" content="true"/>
    if (attr(meta, 'name') === 'fixed-layout') return attr(meta, 'content') === 'true';
    return false;
  });
}

/** <meta name="primary-writing-mode" content="vertical-rl"/> 的 content */
function readWritingMode(metadataEl: Element): string | null {
  const meta = findAll(metadataEl, 'meta').find((m) => attr(m, 'name') === 'primary-writing-mode');
  return meta === undefined ? null : attr(meta, 'content');
}

/** "nav cover-image" → ["nav", "cover-image"] */
function splitList(value: string | null): string[] {
  return value === null ? [] : value.split(/\s+/).filter((s) => s !== '');
}

function corrupted(message: string): OpfResult {
  return { ok: false, error: { code: 'CORRUPTED', message } };
}
