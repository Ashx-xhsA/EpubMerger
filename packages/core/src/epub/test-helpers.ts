// 测试用：在内存里拼一本最小的合法 ePub。每个测试只改其中几个文件，就能造出各种"坏书"。

import { strToU8, zipSync, type Zippable } from 'fflate';

export const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

export const CONTENT_OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="uid">urn:uuid:12345</dc:identifier>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="Styles/style.css" media-type="text/css"/>
    <item id="ch1" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
  </spine>
</package>`;

export const TOC_NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="np1"><navLabel><text>Chapter 1</text></navLabel><content src="Text/ch1.xhtml"/></navPoint>
  </navMap>
</ncx>`;

/** 3,000 多个字符的正文，超过 NO_TEXT 的门槛 */
export const CHAPTER_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 1</title><link rel="stylesheet" href="../Styles/style.css"/></head>
<body>
  <h1>Chapter 1</h1>
  ${'<p>The beauty of the House is immeasurable; its kindness infinite.</p>\n'.repeat(50)}
</body>
</html>`;

export const STYLE_CSS = 'p { text-indent: 2em; }';

/** 默认的文件。key 是 zip 内路径 */
export const BASE_FILES: Record<string, string> = {
  'META-INF/container.xml': CONTAINER_XML,
  'OEBPS/content.opf': CONTENT_OPF,
  'OEBPS/toc.ncx': TOC_NCX,
  'OEBPS/Text/ch1.xhtml': CHAPTER_XHTML,
  'OEBPS/Styles/style.css': STYLE_CSS,
};

/**
 * 造一本 ePub。changes 里给出要改的文件：字符串或字节 = 加上或替换，null = 删掉。
 * mimetype 按规定放在第一个且不压缩；changes 里给 mimetype: null 可以删掉它。
 */
export function buildEpub(changes: Record<string, string | Uint8Array | null> = {}): Uint8Array {
  const files: Record<string, string | Uint8Array | null> = {
    mimetype: 'application/epub+zip',
    ...BASE_FILES,
    ...changes,
  };
  const zippable: Zippable = {};
  // mimetype 先放进去（对象的 key 按插入顺序排列，所以它会是 zip 里的第一个文件）
  const names = Object.keys(files).sort((a, b) =>
    a === 'mimetype' ? -1 : b === 'mimetype' ? 1 : 0,
  );
  for (const name of names) {
    const content = files[name];
    if (content === null || content === undefined) continue;
    const data = typeof content === 'string' ? strToU8(content) : content;
    zippable[name] = name === 'mimetype' ? [data, { level: 0 }] : data;
  }
  return zipSync(zippable);
}
