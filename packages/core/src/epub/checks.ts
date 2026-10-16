// 前置检查：判断这本书能不能处理。每个函数没问题时返回 null，有问题时返回错误或警告。

import type { OpfInfo } from './opf.ts';
import { decodeText } from './text.ts';
import type { ParseError, ParseWarning } from './types.ts';
import { attr, findAll, findFirst, parseXml, textOf } from './xml.ts';
import type { ZipArchive } from './zip.ts';

/**
 * "字体混淆"用的两种算法。很多正规的书会这样处理嵌入的字体，防止字体被直接拷走，
 * 正文不受影响，不能当成 DRM 拦下来。
 */
const FONT_OBFUSCATION = new Set([
  'http://www.idpf.org/2008/embedding', // IDPF 标准
  'http://ns.adobe.com/pdf/enc#RC', // Adobe
]);

/** DRM：有 Adobe 的 rights.xml，或者 encryption.xml 里有字体混淆以外的加密 */
export function checkDrm(archive: ZipArchive): ParseError | null {
  if (archive.read('META-INF/rights.xml') !== null) {
    return { code: 'DRM_PROTECTED', message: 'META-INF/rights.xml present (Adobe DRM)' };
  }
  const bytes = archive.read('META-INF/encryption.xml');
  if (bytes === null) return null;

  const encrypted = findAll(parseXml(decodeText(bytes)), 'EncryptedData');
  const real = encrypted.filter((data) => {
    const method = findFirst(data, 'EncryptionMethod');
    const algorithm = method === null ? null : attr(method, 'Algorithm');
    return algorithm === null || !FONT_OBFUSCATION.has(algorithm);
  });
  if (real.length === 0) return null;
  const first = real[0] && findFirst(real[0], 'CipherReference');
  const uri = first ? attr(first, 'URI') : null;
  return {
    code: 'DRM_PROTECTED',
    message: `${real.length} encrypted file(s) in encryption.xml, e.g. ${uri ?? '(unknown)'}`,
  };
}

/** mimetype 不对只是警告：很多工具转出来的书这里不规范，但内容完全可读 */
export function checkMimetype(archive: ZipArchive): ParseWarning | null {
  const bytes = archive.read('mimetype');
  const content = bytes === null ? null : decodeText(bytes).trim();
  if (content === 'application/epub+zip') return null;
  return {
    code: 'MIMETYPE_INVALID',
    message: content === null ? 'mimetype file missing' : `mimetype is "${content}"`,
  };
}

/** 固定版式：OPF 里声明的，或者苹果 iBooks 的 display-options.xml 里声明的 */
export function checkFixedLayout(archive: ZipArchive, opf: OpfInfo): ParseError | null {
  if (opf.fixedLayout) {
    return { code: 'FIXED_LAYOUT', message: 'OPF declares a fixed (pre-paginated) layout' };
  }
  // <display_options><platform name="*"><option name="fixed-layout">true</option></platform></display_options>
  const bytes = archive.read('META-INF/com.apple.ibooks.display-options.xml');
  if (bytes === null) return null;
  const apple = findAll(parseXml(decodeText(bytes)), 'option').some(
    (option) => attr(option, 'name') === 'fixed-layout' && textOf(option) === 'true',
  );
  return apple
    ? { code: 'FIXED_LAYOUT', message: 'Apple display options declare fixed-layout' }
    : null;
}

/** 竖排的 CSS 写法，包括 -epub-、-webkit- 前缀 */
const VERTICAL_CSS =
  /(?:-epub-|-webkit-)?writing-mode\s*:\s*(?:vertical-rl|vertical-lr|tb-rl|tb)\b/i;

/**
 * 竖排：满足任一条件
 * 1. spine 写了从右往左翻页（page-progression-direction="rtl"）
 * 2. Kindle 的 primary-writing-mode 是竖排
 * 3. manifest 里的 CSS 文件用到了竖排
 * 第 3 条可能误判（横排书只在某一处用了竖排样式），测试集里出现时再收紧。
 */
export function checkVertical(archive: ZipArchive, opf: OpfInfo): ParseError | null {
  if (opf.pageProgression === 'rtl') {
    return { code: 'VERTICAL_LAYOUT', message: 'spine page-progression-direction is rtl' };
  }
  if (opf.writingMode !== null && opf.writingMode.startsWith('vertical')) {
    return { code: 'VERTICAL_LAYOUT', message: `primary-writing-mode is ${opf.writingMode}` };
  }
  for (const item of opf.manifest.values()) {
    if (item.mediaType !== 'text/css') continue;
    const bytes = archive.read(item.href);
    if (bytes !== null && VERTICAL_CSS.test(decodeText(bytes))) {
      return { code: 'VERTICAL_LAYOUT', message: `vertical writing-mode in ${item.href}` };
    }
  }
  return null;
}

/** spine 里所有文件的文字少于这么多字符，就当作没有正文 */
export const MIN_TEXT_CHARS = 2000;

/**
 * 没有正文（粗略版）：spine 里全部文件去掉标签后，非空白字符少于 MIN_TEXT_CHARS，
 * 并且书里有图片（多半是扫描版）。精确的"正文字数"要等 0.4 能区分正文和版权页之后再收紧。
 */
export function checkNoText(archive: ZipArchive, opf: OpfInfo): ParseError | null {
  let chars = 0;
  for (const item of opf.spine) {
    const bytes = archive.read(item.href);
    if (bytes === null) continue;
    chars += countTextChars(decodeText(bytes));
    if (chars >= MIN_TEXT_CHARS) return null;
  }
  const hasImages = [...opf.manifest.values()].some((item) => item.mediaType.startsWith('image/'));
  if (!hasImages) return null;
  return { code: 'NO_TEXT', message: `only ${chars} text characters in the spine` };
}

/** 粗略统计 XHTML 里的文字：去掉 head、script、style、注释和所有标签，数非空白字符 */
export function countTextChars(xhtml: string): number {
  const text = xhtml
    .replace(/<head[\s>][\s\S]*?<\/head>/gi, '')
    .replace(/<(script|style)[\s>][\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&[#\w]+;/g, 'x'); // 一个实体算一个字符
  return text.replace(/\s/g, '').length;
}

/** spine 里的文件在 zip 里是否存在：全都不存在是 CORRUPTED，部分不存在是警告 */
export function checkSpineFiles(
  archive: ZipArchive,
  opf: OpfInfo,
): { error: ParseError | null; warning: ParseWarning | null } {
  const missing = opf.spine.filter((item) => archive.read(item.href) === null).map((i) => i.href);
  if (missing.length === opf.spine.length) {
    return {
      error: { code: 'CORRUPTED', message: 'none of the spine files exist in the zip' },
      warning: null,
    };
  }
  return {
    error: null,
    warning:
      missing.length === 0
        ? null
        : { code: 'SPINE_FILES_MISSING', message: `missing spine files: ${missing.join(', ')}` },
  };
}
