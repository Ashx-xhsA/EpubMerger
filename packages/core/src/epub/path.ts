// zip 内路径的处理。core 不能用 Node 的 path 模块（浏览器没有），所以自己实现。
// zip 里的路径一律用 "/" 分隔，没有开头的 "/"，如 "OEBPS/Text/ch01.xhtml"。

/** "OEBPS/content.opf" → "OEBPS"；没有文件夹时返回 "" */
export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** "ch01.xhtml#sec2" → { path: "ch01.xhtml", fragment: "sec2" }；没有 # 或 # 后为空时 fragment 为 null */
export function splitFragment(href: string): { path: string; fragment: string | null } {
  const i = href.indexOf('#');
  if (i < 0) return { path: href, fragment: null };
  const fragment = href.slice(i + 1);
  return { path: href.slice(0, i), fragment: fragment === '' ? null : fragment };
}

/** 解 URL 编码（"%20" → 空格）。编码写坏了（如单独一个 "%"）就原样返回 */
export function safeDecodeUri(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * 把相对路径拼到 baseDir 上，并处理 "." 和 ".."。
 * ("OEBPS", "Text/../Images/a.jpg") → "OEBPS/Images/a.jpg"
 * href 以 "/" 开头时视为从 zip 根目录开始。".." 超出根目录时忽略。
 */
export function resolvePath(baseDir: string, href: string): string {
  const parts = href.startsWith('/')
    ? href.split('/')
    : [...baseDir.split('/'), ...href.split('/')];
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

/**
 * OPF、目录里写的 href → zip 内完整路径和锚点。
 * 依次做：拆出锚点、解 URL 编码、拼到 baseDir 上。
 * 指向书外的链接（http:、mailto: 等）返回 null。
 */
export function resolveHref(
  baseDir: string,
  href: string,
): { path: string; fragment: string | null } | null {
  const trimmed = href.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  const { path, fragment } = splitFragment(trimmed);
  return {
    path: resolvePath(baseDir, safeDecodeUri(path)),
    fragment: fragment === null ? null : safeDecodeUri(fragment),
  };
}

/**
 * 从 fromDir 文件夹指向 zip 内路径 to 的相对链接，每段做 URL 编码。
 * ("OEBPS/Text", "OEBPS/bilingual.css") → "../bilingual.css"
 */
export function relativePath(fromDir: string, to: string): string {
  const from = fromDir.split('/').filter((p) => p !== '');
  const target = to.split('/').filter((p) => p !== '');
  let common = 0;
  while (common < from.length && common < target.length - 1 && from[common] === target[common]) {
    common++;
  }
  const up = from.slice(common).map(() => '..');
  return [...up, ...target.slice(common).map(encodeURIComponent)].join('/');
}
