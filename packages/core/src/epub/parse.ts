// parseEpub：ePub 文件的字节 → Book 或错误码。遇到第一个错误就返回。

import {
  checkDrm,
  checkFixedLayout,
  checkMimetype,
  checkNoText,
  checkSpineFiles,
  checkVertical,
} from './checks.ts';
import { parseOpf, readContainer } from './opf.ts';
import { safeDecodeUri } from './path.ts';
import { decodeText } from './text.ts';
import { readToc } from './toc.ts';
import type { Book, ParseResult, ParseWarning } from './types.ts';
import { unzipEpub, type ZipLimits } from './zip.ts';

/** limits 一般不用传，测试时可以传小一点的上限 */
export function parseEpub(bytes: Uint8Array, limits?: ZipLimits): ParseResult {
  const warnings: ParseWarning[] = [];

  // 1. 解压
  const unzipped = unzipEpub(bytes, limits);
  if (!unzipped.ok) return unzipped;
  const archive = unzipped.archive;

  // 2. 没有 container.xml 就不是 ePub
  const container = archive.read('META-INF/container.xml');
  if (container === null) {
    return fail('NOT_EPUB', 'META-INF/container.xml missing');
  }

  // 3. DRM 放在前面：加密后的内容读出来是乱码，后面的步骤可能报出误导人的 CORRUPTED
  const drm = checkDrm(archive);
  if (drm !== null) return { ok: false, error: drm };

  // 4. mimetype 只是警告
  const mimetype = checkMimetype(archive);
  if (mimetype !== null) warnings.push(mimetype);

  // 5. container → OPF
  const opfPath = readContainer(decodeText(container));
  if (opfPath === null) return fail('CORRUPTED', 'container.xml has no rootfile');
  const opfBytes = archive.read(opfPath);
  if (opfBytes === null) return fail('CORRUPTED', `OPF ${opfPath} not found`);

  // 6. OPF
  const parsed = parseOpf(decodeText(opfBytes), opfPath);
  if (!parsed.ok) return parsed;
  const opf = parsed.opf;
  warnings.push(...parsed.warnings);

  // 7. spine 里的文件是否存在
  const spineFiles = checkSpineFiles(archive, opf);
  if (spineFiles.error !== null) return { ok: false, error: spineFiles.error };
  if (spineFiles.warning !== null) warnings.push(spineFiles.warning);

  // 8. 版式和正文
  for (const check of [checkFixedLayout, checkVertical, checkNoText]) {
    const error = check(archive, opf);
    if (error !== null) return { ok: false, error };
  }

  // 9. 目录
  const toc = readToc(archive, opf, opfPath);
  warnings.push(...toc.warnings);

  // 10. 组装
  const readBytes = (path: string) => archive.read(path) ?? archive.read(safeDecodeUri(path));
  const book: Book = {
    version: opf.version,
    metadata: opf.metadata,
    opfPath,
    manifest: opf.manifest,
    spine: opf.spine,
    toc: toc.toc,
    tocSource: toc.source,
    files: archive.paths,
    readBytes,
    readText: (path) => {
      const data = readBytes(path);
      return data === null ? null : decodeText(data);
    },
  };
  return { ok: true, book, warnings };
}

function fail(code: 'NOT_EPUB' | 'CORRUPTED', message: string): ParseResult {
  return { ok: false, error: { code, message } };
}
